'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Readable } = require('node:stream');
const { createVideoGenerationRouter } = require('../video-generation.routes');
const { createNoaBillingFixture } = require('./noa-billing.fixture');

let server;
let origin;
let videoModule;

const contentBytes = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');

test.before(async () => {
  const db = { query: async () => [[]] };
  videoModule = createVideoGenerationRouter({
    db,
    noaBillingService: createNoaBillingFixture(),
    httpClient: {},
    authJwtSecret: 'public-options-test-secret',
    adminJwtSecret: 'admin-test-secret',
    env: {
      NODE_ENV: 'test',
      VIDEO_FAKE_PROVIDER: '1',
      VIDEO_GENERATION_ENABLED: '1',
      AI_VIDEO_ROUTING_ENABLED: '0',
      VIDEO_RESULT_ALLOWED_PATH_PREFIXES: '/'
    }
  });
  videoModule.service.getContentRecord = async (generationId, userId) => generationId === 'generation-cookie-test' && userId === 'owner'
    ? {
        id: generationId,
        status: 'succeeded',
        result_storage_key: 'results/test/output.mp4',
        result_mime_type: 'video/mp4',
        result_original_filename: 'video.mp4'
      }
    : null;
  videoModule.storage.stat = async () => ({ size: contentBytes.length });
  videoModule.storage.openReadStream = () => Readable.from([contentBytes]);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/video-generation', videoModule.router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test('native media request can use its short-lived content cookie without a bearer header', async () => {
  const token = jwt.sign(
    { sub: 'owner', generationId: 'generation-cookie-test', purpose: 'video-content' },
    'public-options-test-secret',
    { expiresIn: '5m' }
  );
  const response = await fetch(`${origin}/api/video-generation/generation-cookie-test/content`, {
    headers: { Cookie: `danoa_video_content=${token}` }
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, responseBytes.toString('utf8'));
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(responseBytes, contentBytes);
});

test.after(async () => new Promise((resolve) => server.close(resolve)));

test('public video options ignore a stale bearer token while user operations stay protected', async () => {
  const headers = { Authorization: 'Bearer stale-or-expired-token' };
  const optionsResponse = await fetch(`${origin}/api/video-generation/options`, { headers });
  assert.equal(optionsResponse.status, 200);
  const options = await optionsResponse.json();
  assert.equal(options.enabled, true);
  assert.deepEqual(options.models, []);

  const historyResponse = await fetch(`${origin}/api/video-generation`, { headers });
  assert.equal(historyResponse.status, 401);
});
