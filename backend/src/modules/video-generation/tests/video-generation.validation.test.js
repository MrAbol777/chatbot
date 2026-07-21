const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmit } = require('../video-generation.schemas');
const { METIS_KLING_V25_TURBO_PRO, validateVideoModelRegistration } = require('../video-model.registry');

test('submit validation rejects an arbitrary provider model and URL input', () => {
  assert.throws(() => validateSubmit({ mode: 'text-to-video', prompt: 'x', modelKey: 'https://evil.example' }), { code: 'VIDEO_GENERATION_INVALID_PROMPT' });
  assert.throws(() => validateSubmit({ mode: 'image-to-video', prompt: 'safe prompt', modelKey: 'https://evil.example' }), { code: 'VIDEO_GENERATION_INVALID_MODEL' });
});

test('submit validation only accepts an internal model key', () => {
  const value = validateSubmit({ mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'approved_model', aspectRatio: '16:9', duration: '4', quality: 'standard' });
  assert.equal(value.modelKey, 'approved_model');
});

test('submit validation rejects both start_image spellings while I2V is disabled', () => {
  for (const field of ['start_image', 'startImage']) {
    assert.throws(() => validateSubmit({ mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'approved_model', [field]: 'image-reference' }), { code: 'VIDEO_GENERATION_IMAGE_INPUT_DISABLED' });
  }
});

test('the inactive Metis Kling registry entry retains only verified model options', () => {
  const model = validateVideoModelRegistration(METIS_KLING_V25_TURBO_PRO);
  assert.equal(model.providerModelId, 'kling-v2.5-turbo-pro');
  assert.equal(model.upstreamVendor, 'kwaivgi');
  assert.equal(model.upstreamOperation, 'Video Generation');
  assert.deepEqual(model.allowedDurations, [5, 10]);
  assert.deepEqual(model.allowedAspectRatios, ['16:9', '9:16', '1:1']);
  assert.deepEqual(model.allowedQualities, []);
  assert.equal(model.maxPromptLength, null);
  assert.equal(model.isActive, false);
  assert.equal(model.supportsImageToVideo, false);
  assert.equal(model.upstreamSupportsStartImage, true);
});
