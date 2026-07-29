'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const express = require('express');
const {
  createVideoGenerationAdminRouter
} = require('../video-generation.admin.routes');

const now = '2026-07-29T08:30:00.000Z';
const listRow = {
  id: 'video-1',
  user_id: 'user-1',
  user_name: 'کاربر تست',
  user_phone: '09120000000',
  user_age: 28,
  status: 'succeeded',
  mode: 'image-to-video',
  prompt: 'پرامپت قدیمی',
  user_prompt: 'حرکت آرام دوربین به سمت سوژه',
  provider: 'metis',
  model_key: 'kling-video',
  provider_model_id_snapshot: 'kling-v2',
  aspect_ratio: '16:9',
  duration: '5',
  resolution: '1080p',
  input_media_id: 'media-1',
  input_media_reference: null,
  joined_input_media_id: 'media-1',
  result_storage_key: 'result/video-1.mp4',
  result_mime_type: 'video/mp4',
  result_size_bytes: 4096,
  created_at: now,
  updated_at: now,
  completed_at: now
};

const detailRow = {
  ...listRow,
  danoa_request_id: 'request-internal-1',
  capability_key: 'video.image-to-video',
  route_id: 'route-1',
  route_version: 3,
  compiled_prompt: 'پرامپت نهایی کامپایل‌شده برای ارائه‌دهنده',
  compiled_prompt_hash: 'a'.repeat(64),
  negative_prompt: 'بدون لرزش',
  prompt_profile_key: 'cinematic',
  prompt_profile_version: 2,
  prompt_compiler_version: '1',
  quality: 'high',
  generate_audio: 0,
  provider_status: 'completed',
  result_storage_status: 'stored',
  result_sha256: 'b'.repeat(64),
  result_original_filename: 'output.mp4',
  result_stored_at: now,
  safe_error_code: null,
  safe_error_message: null,
  storage_safe_error_code: null,
  storage_safe_error_message: null,
  poll_attempts: 4,
  storage_attempts: 1,
  submitted_at: now,
  processing_at: now,
  failed_at: null,
  cancelled_at: null,
  expired_at: null,
  last_polled_at: now,
  input_original_filename: 'photo.webp',
  input_mime_type: 'image/webp',
  input_size_bytes: 1024,
  input_created_at: now,
  reservation_id: 'reservation-1',
  reservation_status: 'captured',
  reservation_quantity: '5.000000',
  reservation_unit: 'second',
  unit_price_snapshot: '0.250000',
  reservation_amount: '1.250000',
  reservation_captured_at: now,
  reservation_released_at: null,
  reservation_release_reason: null,
  attempt_state: 'completed',
  attempt_estimated_cost: '0.100000',
  attempt_actual_cost: '0.090000',
  attempt_cost_currency: 'USD',
  attempt_processing_time_ms: 8400,
  attempt_error_code: null,
  attempt_error_summary: null
};

let server;
let origin;
const capturedQueries = [];

test.before(async () => {
  const db = {
    query: async (sql, params = []) => {
      capturedQueries.push({ sql, params });
      if (sql.includes('SELECT COUNT(*) AS total')) return [[{ total: 1 }]];
      if (sql.includes('ORDER BY g.created_at DESC')) return [[listRow]];
      if (sql.includes('GROUP BY g.status')) {
        return [[
          { status: 'succeeded', total: 1 },
          { status: 'processing', total: 2 },
          { status: 'provider_status_unknown', total: 1 }
        ]];
      }
      if (sql.includes('SELECT m.storage_key')) {
        return [[{ storage_key: 'media-1.webp', mime_type: 'image/webp', size_bytes: 11 }]];
      }
      if (sql.includes('SELECT g.id,g.danoa_request_id')) return [[detailRow]];
      return [[]];
    }
  };
  const requireAdminAuth = (req, res, next) => {
    if (req.get('x-test-admin') !== 'yes') {
      return res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED' });
    }
    req.admin = { username: 'fixture-admin' };
    return next();
  };
  const inputMediaStorage = {
    createReadStream: () => Readable.from([Buffer.from('image-bytes')])
  };
  const app = express();
  app.use(
    '/api/admin/video-generations',
    createVideoGenerationAdminRouter({ db, requireAdminAuth, inputMediaStorage })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => new Promise((resolve) => server.close(resolve)));

test('Admin video endpoints require authentication', async () => {
  const response = await fetch(`${origin}/api/admin/video-generations`);
  assert.equal(response.status, 401);
});

test('list exposes the user, original prompt, media links and operational summary', async () => {
  const response = await fetch(
    `${origin}/api/admin/video-generations?q=${encodeURIComponent('حرکت')}&status=succeeded&page=1&pageSize=12`,
    { headers: { 'x-test-admin': 'yes' } }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.items[0].user.name, 'کاربر تست');
  assert.equal(body.items[0].prompt, 'حرکت آرام دوربین به سمت سوژه');
  assert.equal(body.items[0].inputImageUrl, '/api/admin/video-generations/video-1/input');
  assert.equal(body.items[0].resultContentUrl, '/api/video-generations/video-1/content');
  assert.deepEqual(body.summary, { total: 4, succeeded: 1, active: 2, failed: 1 });
  assert.equal(JSON.stringify(body).includes('result_storage_key'), false);
  assert.equal(JSON.stringify(body).includes('provider_task_id'), false);

  const itemQuery = capturedQueries.find((entry) => entry.sql.includes('ORDER BY g.created_at DESC'));
  assert.ok(itemQuery.params.includes('succeeded'));
  assert.ok(itemQuery.params.includes('%حرکت%'));
});

test('detail combines prompts, input, output, routing and Noa billing without storage keys', async () => {
  const response = await fetch(`${origin}/api/admin/video-generations/video-1`, {
    headers: { 'x-test-admin': 'yes' }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.prompts.user, 'حرکت آرام دوربین به سمت سوژه');
  assert.equal(body.prompts.compiled, 'پرامپت نهایی کامپایل‌شده برای ارائه‌دهنده');
  assert.equal(body.input.filename, 'photo.webp');
  assert.equal(body.result.downloadUrl, '/api/video-generations/video-1/content?download=1');
  assert.equal(body.billing.amountNoa, '1.250000');
  assert.equal(body.providerMetrics.processingTimeMs, 8400);
  assert.equal(JSON.stringify(body).includes('result/video-1.mp4'), false);
});

test('input endpoint streams the private user image with safe cache headers', async () => {
  const response = await fetch(`${origin}/api/admin/video-generations/video-1/input`, {
    headers: { 'x-test-admin': 'yes' }
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(bytes.toString(), 'image-bytes');
});
