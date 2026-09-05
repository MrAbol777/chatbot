'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAuthRepository } = require('./auth.repository');

test('OTP verification requires an exact code and rejects suffix-compatible candidates', async () => {
  const repository = createAuthRepository({
    otpExpireSeconds: 120,
    logger: { log: () => {} }
  });

  await repository.saveOtp('09123456789', '12345');
  const suffixAttempt = await repository.verifyOtp('09123456789', '9912345');
  assert.equal(suffixAttempt.valid, false);
  assert.equal(suffixAttempt.reason, 'invalid_code');

  const exactAttempt = await repository.verifyOtp('09123456789', '12345');
  assert.deepEqual(exactAttempt, { valid: true });
});

test('successful OTP verification consumes the code', async () => {
  const repository = createAuthRepository({
    otpExpireSeconds: 120,
    logger: { log: () => {} }
  });

  await repository.saveOtp('09123456789', '54321');
  assert.equal((await repository.verifyOtp('09123456789', '54321')).valid, true);
  assert.equal((await repository.verifyOtp('09123456789', '54321')).reason, 'not_found');
});
