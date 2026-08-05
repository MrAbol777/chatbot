const test = require('node:test');
const assert = require('node:assert/strict');

const { createImageUnderstandingController } = require('./image-understanding.controller');

const response = () => ({
  locals: { requestId: 'vision-test-1' },
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; }
});

const request = () => ({
  body: {
    prompt: 'این تصویر را توضیح بده',
    images: [{ id: 'image-1', base64: 'ZmFrZQ==', mimeType: 'image/png' }]
  },
  headers: { 'idempotency-key': 'vision-test-1' },
  files: []
});

test('standalone image analysis reserves and captures the configured per-image Noa price', async () => {
  const calls = [];
  const controller = createImageUnderstandingController({
    principalResolver: { resolve: async () => ({ principal: { userId: 'user-1' }, error: null }) },
    noaBillingService: {
      reserve: async (input) => { calls.push(['reserve', input]); return { reservationId: 'reservation-1', status: 'reserved' }; },
      capture: async (id, input) => { calls.push(['capture', id, input]); return { reservationId: id, status: 'captured' }; },
      release: async () => { calls.push(['release']); }
    },
    imageUnderstandingService: {
      analyzeImages: async () => ({ answer: 'توضیح تصویر', model: 'vision-test', diagnostics: {} })
    }
  });

  const res = response();
  await controller.analyze(request(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.reply, 'توضیح تصویر');
  assert.equal(calls[0][0], 'reserve');
  assert.equal(calls[0][1].actionKey, 'image_understanding');
  assert.equal(calls[0][1].quantity, 1);
  assert.equal(calls[0][1].referenceType, 'image_analysis');
  assert.equal(calls[1][0], 'capture');
  assert.equal(calls.some(([name]) => name === 'release'), false);
});

test('failed standalone image analysis releases its Noa reservation', async () => {
  const calls = [];
  const controller = createImageUnderstandingController({
    principalResolver: { resolve: async () => ({ principal: { userId: 'user-1' }, error: null }) },
    noaBillingService: {
      reserve: async () => ({ reservationId: 'reservation-1', status: 'reserved' }),
      capture: async () => { throw new Error('must not capture'); },
      release: async (id, input) => { calls.push([id, input]); }
    },
    imageUnderstandingService: {
      analyzeImages: async () => { const error = new Error('VISION_TIMEOUT'); error.code = 'VISION_TIMEOUT'; throw error; }
    }
  });

  const res = response();
  await controller.analyze(request(), res);

  assert.equal(res.statusCode, 504);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'reservation-1');
  assert.equal(calls[0][1].reason, 'image_analysis_failed');
});

test('standalone image analysis does not call AI when the configured Noa price cannot be reserved', async () => {
  let analyzed = false;
  const insufficient = Object.assign(new Error('NOA_INSUFFICIENT_FUNDS'), {
    code: 'NOA_INSUFFICIENT_FUNDS',
    statusCode: 402
  });
  const controller = createImageUnderstandingController({
    principalResolver: { resolve: async () => ({ principal: { userId: 'user-1' }, error: null }) },
    noaBillingService: {
      reserve: async () => { throw insufficient; },
      capture: async () => undefined,
      release: async () => undefined
    },
    imageUnderstandingService: { analyzeImages: async () => { analyzed = true; } }
  });

  const res = response();
  await controller.analyze(request(), res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'NOA_INSUFFICIENT_FUNDS');
  assert.equal(analyzed, false);
});

test('standalone image analysis rejects unauthenticated callers before reserving Noa or calling AI', async () => {
  let reserved = false;
  let analyzed = false;
  const controller = createImageUnderstandingController({
    principalResolver: { resolve: async () => ({ principal: null, error: null }) },
    noaBillingService: {
      reserve: async () => { reserved = true; },
      capture: async () => undefined,
      release: async () => undefined
    },
    imageUnderstandingService: { analyzeImages: async () => { analyzed = true; } }
  });

  const res = response();
  await controller.analyze(request(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(reserved, false);
  assert.equal(analyzed, false);
});
