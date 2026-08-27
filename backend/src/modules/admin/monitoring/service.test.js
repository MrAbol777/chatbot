'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTrafficSeries,
  createMonitoringService,
  percentile,
  tokenTotal
} = require('./service');

test('monitoring helpers calculate percentiles, tokens and filled traffic buckets', () => {
  assert.equal(percentile([5, 10, 20, 50, 100], 0.95), 100);
  assert.equal(tokenTotal(JSON.stringify({ prompt_tokens: 40, completion_tokens: 60 })), 100);

  const from = new Date('2026-08-27T00:00:00.000Z');
  const to = new Date('2026-08-27T00:15:00.000Z');
  const series = buildTrafficSeries([
    { created_at: '2026-08-27T00:02:00.000Z', status_code: 200, duration_ms: 100 },
    { created_at: '2026-08-27T00:03:00.000Z', status_code: 500, duration_ms: 300 }
  ], from, to, 5 * 60 * 1000);

  assert.equal(series.length, 3);
  assert.deepEqual(series[0], {
    timestamp: '2026-08-27T00:00:00.000Z',
    requests: 2,
    errorRate: 50,
    averageLatencyMs: 200
  });
  assert.equal(series[1].requests, 0);
});

test('monitoring overview combines real usage, queues, provider health and alerts', async () => {
  const currentRequestRows = Array.from({ length: 20 }, (_, index) => ({
    route: '/api/chat',
    status_code: index === 0 ? 500 : 200,
    duration_ms: index === 19 ? 6200 : 400,
    created_at: new Date(Date.UTC(2026, 7, 27, index % 12)).toISOString()
  }));
  let requestCall = 0;
  let activeCall = 0;
  let noaCall = 0;
  const repository = {
    getTotalUsers: async () => 120,
    getActiveUsers: async () => (++activeCall === 1 ? 30 : 20),
    getRequestRows: async () => (++requestCall === 1 ? currentRequestRows : currentRequestRows.slice(0, 10)),
    getChatRows: async () => [
      { model: 'chat-model', response_time_ms: 900, token_usage: { total_tokens: 250 }, error_code: null }
    ],
    getImageRows: async () => [{ status: 'COMPLETED', provider: 'metis', model: 'image-model', duration_ms: 2400 }],
    getVideoRows: async () => [{ status: 'failed', provider: 'bananaai', model: 'video-model', duration_ms: 5000 }],
    getProviderAttempts: async () => [],
    getProviderHealth: async () => [{ provider_key: 'bananaai', capability_key: 'video', circuit_state: 'OPEN' }],
    getNoaSnapshot: async () => (++noaCall === 1
      ? { captured: [{ actionKey: 'text_chat', amount: 12, total: 1 }], unresolved: { total: 2, amount: 4 } }
      : { captured: [{ actionKey: 'text_chat', amount: 6, total: 1 }], unresolved: { total: 0, amount: 0 } }),
    getQueueSnapshot: async () => ({ images: {}, videos: { processing: 1 }, staleImages: 0, staleVideos: 1 }),
    getRecentErrors: async () => [],
    getTopErrors: async () => [],
    ping: async () => 8
  };

  const service = createMonitoringService({
    repository,
    runtimeConfig: { ai: { chat: { provider: 'metis' }, image: { enabled: true } } },
    env: { NODE_ENV: 'test', VIDEO_GENERATION_ENABLED: '1' },
    clock: () => new Date('2026-08-28T00:00:00.000Z')
  });
  const overview = await service.getOverview({ range: '24h' });

  assert.equal(overview.kpis.totalUsers, 120);
  assert.equal(overview.kpis.activeUsers.value, 30);
  assert.equal(overview.kpis.requests.value, 20);
  assert.equal(overview.kpis.tokens.value, 250);
  assert.equal(overview.kpis.noaSpent.value, 12);
  assert.equal(overview.capabilities.find((item) => item.key === 'image').successRate, 100);
  assert.ok(overview.alerts.some((item) => item.id === 'stale-video-jobs'));
  assert.ok(overview.alerts.some((item) => item.id === 'noa-unresolved'));
  assert.ok(overview.alerts.some((item) => item.id.startsWith('provider-open-')));
});
