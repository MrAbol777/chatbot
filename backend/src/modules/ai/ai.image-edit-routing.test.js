const test = require('node:test');
const assert = require('node:assert/strict');

const { isImageStudioRequest, normalizeIntentForChat } = require('./ai.controller');

test('final-action intents keep their own route and anything else falls back to chat', () => {
  // Billing is applied once by the module that performs the action, so these
  // intents must not be collapsed into plain chat.
  assert.equal(normalizeIntentForChat('image_generation'), 'image_generation');
  assert.equal(normalizeIntentForChat('image_edit'), 'image_edit');
  assert.equal(normalizeIntentForChat('video_generation'), 'video_generation');
  assert.equal(normalizeIntentForChat('chat'), 'chat');
  assert.equal(normalizeIntentForChat('something_else'), 'chat');
  assert.equal(normalizeIntentForChat(undefined), 'chat');
});

test('image analysis remains on the image-understanding pipeline', () => {
  assert.equal(normalizeIntentForChat('image_understanding'), 'image_understanding');
});

test('sends image creation and edits to Image Studio instead of a chat image task', () => {
  assert.equal(isImageStudioRequest('یه تصویر از یک قلعه بساز'), true);
  assert.equal(isImageStudioRequest('برام یه عکس از گربه بزن'), true);
  assert.equal(isImageStudioRequest('/imagine a city at night'), true);
  assert.equal(isImageStudioRequest('پس زمینه این عکس رو عوض کن'), true);
  assert.equal(isImageStudioRequest('من رو کنار یک فضانورد بزار', { hasCurrentImageAttachment: true }), true);
  assert.equal(isImageStudioRequest('موهاش رو بلندتر کن', { hasCurrentImageAttachment: true }), true);
  assert.equal(isImageStudioRequest('یک داستان دربارهٔ قلعه بساز'), false);
  assert.equal(isImageStudioRequest('متن روی این عکس رو بخون', { hasCurrentImageAttachment: true }), false);
});
