'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  divideFixed,
  multiplyFixed,
  parseFixed
} = require('../fixed-point');
const { walletAdjustmentInput, requireFinancialAdmin } = require('../noa.admin.routes');
const { normalizeQuantity } = require('../noa-billing.service');
const { PAYMENT_GATEWAY_ENABLED, createPaymentGatewaySkeleton } = require('../payment-gateway');
const {
  LEGACY_GIFT_NOA,
  isActiveSubscription
} = require('../../../../scripts/apply-noa-migration');

test('fixed-point math calculates exact Noa and Toman values without floating point', () => {
  const price = parseFixed('0.800000', { scale: 6, allowZero: false });
  const duration = parseFixed('15', { scale: 6, allowZero: false });
  const total = multiplyFixed(price, duration, 6);
  assert.equal(total.value, '12.000000');

  const toman = parseFixed('25000', { scale: 2, allowZero: false });
  const rate = parseFixed('10000', { scale: 6, allowZero: false });
  assert.equal(divideFixed(toman, rate, 6).value, '2.500000');
});

test('action quantities reject fractional video/image-analysis durations and multi-charge image/chat inputs', () => {
  assert.equal(normalizeQuantity('video_generation', '12').value, '12.000000');
  assert.throws(
    () => normalizeQuantity('video_generation', '1.5'),
    { code: 'NOA_INVALID_VIDEO_DURATION', status: 400 }
  );
  assert.equal(normalizeQuantity('image_understanding', '2').value, '2.000000');
  assert.throws(
    () => normalizeQuantity('image_understanding', '1.5'),
    { code: 'NOA_INVALID_IMAGE_COUNT', status: 400 }
  );
  assert.throws(
    () => normalizeQuantity('image_generation', '2'),
    { code: 'NOA_INVALID_QUANTITY', status: 400 }
  );
  assert.throws(
    () => normalizeQuantity('text_chat', '0'),
    { code: 'NOA_INVALID_DECIMAL', status: 400 }
  );
});

test('financial middleware permits only finance and superadmin roles', () => {
  for (const role of ['finance', 'superadmin', ' FINANCE ']) {
    let nextCalled = false;
    const req = { admin: { role } };
    const res = {
      status() { throw new Error('authorized role was rejected'); }
    };
    requireFinancialAdmin(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }

  for (const role of ['', 'admin', 'support', 'editor']) {
    const response = { statusCode: 200, body: null };
    const res = {
      status(code) { response.statusCode = code; return this; },
      json(body) { response.body = body; return this; }
    };
    let nextCalled = false;
    requireFinancialAdmin({ admin: { role } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'NOA_FINANCE_ROLE_REQUIRED');
  }
});

test('admin wallet adjustment requires a selected user, direction, and idempotency key', () => {
  const req = {
    body: { userId: 'user-1', amountNoa: '300', direction: 'decrease', note: 'کسر آزمایشی' },
    get(name) { return name === 'Idempotency-Key' ? 'wallet-adjustment-key-1' : ''; }
  };
  const input = walletAdjustmentInput(req);
  assert.equal(input.userId, 'user-1');
  assert.equal(input.amountNoa, '300');
  assert.equal(input.direction, 'decrease');
  assert.equal(input.note, 'کسر آزمایشی');
  assert.match(input.referenceId, /^manual-credit:[a-f0-9]{64}$/);

  assert.throws(
    () => walletAdjustmentInput({ body: { amountNoa: '300', direction: 'increase' }, get: () => 'key' }),
    { code: 'NOA_MANUAL_CREDIT_USER_REQUIRED', status: 400 }
  );
  assert.throws(
    () => walletAdjustmentInput({ body: { userId: 'user-1', amountNoa: '300', direction: 'other' }, get: () => 'key' }),
    { code: 'NOA_INVALID_ADJUSTMENT_DIRECTION', status: 400 }
  );
  assert.throws(
    () => walletAdjustmentInput({ body: { userId: 'user-1', amountNoa: '300', direction: 'increase' }, get: () => '' }),
    { code: 'NOA_INVALID_FIELD', status: 400 }
  );
});

test('payment gateway skeleton is structurally present and immutably disabled', async () => {
  assert.equal(PAYMENT_GATEWAY_ENABLED, false);
  const gateway = createPaymentGatewaySkeleton();
  assert.equal(gateway.enabled, false);
  await assert.rejects(gateway.createTopUp(), { code: 'NOA_PAYMENT_GATEWAY_DISABLED' });
  await assert.rejects(gateway.handleCallback(), { code: 'NOA_PAYMENT_GATEWAY_DISABLED' });
});

test('legacy conversion gift and active-subscription classification are exact', () => {
  assert.equal(LEGACY_GIFT_NOA, '5.000000');
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  assert.equal(isActiveSubscription({ status: 'active', expiresAt: null }, now), true);
  assert.equal(isActiveSubscription({ status: 'active', expiresAt: '2026-07-28T00:00:00.000Z' }, now), true);
  assert.equal(isActiveSubscription({ status: 'active', expiresAt: '2026-07-26T00:00:00.000Z' }, now), false);
  assert.equal(isActiveSubscription({ status: 'cancelled', expiresAt: null }, now), false);
});
