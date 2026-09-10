'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageToImageService } = require('../image-to-image.service');

const compiled = (userPrompt) => ({
  compilerVersion: 'test-i2i-v1', systemPromptVersion: 'test-policy-v1', systemPromptHash: 'a'.repeat(64),
  assemblyMode: 'full', includedTiers: ['CORE', 'FIDELITY', 'QUALITY'], userPrompt,
  userPromptHash: 'b'.repeat(64), compiledPrompt: `[SYSTEM]\n${userPrompt}`, compiledPromptHash: 'c'.repeat(64),
  systemChars: 8, userChars: userPrompt.length, finalChars: userPrompt.length + 9, providerPromptLimit: 8000
});

test('submits image-to-image jobs with their own Noa action', async () => {
  let received = null;
  const service = createImageToImageService({
    repository: {
      findIdempotent: async () => null,
      createWithReservation: async (value) => { received = value; return { ...value.job, status: 'queued', created_at: new Date(), updated_at: new Date() }; }
    },
    storage: { saveInput: async (_jobId, index, file) => ({ key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'a'.repeat(64) }) },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30, maxPromptLength: 8000 },
    imageToImagePromptCompiler: { compile: ({ userPrompt }) => compiled(userPrompt) }
  });
  const result = await service.submit({ userId: 'user-1', idempotencyKey: 'request-123', input: { prompt: 'لباس را آبی کن', aspectRatio: '1:1' }, files: [{ mimetype: 'image/png', buffer: Buffer.from('input') }] });
  assert.equal(result.status, 'queued');
  assert.equal(received.reservationInput.actionKey, 'image_to_image');
  assert.equal(received.reservationInput.referenceType, 'image_to_image');
  assert.equal(received.job.userPrompt, 'لباس را آبی کن');
  assert.equal(received.job.compiledPrompt, '[SYSTEM]\nلباس را آبی کن');
  assert.equal(received.job.promptSnapshot.userPromptHash, 'b'.repeat(64));
});

test('preserves every user-prompt character before handing it to the compiler', async () => {
  let compilerInput = null;
  const service = createImageToImageService({
    repository: { findIdempotent: async () => null, createWithReservation: async ({ job }) => ({ ...job, status: 'queued', created_at: new Date(), updated_at: new Date() }) },
    storage: { saveInput: async (_jobId, index, file) => ({ key: `input/${index}.png`, sizeBytes: file.buffer.length, sha256: 'a'.repeat(64) }) },
    noaBillingService: { quote: async () => ({ amountNoa: '1.700000' }) },
    config: { enabled: true, model: 'nano-banana', jobTimeoutMinutes: 30, maxPromptLength: 8000 },
    imageToImagePromptCompiler: { compile: ({ userPrompt }) => { compilerInput = userPrompt; return compiled(userPrompt); } }
  });
  const rawPrompt = '  لباس را آبی کن\nو لوگو را حفظ کن  ';
  await service.submit({ userId: 'user-1', idempotencyKey: 'request-456', input: { prompt: rawPrompt, aspectRatio: '1:1' }, files: [{ mimetype: 'image/png', buffer: Buffer.from('input') }] });
  assert.equal(compilerInput, rawPrompt);
});
