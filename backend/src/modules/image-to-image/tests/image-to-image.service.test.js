'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageToImageService } = require('../image-to-image.service');

test('submits image-to-image jobs with their own Noa action', async () => {
  let received = null;
  const service = createImageToImageService({
    repository: {
      findIdempotent: async () => null,
      createWithReservation: async (value) => { received = value; return { ...value.job, status: 'queued', created_at: new Date(), updated_at: new Date() }; }
    },
    storage: { saveInput: async (_jobId, index, file) => ({ key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'a'.repeat(64) }) },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30 }
  });
  const result = await service.submit({ userId: 'user-1', idempotencyKey: 'request-123', input: { prompt: 'لباس را آبی کن', aspectRatio: '1:1' }, files: [{ mimetype: 'image/png', buffer: Buffer.from('input') }] });
  assert.equal(result.status, 'queued');
  assert.equal(received.reservationInput.actionKey, 'image_to_image');
  assert.equal(received.reservationInput.referenceType, 'image_to_image');
});
