const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('./auth.service');

function createService({ requestState = { allowed: true }, smsResult }) {
  const savedOtps = [];
  const service = createAuthService({
    authRepository: {
      checkAndRecordOtpRequest: async () => requestState,
      saveOtp: async (phone, code) => {
        savedOtps.push({ phone, code });
        return { expiresIn: 120 };
      }
    },
    smsService: {
      generateOtp: () => '12345',
      sendVerificationCode: async () => smsResult
    },
    logger: {
      log() {},
      warn() {}
    }
  });

  return { service, savedOtps };
}

test('sendVerificationCode exposes provider rate limit with retry metadata', async () => {
  const { service, savedOtps } = createService({
    smsResult: { success: false, status: 429, retryAfterSeconds: 37 }
  });

  const result = await service.sendVerificationCode({ phone: '09123456789', mode: 'login' });

  assert.equal(result.statusCode, 429);
  assert.equal(result.body.code, 'OTP_PROVIDER_RATE_LIMITED');
  assert.equal(result.body.retryAfterSeconds, 37);
  assert.equal(savedOtps.length, 0);
});

test('sendVerificationCode maps provider failures to service unavailable', async () => {
  const { service, savedOtps } = createService({
    smsResult: { success: false, status: 500 }
  });

  const result = await service.sendVerificationCode({ phone: '09123456789', mode: 'signup' });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'OTP_PROVIDER_UNAVAILABLE');
  assert.equal(savedOtps.length, 0);
});

test('sendVerificationCode returns the local retry window without contacting provider', async () => {
  let providerCalled = false;
  const service = createAuthService({
    authRepository: {
      checkAndRecordOtpRequest: async () => ({ allowed: false, retryAfterSeconds: 12 })
    },
    smsService: {
      sendVerificationCode: async () => {
        providerCalled = true;
        return { success: true };
      }
    },
    logger: { log() {}, warn() {} }
  });

  const result = await service.sendVerificationCode({ phone: '09123456789', mode: 'login' });

  assert.equal(result.statusCode, 429);
  assert.equal(result.body.retryAfterSeconds, 12);
  assert.equal(providerCalled, false);
});

test('sendVerificationCode stores OTP only after a successful send', async () => {
  const { service, savedOtps } = createService({
    smsResult: { success: true, status: 200 }
  });

  const result = await service.sendVerificationCode({ phone: '09123456789', mode: 'login' });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(savedOtps, [{ phone: '09123456789', code: '12345' }]);
});
