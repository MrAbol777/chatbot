'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  collectUploadImageIds,
  createUploadOwnershipGuard,
  normalizeImageIdInput
} = require('./upload-ownership.middleware');

const IMAGE_A = '550e8400-e29b-41d4-a716-446655440000';
const IMAGE_B = '550e8400-e29b-41d4-a716-446655440001';

test('multipart imageIds accepts a plain id or a JSON array', () => {
  assert.deepEqual(normalizeImageIdInput(IMAGE_A), [IMAGE_A]);
  assert.deepEqual(normalizeImageIdInput(JSON.stringify([IMAGE_A, IMAGE_B])), [IMAGE_A, IMAGE_B]);
});

test('collectUploadImageIds also protects upload URLs carried in history', () => {
  assert.deepEqual(
    collectUploadImageIds({
      imageIds: JSON.stringify([IMAGE_A]),
      history: [{ images: [{ url: `/api/uploads/images/${IMAGE_B}` }] }]
    }),
    [IMAGE_A, IMAGE_B]
  );
});

test('ownership guard returns 404 when an authenticated user does not own a supplied image', async () => {
  const guard = createUploadOwnershipGuard({
    principalResolver: {
      resolve: async () => ({ principal: { userId: 'user-b' }, error: null })
    },
    uploadedImagesRepository: {
      areOwnedBy: async (ids, userId) => ids.length === 0 && userId === 'user-b'
    }
  });

  const req = { body: { imageIds: [IMAGE_A] } };
  const state = { statusCode: 200, payload: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(payload) { state.payload = payload; return this; }
  };
  let nextCalled = false;
  await guard(req, res, () => { nextCalled = true; });

  assert.equal(state.statusCode, 404);
  assert.deepEqual(state.payload, { error: 'IMAGE_NOT_FOUND' });
  assert.equal(nextCalled, false);
});
