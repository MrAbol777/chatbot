'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createAdminAiRoutingRouter, maskedTaskId } = require('../../ai-routing/admin-ai-routing.routes');

let server; let origin;
test.before(async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('FROM app_ai_providers ORDER BY')) return [[{ provider_key: 'bananaai', display_name: 'BananaAI', enabled: 0, api_key_env_name: 'BANANAAI_API_KEY', max_concurrency: null, daily_cost_limit: null, config_json: '{"readiness":"BLOCKED"}', version: 1, updated_at: new Date() }]];
      if (sql.includes('SELECT * FROM app_ai_providers WHERE provider_key=')) return [[{ provider_key: 'bananaai', enabled: 0, api_key_env_name: 'BANANAAI_API_KEY', max_concurrency: null, daily_cost_limit: null, version: 1 }]];
      return [[]];
    }
  };
  const requireAdminAuth = (req, res, next) => { if (req.get('x-test-admin') !== 'yes') return res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED' }); req.admin = { username: 'fixture-admin' }; next(); };
  const app = express(); app.use(express.json()); app.use('/api/admin/ai-routing', createAdminAiRoutingRouter({ db, requireAdminAuth, env: { BANANAAI_API_KEY: 'yes', BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS: 'cdn.banana.test' } }));
  server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

test('Admin AI routing endpoints require authentication and redact provider configuration', async () => {
  assert.equal((await fetch(`${origin}/api/admin/ai-routing/providers`)).status, 401);
  const response = await fetch(`${origin}/api/admin/ai-routing/providers`, { headers: { 'x-test-admin': 'yes' } }); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items[0].keyConfigured, true); assert.equal(body.items[0].readiness, 'BLOCKED');
  const serialized = JSON.stringify(body); assert.equal(serialized.includes('api_key_env_name'), false); assert.equal(serialized.includes('base_url'), false); assert.equal(Object.hasOwn(body.items[0], 'apiKey'), false);
});

test('Admin writes fail before DB access without reason and optimistic version', async () => {
  const noReason = await fetch(`${origin}/api/admin/ai-routing/providers/bananaai`, { method: 'PATCH', headers: { 'x-test-admin': 'yes', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noReason.status, 400); assert.equal((await noReason.json()).error, 'AI_ADMIN_REASON_REQUIRED');
  const noVersion = await fetch(`${origin}/api/admin/ai-routing/providers/bananaai`, { method: 'PATCH', headers: { 'x-test-admin': 'yes', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'دلیل معتبر تست' }) });
  assert.equal(noVersion.status, 400); assert.equal((await noVersion.json()).error, 'AI_ADMIN_VERSION_REQUIRED');
});

test('provider task IDs are masked for Admin DTOs', () => {
  const masked = maskedTaskId('provider-task-sensitive-id'); assert.notEqual(masked, 'provider-task-sensitive-id'); assert.equal(masked.includes('task-sensitive'), false);
});

test('BananaAI cannot be enabled with a host allowlist but no exact result path contract', async () => {
  const response = await fetch(`${origin}/api/admin/ai-routing/providers/bananaai`, { method: 'PATCH', headers: { 'x-test-admin': 'yes', 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, expectedVersion: 1, reason: 'readiness path test' }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'AI_PROVIDER_READINESS_BLOCKED');
});
