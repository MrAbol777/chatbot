const test = require('node:test');
const assert = require('node:assert/strict');

const { isImageStudioRequest, normalizeIntentForChat } = require('./ai.controller');

test('chat never dispatches image creation or edits to an image task', () => {
  assert.equal(normalizeIntentForChat('image_generation'), 'chat');
  assert.equal(normalizeIntentForChat('image_edit'), 'chat');
  assert.equal(normalizeIntentForChat('chat'), 'chat');
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
