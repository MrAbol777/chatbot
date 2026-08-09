'use strict';

const { assertCapabilityKey, assertRoutingPolicy, candidateOrder } = require('./routing-policies');
const { parseJson } = require('./ai-routing.repository');

class AiRouteResolutionError extends Error {
  constructor(code, message = code, details = {}) { super(message); this.name = 'AiRouteResolutionError'; this.code = code; this.details = details; }
}

const supportsCapability = (model, capability) => capability === 'video.text_to_video'
  ? Boolean(model?.supports_text_to_video)
  : capability === 'video.image_to_video' ? Boolean(model?.supports_image_to_video) : false;

function createAiCapabilityRouteResolver({ repository, registry, env = process.env, cacheTtlMs = 30_000, clock = () => Date.now() }) {
  const cache = new Map();
  const invalidate = (capability) => capability ? cache.delete(String(capability)) : cache.clear();

  async function load(capability) {
    const cached = cache.get(capability);
    if (cached && cached.expiresAt > clock()) return cached.value;
    const row = await repository.getRoute(capability);
    if (!row) throw new AiRouteResolutionError('AI_ROUTE_NOT_FOUND');
    const value = {
      id: row.route_id,
      capability,
      version: Number(row.version),
      enabled: Boolean(row.enabled),
      policy: assertRoutingPolicy(row.routing_policy),
      maxConcurrency: row.max_concurrency == null ? null : Number(row.max_concurrency),
      dailyCostLimit: row.daily_cost_limit == null ? null : Number(row.daily_cost_limit),
      config: parseJson(row.config_json, {}),
      primary: row.primary_provider_key && row.primary_model_key ? { providerKey: row.primary_provider_key, modelKey: row.primary_model_key } : null,
      fallback: row.fallback_provider_key && row.fallback_model_key ? { providerKey: row.fallback_provider_key, modelKey: row.fallback_model_key } : null
    };
    cache.set(capability, { value, expiresAt: clock() + cacheTtlMs });
    return value;
  }

  async function inspectCandidate(candidate, capability, route, context) {
    if (!candidate) return { ok: false, code: 'AI_ROUTE_CANDIDATE_MISSING' };
    const [provider, model] = await Promise.all([repository.getProvider(candidate.providerKey), repository.getModel(candidate.modelKey)]);
    if (!provider) return { ok: false, code: 'AI_PROVIDER_NOT_FOUND', candidate };
    if (!model) return { ok: false, code: 'AI_MODEL_NOT_FOUND', candidate };
    if (String(model.provider) !== candidate.providerKey) return { ok: false, code: 'AI_MODEL_PROVIDER_MISMATCH', candidate };
    if (!provider.enabled) return { ok: false, code: 'AI_PROVIDER_DISABLED', candidate };
    if (!model.is_active) return { ok: false, code: 'AI_MODEL_DISABLED', candidate };
    if (!supportsCapability(model, capability)) return { ok: false, code: 'AI_CAPABILITY_UNSUPPORTED', candidate };
    if (!registry.has(candidate.providerKey)) return { ok: false, code: 'AI_PROVIDER_ADAPTER_MISSING', candidate };
    const allowedEnvName = String(provider.api_key_env_name || '');
    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(allowedEnvName) || !String(env[allowedEnvName] || '').trim()) return { ok: false, code: 'AI_PROVIDER_KEY_MISSING', candidate };
    const health = await repository.getHealth(candidate.providerKey, capability);
    if (health?.circuit_state === 'OPEN' && health.retry_after && new Date(health.retry_after).getTime() > clock()) return { ok: false, code: 'AI_CIRCUIT_OPEN', candidate };
    const providerLimit = provider.max_concurrency == null ? null : Number(provider.max_concurrency);
    const concurrencyLimit = [providerLimit, route.maxConcurrency].filter((value) => Number.isInteger(value) && value > 0).reduce((minimum, value) => Math.min(minimum, value), Infinity);
    if (Number.isFinite(concurrencyLimit)) {
      const count = await repository.activeAttemptCount({ providerKey: candidate.providerKey, capabilityKey: capability, routeId: route.id });
      if (count >= concurrencyLimit) return { ok: false, code: 'AI_CONCURRENCY_LIMIT', candidate };
    }
    const providerCostLimit = provider.daily_cost_limit == null ? null : Number(provider.daily_cost_limit);
    const costLimit = [providerCostLimit, route.dailyCostLimit].filter((value) => Number.isFinite(value) && value >= 0).reduce((minimum, value) => Math.min(minimum, value), Infinity);
    if (Number.isFinite(costLimit)) {
      const estimate = registry.get(candidate.providerKey).estimateCost?.({ capability, model, input: context?.input || null });
      if (!Number.isFinite(estimate) || estimate < 0) return { ok: false, code: 'AI_COST_ESTIMATE_REQUIRED', candidate };
      const spent = Number(await repository.dailyCost({ providerKey: candidate.providerKey, capabilityKey: capability, routeId: route.id }));
      if (!Number.isFinite(spent) || spent + estimate > costLimit) return { ok: false, code: 'AI_COST_LIMIT', candidate };
    }
    return { ok: true, provider, model, candidate, health };
  }

  return {
    invalidate,
    async resolve(capabilityValue, context = {}) {
      const capability = assertCapabilityKey(capabilityValue);
      const route = await load(capability);
      if (!route.enabled) throw new AiRouteResolutionError('AI_ROUTE_DISABLED');
      const candidates = candidateOrder(route);
      if (!candidates.length) throw new AiRouteResolutionError('AI_ROUTE_CANDIDATE_MISSING');
      const inspected = [];
      for (const candidate of candidates) inspected.push(await inspectCandidate(candidate, capability, route, context));
      let selectedIndex = -1;
      for (let index = 0; index < inspected.length; index += 1) {
        if (!inspected[index].ok) continue;
        if (context?.forSubmission && typeof repository.claimCircuitPermission === 'function' && !await repository.claimCircuitPermission(inspected[index].candidate.providerKey, capability)) {
          inspected[index] = { ...inspected[index], ok: false, code: 'AI_CIRCUIT_OPEN' };
          continue;
        }
        selectedIndex = index;
        break;
      }
      if (selectedIndex < 0) throw new AiRouteResolutionError(inspected[0]?.code || 'AI_ROUTE_UNAVAILABLE', undefined, { candidates: inspected.map(({ code, candidate }) => ({ code, candidate })) });
      const selected = inspected[selectedIndex];
      return Object.freeze({
        routeId: route.id,
        routeVersion: route.version,
        capability,
        routingPolicy: route.policy,
        maxConcurrency: route.maxConcurrency,
        dailyCostLimit: route.dailyCostLimit,
        selectedIndex,
        candidates: inspected.map((item) => ({
          providerKey: item.candidate?.providerKey,
          modelKey: item.candidate?.modelKey,
          providerModelId: item.model?.provider_model_id || null,
          available: item.ok,
          gateCode: item.ok ? null : item.code
        })),
        providerKey: selected.candidate.providerKey,
        internalModelKey: selected.model.internal_key,
        providerModelId: selected.model.provider_model_id,
        upstreamVendor: selected.model.upstream_vendor || null,
        providerOperation: selected.model.upstream_operation || null,
        adapterVersion: registry.get(selected.candidate.providerKey).getAdapterVersion?.() || null,
        resolvedAt: new Date(clock()).toISOString()
      });
    },
    async publicModelFor(capabilityValue) {
      const snapshot = await this.resolve(capabilityValue);
      return repository.getModel(snapshot.internalModelKey);
    }
  };
}

module.exports = { createAiCapabilityRouteResolver, AiRouteResolutionError, supportsCapability };
