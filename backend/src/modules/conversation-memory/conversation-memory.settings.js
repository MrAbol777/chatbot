const { fingerprintApiKey } = require('../../bootstrap/config');
const { MEMORY_WRITER_SYSTEM_PROMPT } = require('./conversation-memory.prompt');

const conversationMemorySettingKey = {
  enabled: 'ai.conversation_memory.enabled',
  provider: 'ai.conversation_memory.provider',
  model: 'ai.conversation_memory.model',
  fallbackModel: 'ai.conversation_memory.fallback_model',
  temperature: 'ai.conversation_memory.temperature',
  maxOutputTokens: 'ai.conversation_memory.max_output_tokens',
  timeoutMs: 'ai.conversation_memory.timeout_ms',
  allowModelFallback: 'ai.conversation_memory.allow_model_fallback',
  allowChatKeyFallback: 'ai.conversation_memory.allow_chat_key_fallback',
  maxDocumentChars: 'ai.conversation_memory.max_document_chars',
  storeMetadata: 'ai.conversation_memory.store_metadata',
  systemPrompt: 'ai.conversation_memory.system_prompt'
};

const DEFAULT_CONVERSATION_MEMORY_SETTINGS = {
  enabled: true,
  provider: 'metis',
  model: 'gemini-2.5-flash-lite-preview',
  fallbackModel: 'gemini-2.5-flash',
  temperature: 0,
  maxOutputTokens: 3000,
  timeoutMs: 8000,
  allowModelFallback: true,
  allowChatKeyFallback: false,
  maxDocumentChars: 20000,
  storeMetadata: true,
  systemPrompt: MEMORY_WRITER_SYSTEM_PROMPT,
  lastValidationStatus: 'valid'
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

const normalizeNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const normalizeString = (value, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const get = (settings, key, fallback) => (
  settings && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback
);

const normalizeConversationMemorySettings = ({ settings = {}, memoryConfig = {} } = {}) => ({
  enabled: normalizeBoolean(get(settings, conversationMemorySettingKey.enabled, memoryConfig.enabled ?? true), true),
  provider: normalizeString(get(settings, conversationMemorySettingKey.provider, memoryConfig.provider || 'metis'), 'metis').toLowerCase(),
  model: normalizeString(get(settings, conversationMemorySettingKey.model, memoryConfig.model || DEFAULT_CONVERSATION_MEMORY_SETTINGS.model), DEFAULT_CONVERSATION_MEMORY_SETTINGS.model),
  fallbackModel: normalizeString(get(settings, conversationMemorySettingKey.fallbackModel, memoryConfig.fallbackModel || DEFAULT_CONVERSATION_MEMORY_SETTINGS.fallbackModel), DEFAULT_CONVERSATION_MEMORY_SETTINGS.fallbackModel),
  temperature: normalizeNumber(get(settings, conversationMemorySettingKey.temperature, memoryConfig.temperature ?? 0), 0, 0, 1),
  maxOutputTokens: normalizeNumber(get(settings, conversationMemorySettingKey.maxOutputTokens, memoryConfig.maxOutputTokens ?? 3000), 3000, 500, 8192),
  timeoutMs: normalizeNumber(get(settings, conversationMemorySettingKey.timeoutMs, memoryConfig.timeoutMs ?? 8000), 8000, 1000, 60000),
  allowModelFallback: normalizeBoolean(get(settings, conversationMemorySettingKey.allowModelFallback, memoryConfig.allowModelFallback ?? true), true),
  allowChatKeyFallback: normalizeBoolean(get(settings, conversationMemorySettingKey.allowChatKeyFallback, memoryConfig.allowChatKeyFallback ?? false), false),
  maxDocumentChars: normalizeNumber(get(settings, conversationMemorySettingKey.maxDocumentChars, memoryConfig.maxDocumentChars ?? 20000), 20000, 2000, 100000),
  storeMetadata: normalizeBoolean(get(settings, conversationMemorySettingKey.storeMetadata, memoryConfig.storeMetadata ?? true), true),
  systemPrompt: normalizeString(get(settings, conversationMemorySettingKey.systemPrompt, memoryConfig.systemPrompt || MEMORY_WRITER_SYSTEM_PROMPT), MEMORY_WRITER_SYSTEM_PROMPT),
  lastValidationStatus: 'valid'
});

const validateConversationMemorySettings = (settings) => {
  const errors = [];
  if (settings.provider !== 'metis') errors.push('conversation-memory provider معتبر نیست.');
  if (!settings.model || /pro/i.test(settings.model)) errors.push('مدل اصلی حافظه نباید خالی یا Pro باشد.');
  if (!settings.fallbackModel) errors.push('مدل fallback حافظه معتبر نیست.');
  if (!settings.systemPrompt || settings.systemPrompt.length < 300) errors.push('پرامپت Memory Writer معتبر نیست.');
  if (errors.length > 0) {
    const error = new Error(errors.join(' '));
    error.validationErrors = errors;
    throw error;
  }
  return true;
};

const makeSafeKeyInfo = (apiKeyInfo = {}) => ({
  apiKeySource: apiKeyInfo.apiKeySource || 'missing',
  apiKeySet: Boolean(apiKeyInfo.apiKey),
  apiKeyFingerprint: apiKeyInfo.apiKeyFingerprint || (apiKeyInfo.apiKey ? fingerprintApiKey(apiKeyInfo.apiKey) : '')
});

module.exports = {
  DEFAULT_CONVERSATION_MEMORY_SETTINGS,
  conversationMemorySettingKey,
  makeSafeKeyInfo,
  normalizeConversationMemorySettings,
  validateConversationMemorySettings
};
