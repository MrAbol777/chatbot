'use strict';

const { randomUUID } = require('node:crypto');
const { createNoaBillingService } = require('../../noa/noa-billing.service');
const { createNoaRepository } = require('../../noa/noa.repository');
const { ensureNoaSchema } = require('../../noa/noa.schema');

function createNoaVideoDbFixture(pool) {
  const userIds = new Set();
  const jobIds = new Set();
  const repository = createNoaRepository(pool);
  const billing = createNoaBillingService({ repository });

  async function initialize() {
    await ensureNoaSchema(pool);
  }

  async function createUser(prefix = 'video-noa-user') {
    const userId = `${prefix}-${randomUUID()}`;
    userIds.add(userId);
    await pool.query(
      'INSERT INTO app_users (user_id,name,age,registered_at) VALUES (?,?,?,NOW())',
      [userId, 'Video Noa Test', 20]
    );
    return userId;
  }

  async function reserveForJob({ userId, jobId, duration, expiresAt }) {
    const quote = await billing.quote({
      actionKey: 'video_generation',
      quantity: duration
    });
    const fixtureToken = randomUUID();
    await billing.credit({
      userId,
      amountNoa: quote.amountNoa,
      entryType: 'test_credit',
      referenceType: 'video_test_fixture',
      referenceId: `credit-${fixtureToken}`,
      idempotencyKey: `credit-${fixtureToken}`,
      payloadHash: { jobId, quote },
      actorType: 'system',
      actorId: 'video-noa-test'
    });
    const reservation = await billing.reserve({
      userId,
      actionKey: 'video_generation',
      quantity: duration,
      idempotencyKey: `reserve-${fixtureToken}`,
      payloadHash: { jobId, duration },
      referenceType: 'video_generation',
      referenceId: jobId,
      expiresAt,
      actorType: 'user',
      actorId: userId,
      metadata: { source: 'video_noa_db_fixture' }
    });
    return { quote, reservation };
  }

  async function createJob({
    userId: existingUserId = null,
    provider = 'fake',
    status = 'submitted',
    duration = '4',
    expiresAt = new Date(Date.now() + 60 * 60 * 1000),
    reservationExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000),
    nextPollAt = new Date(),
    pollAttempts = 0,
    providerJobId = `provider-job-${randomUUID()}`,
    workerLeaseOwner = null,
    workerLeaseUntil = null,
    mode = 'text-to-video',
    mediaId = null,
    additionalColumns = {}
  } = {}) {
    const userId = existingUserId || await createUser();
    const jobId = `video-noa-job-${randomUUID()}`;
    const modelKey = `noa-test-${randomUUID()}`.slice(0, 64);
    jobIds.add(jobId);
    const { quote, reservation } = await reserveForJob({
      userId,
      jobId,
      duration,
      expiresAt: reservationExpiresAt
    });

    const columns = [
      'id',
      'user_id',
      'mode',
      'model_key',
      'provider',
      'provider_model_id_snapshot',
      'status',
      'prompt',
      'aspect_ratio',
      'duration',
      'quality',
      'input_media_reference',
      'provider_job_id',
      'noa_reservation_id',
      'idempotency_hash',
      'payload_hash',
      'expires_at',
      'next_poll_at',
      'poll_attempts',
      'worker_lease_owner',
      'worker_lease_until',
      'created_at',
      'updated_at'
    ];
    const values = [
      jobId,
      userId,
      mode,
      modelKey,
      provider,
      'noa-test-model',
      status,
      'Noa video fixture',
      '16:9',
      String(duration),
      'standard',
      mediaId,
      providerJobId,
      reservation.reservationId,
      randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      randomUUID().replaceAll('-', '').padEnd(64, 'b').slice(0, 64),
      expiresAt,
      nextPollAt,
      pollAttempts,
      workerLeaseOwner,
      workerLeaseUntil,
      new Date(),
      new Date()
    ];

    for (const [column, value] of Object.entries(additionalColumns)) {
      if (!/^[a-z0-9_]+$/i.test(column)) throw new Error(`Unsafe fixture column: ${column}`);
      columns.push(column);
      values.push(value);
    }
    await pool.query(
      `INSERT INTO app_video_generations (${columns.map((column) => `\`${column}\``).join(',')})
       VALUES (${columns.map(() => '?').join(',')})`,
      values
    );

    return {
      userId,
      jobId,
      modelKey,
      providerJobId,
      reservationId: reservation.reservationId,
      amountNoa: quote.amountNoa,
      duration: String(duration)
    };
  }

  async function state(fixture) {
    const [[job]] = await pool.query(
      'SELECT * FROM app_video_generations WHERE id=?',
      [fixture.jobId]
    );
    const [[reservation]] = await pool.query(
      'SELECT * FROM app_noa_reservations WHERE reservation_id=?',
      [fixture.reservationId]
    );
    const wallet = await billing.getBalance(fixture.userId);
    return { job, reservation, wallet };
  }

  async function cleanup() {
    for (const jobId of jobIds) {
      await pool.query('DELETE FROM app_ai_provider_attempts WHERE job_id=?', [jobId]);
      await pool.query('DELETE FROM app_video_generations WHERE id=?', [jobId]);
    }
    for (const userId of userIds) {
      const [wallets] = await pool.query(
        'SELECT wallet_id FROM app_noa_wallets WHERE user_id=?',
        [userId]
      );
      for (const wallet of wallets) {
        await pool.query(
          'DELETE FROM app_noa_receipts WHERE wallet_id=?',
          [wallet.wallet_id]
        );
        await pool.query(
          'DELETE FROM app_noa_transaction_logs WHERE wallet_id=?',
          [wallet.wallet_id]
        );
        await pool.query(
          'DELETE FROM app_noa_reservations WHERE wallet_id=?',
          [wallet.wallet_id]
        );
        await pool.query(
          'DELETE FROM app_noa_wallets WHERE wallet_id=?',
          [wallet.wallet_id]
        );
      }
      await pool.query('DELETE FROM app_users WHERE user_id=?', [userId]);
    }
    jobIds.clear();
    userIds.clear();
  }

  return {
    billing,
    cleanup,
    createJob,
    createUser,
    initialize,
    state
  };
}

module.exports = { createNoaVideoDbFixture };
