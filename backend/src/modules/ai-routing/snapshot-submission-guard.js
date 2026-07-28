'use strict';

const { supportsCapability } = require('./capability-route-resolver');

function blocked(code) { return Object.assign(new Error(code), { code, submissionOutcome: 'not_submitted', safe: true }); }
function adapterFrom(registry, key) { return typeof registry?.get === 'function' ? registry.get(key) : registry?.[key]; }

function createAiSnapshotSubmissionGuard({ repository, providerRegistry, env = process.env }) {
  return {
    async check(job, input) {
      let snapshot = {};
      try { snapshot = typeof job.route_snapshot === 'string' ? JSON.parse(job.route_snapshot) : job.route_snapshot || {}; } catch (_) { throw blocked('AI_ROUTE_SNAPSHOT_INVALID'); }
      if (!snapshot.routeId || Number(snapshot.routeVersion) < 1 || snapshot.capability !== input.capability) throw blocked('AI_ROUTE_SNAPSHOT_INVALID');
      const route = await repository.getRoute(input.capability);
      if (!route || route.route_id !== snapshot.routeId || !route.enabled) throw blocked('AI_ROUTE_DISABLED');
      const [provider, model] = await Promise.all([repository.getProvider(job.provider), repository.getModel(job.model_key)]);
      if (!provider || !provider.enabled) throw blocked('AI_PROVIDER_DISABLED');
      if (!model || !model.is_active) throw blocked('AI_MODEL_DISABLED');
      if (model.provider !== job.provider || model.provider_model_id !== job.provider_model_id_snapshot) throw blocked('AI_MODEL_PROVIDER_MISMATCH');
      if (!supportsCapability(model, input.capability)) throw blocked('AI_CAPABILITY_UNSUPPORTED');
      const adapter = adapterFrom(providerRegistry, job.provider);
      if (!adapter) throw blocked('AI_PROVIDER_ADAPTER_MISSING');
      const keyName = String(provider.api_key_env_name || '');
      if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(keyName) || !String(env[keyName] || '').trim()) throw blocked('AI_PROVIDER_KEY_MISSING');
      const health = await repository.getHealth(job.provider, input.capability);
      if (health?.circuit_state === 'OPEN' && health.retry_after && new Date(health.retry_after) > new Date()) throw blocked('AI_CIRCUIT_OPEN');
      if (typeof repository.claimCircuitPermission === 'function' && !await repository.claimCircuitPermission(job.provider, input.capability)) throw blocked('AI_CIRCUIT_OPEN');
      const providerLimit = provider.max_concurrency == null ? null : Number(provider.max_concurrency);
      const routeLimit = route.max_concurrency == null ? null : Number(route.max_concurrency);
      const concurrencyLimit = [providerLimit, routeLimit].filter((value) => Number.isSafeInteger(value) && value > 0).reduce((minimum, value) => Math.min(minimum, value), Infinity);
      if (Number.isFinite(concurrencyLimit) && await repository.activeAttemptCount({ providerKey: job.provider, capabilityKey: input.capability, routeId: snapshot.routeId }) >= concurrencyLimit) throw blocked('AI_CONCURRENCY_LIMIT');
      const providerCostLimit = provider.daily_cost_limit == null ? null : Number(provider.daily_cost_limit);
      const routeCostLimit = route.daily_cost_limit == null ? null : Number(route.daily_cost_limit);
      const costLimit = [providerCostLimit, routeCostLimit].filter((value) => Number.isFinite(value) && value >= 0).reduce((minimum, value) => Math.min(minimum, value), Infinity);
      if (Number.isFinite(costLimit)) {
        const estimate = adapter.estimateCost?.({ capability: input.capability, model, input });
        if (!Number.isFinite(estimate) || estimate < 0) throw blocked('AI_COST_ESTIMATE_REQUIRED');
        const spent = Number(await repository.dailyCost({ providerKey: job.provider, capabilityKey: input.capability, routeId: snapshot.routeId }));
        if (!Number.isFinite(spent) || spent + estimate > costLimit) throw blocked('AI_COST_LIMIT');
      }
      return true;
    }
  };
}

module.exports = { createAiSnapshotSubmissionGuard };
