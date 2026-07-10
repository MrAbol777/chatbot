const { fingerprintApiKey } = require('../../bootstrap/config');
const { INTENT_ROUTER_SYSTEM_PROMPT } = require('./intent-router.prompt');

const INTENT_ROUTER_ALLOWED_INTENTS = ['chat', 'image_generation', 'image_edit', 'image_understanding'];
const INTENT_ROUTER_ALLOWED_PROVIDERS = ['metis'];
const INTENT_ROUTER_ALLOWED_MODELS = ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'];

const intentRouterSettingKey = {
  enabled: 'ai.intent_router.enabled',
  provider: 'ai.intent_router.provider',
  model: 'ai.intent_router.model',
  fallbackModel: 'ai.intent_router.fallback_model',
  experimentalModel: 'ai.intent_router.experimental_model',
  temperature: 'ai.intent_router.temperature',
  maxOutputTokens: 'ai.intent_router.max_output_tokens',
  timeoutMs: 'ai.intent_router.timeout_ms',
  confidenceThreshold: 'ai.intent_router.confidence_threshold',
  fallbackToHeuristic: 'ai.intent_router.fallback_to_heuristic',
  allowModelFallback: 'ai.intent_router.allow_model_fallback',
  allowChatKeyFallback: 'ai.intent_router.allow_chat_key_fallback',
  storeMetadata: 'ai.intent_router.store_metadata',
  systemPrompt: 'ai.intent_router.system_prompt',
  modelHealthEnabled: 'ai.intent_router.model_health.enabled',
  modelHealthFailureThreshold: 'ai.intent_router.model_health.failure_threshold',
  modelHealthCooldownMinutes: 'ai.intent_router.model_health.cooldown_minutes'
};

const DEFAULT_INTENT_ROUTER_SETTINGS = {
  enabled: true,
  provider: 'metis',
  model: 'gemini-2.5-flash-lite-preview',
  fallbackModel: 'gemini-2.5-flash',
  experimentalModel: 'gemini-2.5-flash-lite-preview',
  temperature: 0,
  maxOutputTokens: 120,
  timeoutMs: 2500,
  confidenceThreshold: 0.65,
  fallbackToHeuristic: true,
  allowModelFallback: true,
  allowChatKeyFallback: false,
  storeMetadata: true,
  systemPrompt: INTENT_ROUTER_SYSTEM_PROMPT,
  modelHealthEnabled: true,
  modelHealthFailureThreshold: 3,
  modelHealthCooldownMinutes: 60,
  lastValidationStatus: 'valid'
};

const normalizeString = (value, fallback = '') => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeNumber = (value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const get = (settings, key, fallback) => (
  settings && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback
);

const normalizeIntentRouterSettings = ({ settings = {}, routerConfig = {} } = {}) => ({
  enabled: normalizeBoolean(get(settings, intentRouterSettingKey.enabled, routerConfig.enabled ?? true), true),
  provider: normalizeString(get(settings, intentRouterSettingKey.provider, routerConfig.provider || 'metis'), 'metis').toLowerCase(),
  model: normalizeString(get(settings, intentRouterSettingKey.model, routerConfig.model || 'gemini-2.5-flash-lite-preview'), 'gemini-2.5-flash-lite-preview'),
  fallbackModel: normalizeString(get(settings, intentRouterSettingKey.fallbackModel, routerConfig.fallbackModel || 'gemini-2.5-flash'), 'gemini-2.5-flash'),
  experimentalModel: normalizeString(get(settings, intentRouterSettingKey.experimentalModel, routerConfig.experimentalModel || 'gemini-2.5-flash-lite-preview'), 'gemini-2.5-flash-lite-preview'),
  temperature: normalizeNumber(get(settings, intentRouterSettingKey.temperature, routerConfig.temperature ?? 0), 0, 0, 1),
  maxOutputTokens: normalizeNumber(get(settings, intentRouterSettingKey.maxOutputTokens, routerConfig.maxOutputTokens ?? 120), 120, 50, 500),
  timeoutMs: normalizeNumber(get(settings, intentRouterSettingKey.timeoutMs, routerConfig.timeoutMs ?? 2500), 2500, 500, 30000),
  confidenceThreshold: normalizeNumber(get(settings, intentRouterSettingKey.confidenceThreshold, routerConfig.confidenceThreshold ?? 0.65), 0.65, 0, 1),
  fallbackToHeuristic: normalizeBoolean(get(settings, intentRouterSettingKey.fallbackToHeuristic, routerConfig.fallbackToHeuristic ?? true), true),
  allowModelFallback: normalizeBoolean(get(settings, intentRouterSettingKey.allowModelFallback, routerConfig.allowModelFallback ?? true), true),
  allowChatKeyFallback: normalizeBoolean(get(settings, intentRouterSettingKey.allowChatKeyFallback, routerConfig.allowChatKeyFallback ?? false), false),
  storeMetadata: normalizeBoolean(get(settings, intentRouterSettingKey.storeMetadata, routerConfig.storeMetadata ?? true), true),
  systemPrompt: normalizeString(get(settings, intentRouterSettingKey.systemPrompt, routerConfig.systemPrompt || INTENT_ROUTER_SYSTEM_PROMPT), INTENT_ROUTER_SYSTEM_PROMPT),
  modelHealthEnabled: normalizeBoolean(get(settings, intentRouterSettingKey.modelHealthEnabled, routerConfig.modelHealthEnabled ?? true), true),
  modelHealthFailureThreshold: normalizeNumber(get(settings, intentRouterSettingKey.modelHealthFailureThreshold, routerConfig.modelHealthFailureThreshold ?? 3), 3, 1, 20),
  modelHealthCooldownMinutes: normalizeNumber(get(settings, intentRouterSettingKey.modelHealthCooldownMinutes, routerConfig.modelHealthCooldownMinutes ?? 60), 60, 1, 1440),
  lastValidationStatus: 'valid'
});

const validateIntentRouterSettings = (settings) => {
  const errors = [];
  if (!INTENT_ROUTER_ALLOWED_PROVIDERS.includes(settings.provider)) errors.push('intent-router provider معتبر نیست.');
  if (!INTENT_ROUTER_ALLOWED_MODELS.includes(settings.model)) errors.push('intent-router primary model فقط flash-lite یا flash است.');
  if (!INTENT_ROUTER_ALLOWED_MODELS.includes(settings.fallbackModel)) errors.push('intent-router fallback model فقط flash-lite یا flash است.');
  if (/pro/i.test(settings.model) || /pro/i.test(settings.fallbackModel)) errors.push('intent-router نباید از مدل Pro استفاده کند.');
  if (!settings.systemPrompt || settings.systemPrompt.length < 50) errors.push('intent-router system prompt معتبر نیست.');
  if (errors.length > 0) {
    const error = new Error(errors.join(' '));
    error.validationErrors = errors;
    throw error;
  }
  return true;
};

const intentRouterSettingsPayloadToSettings = (payload = {}) => {
  const raw = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
  return Object.fromEntries(
    Object.values(intentRouterSettingKey)
      .filter((key) => Object.prototype.hasOwnProperty.call(raw || {}, key))
      .map((key) => [key, raw[key]])
  );
};

const makeSafeKeyInfo = (apiKeyInfo = {}) => ({
  apiKeySource: apiKeyInfo.apiKeySource || 'missing',
  apiKeySet: Boolean(apiKeyInfo.apiKey),
  apiKeyFingerprint: apiKeyInfo.apiKeyFingerprint || (apiKeyInfo.apiKey ? fingerprintApiKey(apiKeyInfo.apiKey) : '')
});

module.exports = {
  DEFAULT_INTENT_ROUTER_SETTINGS,
  INTENT_ROUTER_ALLOWED_INTENTS,
  INTENT_ROUTER_ALLOWED_MODELS,
  INTENT_ROUTER_SYSTEM_PROMPT,
  intentRouterSettingKey,
  intentRouterSettingsPayloadToSettings,
  makeSafeKeyInfo,
  normalizeIntentRouterSettings,
  validateIntentRouterSettings
};
