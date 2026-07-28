'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { DatabaseClient } = require('../../../repositories/DatabaseClient');
const { createNoaBillingService } = require('../noa-billing.service');
const { createNoaReceiptService } = require('../noa-receipt.service');
const { createNoaRepository } = require('../noa.repository');
const { ensureNoaSchema } = require('../noa.schema');
const { multiplyFixed, parseFixed } = require('../fixed-point');

let db;
let repository;
let billing;
let receipts;
const userIds = new Set();

function fixtureId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function createUser(prefix = 'noa-user') {
  const userId = fixtureId(prefix);
  userIds.add(userId);
  await db.query(
    'INSERT INTO app_users (user_id,name,age,registered_at) VALUES (?,?,?,NOW())',
    [userId, 'Noa Integration Test', 20]
  );
  return userId;
}

async function cleanupUser(userId) {
  const [wallets] = await db.query(
    'SELECT wallet_id FROM app_noa_wallets WHERE user_id=?',
    [userId]
  );
  for (const wallet of wallets) {
    await db.query('DELETE FROM app_noa_receipts WHERE wallet_id=?', [wallet.wallet_id]);
    await db.query('DELETE FROM app_noa_transaction_logs WHERE wallet_id=?', [wallet.wallet_id]);
    await db.query('DELETE FROM app_noa_reservations WHERE wallet_id=?', [wallet.wallet_id]);
    await db.query('DELETE FROM app_noa_wallets WHERE wallet_id=?', [wallet.wallet_id]);
  }
  await db.query('DELETE FROM app_users WHERE user_id=?', [userId]);
}

test.before(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Noa integration tests.');
  db = new DatabaseClient({ databaseUrl: process.env.DATABASE_URL });
  await db.init();
  await ensureNoaSchema(db);
  repository = createNoaRepository(db);
  billing = createNoaBillingService({ repository });
  receipts = createNoaReceiptService({ repository, billingService: billing });
});

test.afterEach(async () => {
  for (const userId of [...userIds]) {
    await cleanupUser(userId);
    userIds.delete(userId);
  }
});

test.after(async () => {
  await db.close();
});

test('new authenticated users receive independent zero-balance wallets', async () => {
  const first = await createUser('noa-zero-a');
  const second = await createUser('noa-zero-b');
  const [firstWallet, secondWallet] = await Promise.all([
    billing.getBalance(first),
    billing.getBalance(second)
  ]);
  assert.equal(firstWallet.availableNoa, '0.000000');
  assert.equal(firstWallet.reservedNoa, '0.000000');
  assert.equal(secondWallet.availableNoa, '0.000000');
  assert.notEqual(firstWallet.walletId, secondWallet.walletId);
});

test('quotes read the current database price and multiply video seconds exactly', async () => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE app_noa_pricing_configs SET unit_price='1.234567',version=version+1 WHERE action_key='video_generation'"
    );
    const quote = await billing.quote(
      { actionKey: 'video_generation', quantity: '3' },
      { connection }
    );
    assert.equal(quote.unitPriceNoa, '1.234567');
    assert.equal(quote.amountNoa, '3.703701');
    await connection.rollback();
  } finally {
    connection.release();
  }
});

test('two concurrent reservations cannot double-spend one image balance', async () => {
  const userId = await createUser('noa-race');
  const quote = await billing.quote({ actionKey: 'image_generation', quantity: '1' });
  await billing.credit({
    userId,
    amountNoa: quote.amountNoa,
    entryType: 'test_credit',
    referenceType: 'test_fixture',
    referenceId: fixtureId('credit'),
    idempotencyKey: fixtureId('credit-key'),
    payloadHash: { quote },
    actorType: 'system',
    actorId: 'noa-test'
  });

  const attempts = [1, 2].map((number) => billing.reserve({
    userId,
    actionKey: 'image_generation',
    quantity: '1',
    idempotencyKey: fixtureId(`reserve-${number}`),
    payloadHash: { number },
    referenceType: 'image_generation',
    referenceId: fixtureId(`image-${number}`),
    expiresAt: new Date(Date.now() + 60_000),
    actorType: 'user',
    actorId: userId
  }));
  const results = await Promise.allSettled(attempts);
  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'NOA_INSUFFICIENT_FUNDS');
  assert.equal(rejected[0].reason.status, 402);

  let wallet = await billing.getBalance(userId);
  assert.equal(wallet.availableNoa, '0.000000');
  assert.equal(wallet.reservedNoa, quote.amountNoa);
  await billing.capture(fulfilled[0].value.reservationId, {
    actorType: 'system',
    actorId: 'noa-test'
  });
  wallet = await billing.getBalance(userId);
  assert.equal(wallet.availableNoa, '0.000000');
  assert.equal(wallet.reservedNoa, '0.000000');

  const [[negative]] = await db.query(
    'SELECT COUNT(*) AS total FROM app_noa_wallets WHERE user_id=? AND (available_balance<0 OR reserved_balance<0)',
    [userId]
  );
  assert.equal(Number(negative.total), 0);
});

test('reservation replay and release are idempotent while payload conflicts fail closed', async () => {
  const userId = await createUser('noa-idempotency');
  const quote = await billing.quote({ actionKey: 'text_chat', quantity: '1' });
  await billing.credit({
    userId,
    amountNoa: quote.amountNoa,
    entryType: 'test_credit',
    referenceType: 'test_fixture',
    referenceId: fixtureId('credit'),
    idempotencyKey: fixtureId('credit-key'),
    payloadHash: { quote },
    actorType: 'system',
    actorId: 'noa-test'
  });
  const idempotencyKey = fixtureId('chat-key');
  const referenceId = fixtureId('turn');
  const input = {
    userId,
    actionKey: 'text_chat',
    quantity: '1',
    idempotencyKey,
    payloadHash: { message: 'hello' },
    referenceType: 'chat_turn',
    referenceId,
    actorType: 'user',
    actorId: userId
  };
  const first = await billing.reserve(input);
  const replay = await billing.reserve(input);
  assert.equal(replay.reservationId, first.reservationId);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    billing.reserve({ ...input, payloadHash: { message: 'different' } }),
    { code: 'NOA_IDEMPOTENCY_CONFLICT', status: 409 }
  );

  const released = await billing.release(first.reservationId, {
    reason: 'provider_failure',
    actorType: 'system'
  });
  const releasedReplay = await billing.release(first.reservationId, {
    reason: 'provider_failure',
    actorType: 'system'
  });
  assert.equal(released.changed, true);
  assert.equal(releasedReplay.replayed, true);
  const wallet = await billing.getBalance(userId);
  assert.equal(wallet.availableNoa, quote.amountNoa);
  assert.equal(wallet.reservedNoa, '0.000000');

  const [[logs]] = await db.query(
    "SELECT COUNT(*) AS total FROM app_noa_transaction_logs l JOIN app_noa_wallets w ON w.wallet_id=l.wallet_id WHERE w.user_id=? AND l.reservation_id=?",
    [userId, first.reservationId]
  );
  assert.equal(Number(logs.total), 2);
});

test('receipt approval uses the locked DB rate, credits once, and audits manual override', async () => {
  const userId = await createUser('noa-receipt');
  const config = await billing.getConfig();
  const rate = parseFixed(config.exchangeRate.tomanPerNoa, {
    scale: 6,
    allowZero: false
  });
  const twoAndHalf = parseFixed('2.5', { scale: 6, allowZero: false });
  const verifiedToman = multiplyFixed(rate, twoAndHalf, 2).value;
  const fileSha256 = crypto.createHash('sha256').update('receipt-one').digest();

  const submitted = await receipts.submit({
    userId,
    transferReference: fixtureId('bank-transfer'),
    declaredToman: verifiedToman,
    idempotencyKey: fixtureId('receipt-key'),
    storageKey: `receipts/${fixtureId('receipt')}.jpg`,
    originalFileName: 'receipt.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    fileSha256
  });
  assert.equal(submitted.status, 'pending');
  const approved = await receipts.approve({
    receiptId: submitted.receiptId,
    adminId: 'finance-test',
    verifiedToman,
    reviewReason: 'bank statement matched'
  });
  assert.equal(approved.calculatedNoa, '2.500000');
  assert.equal(approved.approvedNoa, '2.500000');
  assert.equal(approved.manualOverride, false);
  const replay = await receipts.approve({
    receiptId: submitted.receiptId,
    adminId: 'finance-test',
    verifiedToman,
    reviewReason: 'replay'
  });
  assert.equal(replay.replayed, true);
  assert.equal((await billing.getBalance(userId)).availableNoa, '2.500000');

  const manual = await receipts.submit({
    userId,
    transferReference: fixtureId('bank-transfer'),
    declaredToman: multiplyFixed(rate, parseFixed('1', { scale: 6 }), 2).value,
    idempotencyKey: fixtureId('receipt-key'),
    storageKey: `receipts/${fixtureId('receipt')}.png`,
    originalFileName: 'receipt.png',
    mimeType: 'image/png',
    sizeBytes: 64,
    fileSha256: crypto.createHash('sha256').update('receipt-two').digest()
  });
  await assert.rejects(
    receipts.approve({
      receiptId: manual.receiptId,
      adminId: 'superadmin-test',
      verifiedToman: multiplyFixed(rate, parseFixed('1', { scale: 6 }), 2).value,
      approvedNoa: '1.250000'
    }),
    { code: 'NOA_OVERRIDE_REASON_REQUIRED', status: 400 }
  );
  const overridden = await receipts.approve({
    receiptId: manual.receiptId,
    adminId: 'superadmin-test',
    verifiedToman: multiplyFixed(rate, parseFixed('1', { scale: 6 }), 2).value,
    approvedNoa: '1.250000',
    overrideReason: 'verified promotional adjustment',
    reviewReason: 'approved by superadmin'
  });
  assert.equal(overridden.manualOverride, true);
  assert.equal(overridden.overrideReason, 'verified promotional adjustment');
  assert.equal((await billing.getBalance(userId)).availableNoa, '3.750000');
});

test('a receipt image can be submitted without a user transaction ID or a declared amount', async () => {
  const userId = await createUser('noa-image-only-receipt');
  const submitted = await receipts.submit({
    userId,
    idempotencyKey: fixtureId('receipt-key'),
    storageKey: `receipts/${fixtureId('receipt')}.png`,
    originalFileName: 'receipt.png',
    mimeType: 'image/png',
    sizeBytes: 64,
    fileSha256: crypto.createHash('sha256').update('receipt-image-only').digest()
  });

  assert.equal(submitted.status, 'pending');
  assert.equal(submitted.declaredToman, null);
  assert.equal(Object.hasOwn(submitted, 'transferReference'), false);

  const [[stored]] = await db.query(
    'SELECT declared_toman, transfer_reference FROM app_noa_receipts WHERE receipt_id=?',
    [submitted.receiptId]
  );
  assert.equal(stored.declared_toman, null);
  assert.match(String(stored.transfer_reference), /^receipt:/);
});

test('rejected receipts cannot later credit a wallet', async () => {
  const userId = await createUser('noa-rejected-receipt');
  const submitted = await receipts.submit({
    userId,
    transferReference: fixtureId('bank-transfer'),
    declaredToman: '10000',
    idempotencyKey: fixtureId('receipt-key'),
    storageKey: `receipts/${fixtureId('receipt')}.webp`,
    originalFileName: 'receipt.webp',
    mimeType: 'image/webp',
    sizeBytes: 64,
    fileSha256: crypto.createHash('sha256').update('receipt-rejected').digest()
  });
  const rejected = await receipts.reject({
    receiptId: submitted.receiptId,
    adminId: 'finance-test',
    reason: 'transaction not found'
  });
  assert.equal(rejected.status, 'rejected');
  await assert.rejects(
    receipts.approve({
      receiptId: submitted.receiptId,
      adminId: 'finance-test',
      verifiedToman: '10000'
    }),
    { code: 'NOA_RECEIPT_ALREADY_REVIEWED', status: 409 }
  );
  assert.equal((await billing.getBalance(userId)).availableNoa, '0.000000');
});
