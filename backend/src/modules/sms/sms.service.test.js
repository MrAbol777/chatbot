const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSmsService } = require('./sms.service');

test('IPPanel failures produce readable safe logs without recipient, OTP, credentials, or raw response data', async () => {
  const logs = [];
  const providerError = new Error('Request failed');
  providerError.response = {
    status: 502,
    data: { recipient: '+989000000000', code: '12345', Authorization: 'secret-value' },
    headers: {}
  };
  const service = createSmsService({
    ippanelClient: { post: async () => { throw providerError; } },
    ippanelApiKey: 'test-secret',
    ippanelPatternCode: 'pattern',
    ippanelSender: '3000',
    logger: {
      log: (event, context) => logs.push({ level: 'log', event, context }),
      warn: (event, context) => logs.push({ level: 'warn', event, context })
    },
    setTimer: null,
    now: () => '2026-08-16T00:00:00.000Z'
  });

  const result = await service.sendVerificationCode('09123456789', '12345');

  assert.deepEqual(result, {
    success: false,
    error: 'provider_unavailable',
    details: null,
    status: 502,
    retryAfterSeconds: undefined,
    retryable: true
  });
  assert.deepEqual(logs.at(-1), {
    level: 'warn',
    event: '[2026-08-16T00:00:00.000Z] [OTP_PROVIDER] send_result',
    context: {
      provider: 'ippanel',
      operation: 'pattern_otp',
      outcome: 'failed',
      upstreamStatus: 502,
      category: 'provider_unavailable',
      retryable: true,
      retryAfterSeconds: null
    }
  });
  const serialized = JSON.stringify(logs);
  for (const secret of ['09123456789', '12345', 'test-secret', 'secret-value']) {
    assert.equal(serialized.includes(secret), false);
  }
});
