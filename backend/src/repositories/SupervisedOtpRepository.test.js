'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SupervisedOtpRepository } = require('./SupervisedOtpRepository');

const createDb = () => ({
  init: async () => {},
  query: async (sql) => {
    if (String(sql).includes('SELECT * FROM app_supervised_otp_config')) {
      return [[{
        id: 'default',
        enabled: 0,
        code_hash: null,
        expires_at: null,
        max_uses: null,
        used_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      }]];
    }
    return [{ affectedRows: 1 }];
  }
});

test('supervised OTP cannot be enabled in production', async () => {
  const repository = new SupervisedOtpRepository(createDb(), { env: { NODE_ENV: 'production' } });
  await assert.rejects(
    repository.updateConfig({ enabled: true, code: '1234' }),
    (error) => error?.code === 'SUPERVISED_OTP_PRODUCTION_DISABLED' && error?.statusCode === 409
  );
});

test('supervised OTP verification always fails closed in production', async () => {
  const repository = new SupervisedOtpRepository(createDb(), { env: { NODE_ENV: 'production' } });
  const result = await repository.verifyAndConsume('1234');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'production_disabled');
});
