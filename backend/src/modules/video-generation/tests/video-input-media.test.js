'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoProviderInputGateway } = require('../input-media/video-provider-input.gateway');
const { createVideoInputMediaRepository } = require('../input-media/video-input-media.repository');
const { validateVideoInputImage } = require('../input-media/video-input-media.validator');

test('provider input token is opaque, attempt-bound and HMAC authenticated', () => {
  let now = 1_800_000_000_000;
  const gateway = createVideoProviderInputGateway({ secret: 'fixture-secret-that-is-longer-than-thirty-two-characters', publicBaseUrl: 'http://127.0.0.1:3000', ttlSeconds: 60, clock: () => now });
  const url = gateway.createUrl({ mediaId: 'media-secret-id', jobId: 'job-secret-id', attemptId: 'attempt-secret-id', mimeType: 'image/png' });
  assert.equal(url.includes('media-secret-id'), false);
  assert.equal(url.includes('job-secret-id'), false);
  const parts = new URL(url).pathname.split('/');
  const token = parts.at(-2);
  assert.equal(parts.at(-1), 'input.png');
  const claims = gateway.verify(token);
  assert.equal(claims.mediaId, 'media-secret-id');
  assert.equal(claims.jobId, 'job-secret-id');
  assert.equal(claims.attemptId, 'attempt-secret-id');
  assert.equal(claims.filename, 'input.png');
  const replacement = token.endsWith('x') ? 'y' : 'x';
  assert.throws(() => gateway.verify(`${token.slice(0, -1)}${replacement}`), { code: 'VIDEO_INPUT_TOKEN_INVALID' });
  now += 61_000;
  assert.throws(() => gateway.verify(token), { code: 'VIDEO_INPUT_TOKEN_INVALID' });
});

test('provider input gateway refuses missing secrets and unsafe public base URLs', () => {
  const missing = createVideoProviderInputGateway({ secret: '', publicBaseUrl: '', ttlSeconds: 60 });
  assert.throws(() => missing.createUrl({ mediaId: 'm', jobId: 'j', attemptId: 'a' }), { code: 'VIDEO_INPUT_GATEWAY_NOT_CONFIGURED' });
  const unsafe = createVideoProviderInputGateway({ secret: 'fixture-secret-that-is-longer-than-thirty-two-characters', publicBaseUrl: 'https://user:pass@example.test', ttlSeconds: 60 });
  assert.throws(() => unsafe.createUrl({ mediaId: 'm', jobId: 'j', attemptId: 'a' }), /PUBLIC_BASE_URL_INVALID/);
});

test('provider input URL uses a MIME-matched extension and rejects unknown image types', () => {
  const gateway = createVideoProviderInputGateway({ secret: 'fixture-secret-that-is-longer-than-thirty-two-characters', publicBaseUrl: 'http://127.0.0.1:3000', ttlSeconds: 60 });
  assert.match(gateway.createUrl({ mediaId: 'm', jobId: 'j', attemptId: 'a', mimeType: 'image/webp' }), /\/input\.webp$/);
  assert.throws(() => gateway.createUrl({ mediaId: 'm', jobId: 'j', attemptId: 'a', mimeType: 'text/plain' }), { code: 'VIDEO_INPUT_MEDIA_INVALID' });
});

test('input media validation requires MIME and magic-byte agreement', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.deepEqual(validateVideoInputImage(png, 'image/png', 1024), { mimeType: 'image/png', sizeBytes: png.length });
  assert.throws(() => validateVideoInputImage(png, 'image/jpeg', 1024), { code: 'VIDEO_INPUT_MEDIA_TYPE_INVALID' });
  assert.throws(() => validateVideoInputImage(png, 'image/png', 4), { code: 'VIDEO_INPUT_MEDIA_SIZE_INVALID' });
});

test('provider input lookup remains capability-bound without racing job terminal state', async () => {
  let queryText = '';
  const repository = createVideoInputMediaRepository({
    async query(sql) {
      queryText = sql;
      return [[{ id: 'media-1', status: 'bound' }]];
    }
  });
  const row = await repository.getForProvider({ mediaId: 'media-1', jobId: 'job-1', attemptId: 'attempt-1' });
  assert.equal(row.id, 'media-1');
  assert.match(queryText, /m\.status='bound'/);
  assert.match(queryText, /m\.expires_at>NOW\(\)/);
  assert.doesNotMatch(queryText, /g\.status IN/);
  assert.doesNotMatch(queryText, /a\.state IN/);
});
