'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { DatabaseClient } = require('../src/repositories/DatabaseClient');
const { createNoaRepository } = require('../src/modules/noa/noa.repository');
const { createNoaBillingService } = require('../src/modules/noa/noa-billing.service');
const {
  archiveLegacyRuntimeTables,
  ensureNoaSchema
} = require('../src/modules/noa/noa.schema');

const LEGACY_GIFT_NOA = '5.000000';
const SUBSCRIPTIONS_PATH = path.join(__dirname, '..', 'subscriptions.json');

function stablePayload(subscription) {
  return {
    userId: String(subscription?.userId || ''),
    planId: subscription?.planId ? String(subscription.planId) : null,
    status: subscription?.status ? String(subscription.status) : null,
    assignedAt: subscription?.assignedAt || null,
    expiresAt: subscription?.expiresAt || null,
    note: subscription?.note || ''
  };
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest();
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isActiveSubscription(payload, now = Date.now()) {
  if (payload.status !== 'active') return false;
  const expiresAt = parseDateOrNull(payload.expiresAt);
  return !expiresAt || expiresAt.getTime() > now;
}

async function readLegacyFile() {
  try {
    const raw = await fs.readFile(SUBSCRIPTIONS_PATH, 'utf8');
    const document = JSON.parse(raw || '{}');
    return {
      document,
      subscriptions: Array.isArray(document.userSubscriptions)
        ? document.userSubscriptions
        : []
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { document: null, subscriptions: [] };
    throw error;
  }
}

async function migrateSubscription({ db, billing, subscription }) {
  const payload = stablePayload(subscription);
  if (!payload.userId) return { status: 'skipped_invalid', payload };
  const sourceHash = hashPayload(payload);
  const sourceHashHex = sourceHash.toString('hex');

  return db.inTransaction(null, async (connection) => {
    const [archived] = await connection.query(
      `SELECT migration_status, gift_transaction_id
         FROM app_noa_legacy_subscriptions_archive
        WHERE source_hash = ?
        LIMIT 1
        FOR UPDATE`,
      [sourceHash]
    );
    if (archived[0]) {
      return {
        status: archived[0].migration_status,
        transactionId: archived[0].gift_transaction_id || null,
        payload
      };
    }

    const active = isActiveSubscription(payload);
    const [users] = await connection.query(
      'SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1',
      [payload.userId]
    );
    let migrationStatus = active ? 'skipped_missing_user' : 'skipped_inactive';
    let transactionId = null;

    if (active && users[0]) {
      const credit = await billing.credit({
        userId: payload.userId,
        amountNoa: LEGACY_GIFT_NOA,
        entryType: 'legacy_conversion_gift',
        referenceType: 'legacy_subscription',
        referenceId: sourceHashHex,
        idempotencyKey: `legacy-conversion:${sourceHashHex}`,
        payloadHash: {
          sourceHash: sourceHashHex,
          userId: payload.userId,
          amountNoa: LEGACY_GIFT_NOA
        },
        actorType: 'system',
        actorId: 'noa-migration',
        metadata: {
          planId: payload.planId,
          originalStatus: payload.status,
          conversionGiftNoa: LEGACY_GIFT_NOA
        }
      }, { connection });
      transactionId = credit.transactionId;
      migrationStatus = credit.replayed ? 'already_gifted' : 'gifted';
    }

    await connection.query(
      `INSERT INTO app_noa_legacy_subscriptions_archive
        (source_hash, user_id, plan_id, original_status, assigned_at, expires_at,
         source_payload, migration_status, gift_transaction_id, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
      [
        sourceHash,
        payload.userId,
        payload.planId,
        payload.status,
        parseDateOrNull(payload.assignedAt),
        parseDateOrNull(payload.expiresAt),
        JSON.stringify(payload),
        migrationStatus,
        transactionId
      ]
    );

    return { status: migrationStatus, transactionId, payload };
  });
}

async function cancelLegacyFile(document) {
  if (!document) return false;
  const cancelledAt = new Date().toISOString();
  let changed = false;
  const userSubscriptions = Array.isArray(document.userSubscriptions)
    ? document.userSubscriptions.map((subscription) => {
        if (String(subscription?.status || '').toLowerCase() !== 'active') {
          return subscription;
        }
        changed = true;
        return {
          ...subscription,
          status: 'cancelled',
          cancelledAt,
          cancellationReason: 'migrated_to_noa'
        };
      })
    : [];
  if (!changed) return false;

  const next = {
    ...document,
    userSubscriptions,
    updatedAt: cancelledAt,
    archivedReadOnly: true,
    runtimeBillingModel: 'noa'
  };
  const tempPath = `${SUBSCRIPTIONS_PATH}.noa-migration.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w'
  });
  await fs.rename(tempPath, SUBSCRIPTIONS_PATH);
  return true;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const client = new DatabaseClient({ databaseUrl });
  try {
    await client.init();
    // Archival is a deployment migration concern, never an application-runtime
    // concern. The live backend does not read or copy legacy billing tables.
    await archiveLegacyRuntimeTables(client);
    await ensureNoaSchema(client);
    const repository = createNoaRepository(client);
    const billing = createNoaBillingService({ repository });
    const legacy = await readLegacyFile();
    const results = [];
    for (const subscription of legacy.subscriptions) {
      results.push(await migrateSubscription({ db: repository, billing, subscription }));
    }
    const sourceCancelled = await cancelLegacyFile(legacy.document);
    console.log(JSON.stringify({
      migration: 'noa',
      giftNoa: LEGACY_GIFT_NOA,
      subscriptionsProcessed: results.length,
      gifted: results.filter((item) => item.status === 'gifted').length,
      alreadyGifted: results.filter((item) => item.status === 'already_gifted').length,
      skippedMissingUser: results.filter((item) => item.status === 'skipped_missing_user').length,
      skippedInactive: results.filter((item) => item.status === 'skipped_inactive').length,
      legacySourceCancelled: sourceCancelled
    }));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[Noa Migration] Failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  LEGACY_GIFT_NOA,
  isActiveSubscription,
  migrateSubscription,
  stablePayload
};
