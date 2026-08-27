const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationController } = require('../video-generation.controller');

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('video submit exposes only the safe Noa balance fields', async () => {
  const error = Object.assign(new Error('موجودی کافی نیست.'), {
    code: 'NOA_INSUFFICIENT_FUNDS',
    status: 402,
    details: {
      balanceNoa: '1.000000',
      requiredNoa: '2.000000',
      shortfallNoa: '1.000000',
      internalReason: 'must-not-leave-the-server'
    }
  });
  const controller = createVideoGenerationController({ submit: async () => { throw error; } });
  const res = response();

  await controller.submit({ user: { id: 'user-1' }, get: () => 'request-key', body: {} }, res);

  assert.equal(res.statusCode, 402);
  assert.deepEqual(res.body, {
    error: 'NOA_INSUFFICIENT_FUNDS',
    message: 'موجودی کافی نیست.',
    balanceNoa: '1.000000',
    requiredNoa: '2.000000',
    shortfallNoa: '1.000000'
  });
});
