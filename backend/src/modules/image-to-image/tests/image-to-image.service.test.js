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
    storage: {
      saveInput: async (_jobId, index, file) => ({ key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'a'.repeat(64) }),
      removeJob: async () => {}
    },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30 }
  });
  const result = await service.submit({ userId: 'user-1', idempotencyKey: 'request-123', input: { prompt: 'لباس را آبی کن', aspectRatio: '1:1' }, files: [{ mimetype: 'image/png', buffer: Buffer.from('input') }] });
  assert.equal(result.status, 'queued');
  assert.equal(received.reservationInput.actionKey, 'image_to_image');
  assert.equal(received.reservationInput.referenceType, 'image_to_image');
});

test('removes staged inputs when reservation creation fails', async () => {
  const removed = [];
  const service = createImageToImageService({
    repository: {
      findIdempotent: async () => null,
      createWithReservation: async () => { throw Object.assign(new Error('db unavailable'), { code: 'DB_DOWN' }); }
    },
    storage: {
      saveInput: async (_jobId, index, file) => ({ key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'b'.repeat(64) }),
      removeJob: async (jobId) => { removed.push(jobId); }
    },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30 }
  });

  await assert.rejects(
    service.submit({ userId: 'user-1', idempotencyKey: 'request-cleanup-123', input: { prompt: 'پس زمینه را عوض کن', aspectRatio: '1:1' }, files: [{ mimetype: 'image/png', buffer: Buffer.from('input') }] }),
    (error) => error?.code === 'DB_DOWN'
  );
  assert.equal(removed.length, 1);
  assert.match(removed[0], /^[0-9a-f-]{36}$/i);
});

test('removes partially staged inputs when a later file save fails', async () => {
  const removed = [];
  let saveCalls = 0;
  const service = createImageToImageService({
    repository: {
      findIdempotent: async () => null,
      createWithReservation: async () => { throw new Error('should not be reached'); }
    },
    storage: {
      saveInput: async (_jobId, index, file) => {
        saveCalls += 1;
        if (index === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        return { key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'c'.repeat(64) };
      },
      removeJob: async (jobId) => { removed.push(jobId); }
    },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30 }
  });

  await assert.rejects(
    service.submit({ userId: 'user-1', idempotencyKey: 'request-cleanup-456', input: { prompt: 'ویرایش کن', aspectRatio: '1:1' }, files: [
      { mimetype: 'image/png', buffer: Buffer.from('one') },
      { mimetype: 'image/png', buffer: Buffer.from('two') }
    ] }),
    (error) => error?.code === 'ENOSPC'
  );
  assert.equal(saveCalls, 2);
  assert.equal(removed.length, 1);
});
