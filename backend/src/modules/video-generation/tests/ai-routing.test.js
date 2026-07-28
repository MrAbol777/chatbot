'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiProviderRegistry } = require('../../ai-routing/provider-registry');
const { createAiCapabilityRouteResolver, AiRouteResolutionError } = require('../../ai-routing/capability-route-resolver');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');

function fakeRepository(overrides = {}) {
  const route = {
    route_id: 'route-t2v', capability_key: 'video.text_to_video', version: 3, enabled: 1, routing_policy: 'PRIMARY_ONLY',
    primary_provider_key: 'fake', primary_model_key: 'fake-model', fallback_provider_key: null, fallback_model_key: null,
    max_concurrency: null, daily_cost_limit: null, config_json: '{}'
  };
  return {
    getRoute: async () => ({ ...route, ...(overrides.route || {}) }),
    getProvider: async () => ({ provider_key: 'fake', enabled: 1, api_key_env_name: 'FAKE_PROVIDER_KEY', max_concurrency: null, daily_cost_limit: null, ...(overrides.provider || {}) }),
    getModel: async () => ({ internal_key: 'fake-model', provider: 'fake', provider_model_id: 'fixture-model', is_active: 1, supports_text_to_video: 1, supports_image_to_video: 1, ...(overrides.model || {}) }),
    getHealth: async () => overrides.health || { circuit_state: 'CLOSED' },
    activeAttemptCount: async () => overrides.activeAttemptCount || 0,
    dailyCost: async () => overrides.dailyCost || 0
  };
}

test('registry rejects duplicate and unknown providers without exposing secrets', () => {
  const registry = new AiProviderRegistry().register(createFakeVideoProvider());
  assert.throws(() => registry.register(createFakeVideoProvider()), /AI_PROVIDER_DUPLICATE/);
  assert.throws(() => registry.get('missing'), /AI_PROVIDER_UNKNOWN/);
  assert.deepEqual(registry.keys(), ['fake']);
});

test('resolver snapshots route version and invalidates its 30 second cache', async () => {
  let loads = 0;
  const repository = fakeRepository();
  const original = repository.getRoute;
  repository.getRoute = async (...args) => { loads += 1; return original(...args); };
  const resolver = createAiCapabilityRouteResolver({ repository, registry: new AiProviderRegistry().register(createFakeVideoProvider()), env: { FAKE_PROVIDER_KEY: 'fixture' }, clock: () => 1_000 });
  const first = await resolver.resolve('video.text_to_video');
  const second = await resolver.resolve('video.text_to_video');
  assert.equal(first.routeVersion, 3);
  assert.equal(second.internalModelKey, 'fake-model');
  assert.equal(loads, 1);
  resolver.invalidate('video.text_to_video');
  await resolver.resolve('video.text_to_video');
  assert.equal(loads, 2);
});

test('resolver applies provider, circuit and concurrency gates before submit', async () => {
  const registry = new AiProviderRegistry().register(createFakeVideoProvider());
  const cases = [
    [fakeRepository({ provider: { enabled: 0 } }), 'AI_PROVIDER_DISABLED'],
    [fakeRepository({ health: { circuit_state: 'OPEN', retry_after: '2099-01-01T00:00:00.000Z' } }), 'AI_CIRCUIT_OPEN'],
    [fakeRepository({ provider: { max_concurrency: 1 }, activeAttemptCount: 1 }), 'AI_CONCURRENCY_LIMIT']
  ];
  for (const [repository, code] of cases) {
    const resolver = createAiCapabilityRouteResolver({ repository, registry, env: { FAKE_PROVIDER_KEY: 'fixture' } });
    await assert.rejects(resolver.resolve('video.text_to_video'), (error) => error instanceof AiRouteResolutionError && error.code === code);
  }
});

test('finite cost limit fails closed when the adapter has no documented estimate', async () => {
  const repository = fakeRepository({ route: { daily_cost_limit: 10 } });
  const resolver = createAiCapabilityRouteResolver({ repository, registry: new AiProviderRegistry().register(createFakeVideoProvider()), env: { FAKE_PROVIDER_KEY: 'fixture' } });
  await assert.rejects(resolver.resolve('video.text_to_video'), { code: 'AI_COST_ESTIMATE_REQUIRED' });
});
