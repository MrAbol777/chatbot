'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM_PROVIDER, CONFIRM_COST, checkBananaAiLivePreconditions } = require('../../../../scripts/bananaai-video-live-preconditions');
const { main } = require('../../../../scripts/test-bananaai-video-live');

const validEnv = { BANANAAI_LIVE_CONFIRM_PROVIDER: CONFIRM_PROVIDER, BANANAAI_LIVE_CONFIRM_COST: CONFIRM_COST, BANANAAI_API_KEY: 'fake', BANANAAI_LIVE_MODEL: 'grok-imagine-video', BANANAAI_LIVE_PROMPT: 'fixture', BANANAAI_LIVE_IMAGE_URL: 'https://media.example.test/input.jpg', BANANAAI_LIVE_DURATION: '5', BANANAAI_LIVE_RESOLUTION: '720p', BANANAAI_LIVE_ASPECT_RATIO: '16:9' };

test('BananaAI live script is blocked by default and permits only one Grok submit', () => {
  const blocked = checkBananaAiLivePreconditions({});
  assert.equal(blocked.ok, false); assert.equal(blocked.maximumExternalRequests, 1); assert.ok(blocked.missing.length >= 7);
  const ready = checkBananaAiLivePreconditions(validEnv);
  assert.deepEqual(ready, { ok: true, missing: [], model: 'grok-imagine-video', maximumExternalRequests: 1 });
  assert.equal(checkBananaAiLivePreconditions({ ...validEnv, BANANAAI_LIVE_MODEL: 'seedance-2' }).ok, false);
  assert.equal(checkBananaAiLivePreconditions({ ...validEnv, BANANAAI_LIVE_IMAGE_URL: 'http://127.0.0.1/input.jpg' }).ok, false);
});

test('the guarded live script targets Image-to-Video and includes exactly one explicit image URL', async () => {
  const calls = [];
  const result = await main({ env: validEnv, httpClient: { post: async (...args) => { calls.push(args); return { data: { id: 'task_fixture' } }; } } });
  assert.deepEqual(result, { executed: true, externalRequests: 1 });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0][0]).pathname, '/api/v1/videos/image-to-video');
  assert.deepEqual(calls[0][1].image_urls, [validEnv.BANANAAI_LIVE_IMAGE_URL]);
});
