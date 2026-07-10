const path = require('path');
const crypto = require('crypto');

const normalizePort = (value, fallback = 3000) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
};

const normalizeBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

const normalizePathValue = (value, fallback) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const normalizeProvider = (value, fallback = 'metis') => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (['metis', 'gemini', 'xai', 'openai'].includes(normalized)) return normalized;
  return fallback;
};

const getHostname = (value) => {
  try {
    return new URL(String(value || '')).hostname;
  } catch (_error) {
    return '';
  }
};

const isMetisHost = (value) => /(^|\.)metisai\.ir$/i.test(getHostname(value));

const fingerprintApiKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return '';
  return `sha256:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
};

const pickApiKey = (candidates) => {
  for (const candidate of candidates) {
    const value = typeof candidate.value === 'string' ? candidate.value.trim() : '';
    if (value) {
      return {
        apiKey: value,
        apiKeySource: candidate.source,
        apiKeyFingerprint: fingerprintApiKey(value)
      };
    }
  }
  return {
    apiKey: '',
    apiKeySource: 'missing',
    apiKeyFingerprint: ''
  };
};

const resolveImageRuntimeModel = (model, provider) => {
  const normalizedModel = String(model || 'gemini-2.5-flash-image').trim() || 'gemini-2.5-flash-image';
  const normalizedProvider = normalizeProvider(provider, 'metis');
  if (normalizedProvider === 'metis') {
    const aliases = {
      'gemini-3-pro-image': 'nano-banana-pro',
      'nano-banana-pro': 'nano-banana-pro',
      'gemini-2.5-flash-image': 'nano-banana',
      'gemini-2.5-flash-image-preview': 'nano-banana',
      'nano-banana': 'nano-banana'
    };
    return aliases[normalizedModel.toLowerCase()] || normalizedModel;
  }
  if (normalizedProvider === 'gemini' && normalizedModel.toLowerCase() === 'nano-banana-pro') {
    return 'gemini-3-pro-image';
  }
  return normalizedModel;
};

function loadRuntimeConfig(env = process.env) {
  const port = normalizePort(env.PORT, 3000);
  const host = '0.0.0.0';
  const chatBaseUrl = normalizeBaseUrl(
    env.CHAT_BASE_URL || env.METIS_OPENAI_BASE_URL || env.OPENAI_BASE_URL,
    'https://api.metisai.ir/openai/v1'
  );
  const chatProvider = normalizeProvider(
    env.CHAT_PROVIDER || (isMetisHost(chatBaseUrl) ? 'metis' : 'openai'),
    'metis'
  );
  const defaultModel = env.CHAT_MODEL || env.OPENAI_MODEL || 'gemini-2.5-flash';
  const chatKey =
    chatProvider === 'gemini'
      ? pickApiKey([
          { source: 'GEMINI_CHAT_API_KEY', value: env.GEMINI_CHAT_API_KEY },
          { source: 'legacy GEMINI_API_KEY', value: env.GEMINI_API_KEY }
        ])
      : pickApiKey([
          { source: 'METIS_CHAT_API_KEY', value: env.METIS_CHAT_API_KEY },
          { source: 'legacy METIS_API_KEY', value: env.METIS_API_KEY },
          { source: 'legacy OPENAI_API_KEY', value: env.OPENAI_API_KEY }
        ]);
  const defaultTimeoutMs = Number(env.GAPGPT_TIMEOUT_MS || 30000);
  const adminApiKey = typeof env.ADMIN_API_KEY === 'string' ? env.ADMIN_API_KEY.trim() : '';
  const adminJwtSecret = typeof env.ADMIN_JWT_SECRET === 'string' ? env.ADMIN_JWT_SECRET.trim() : 'danoa-admin-secret';
  const authJwtSecret = typeof env.AUTH_JWT_SECRET === 'string' ? env.AUTH_JWT_SECRET.trim() : adminJwtSecret;
  const adminCookieName = env.ADMIN_COOKIE_NAME || 'admin_token';

  const adminConfigPath = path.join(__dirname, '../../config.json');
  const systemPromptPath = path.join(__dirname, '../../system-prompt.txt');
  const frontendDistPath = path.join(__dirname, '../../../frontend/dist');
  const defaultImageStorageDir =
    env.NODE_ENV === 'production'
      ? '/var/lib/danoa/generated-images'
      : path.join(__dirname, '../../storage/generated-images');

  const imageBaseUrlCandidate = env.IMAGE_BASE_URL || env.GEMINI_BASE_URL || '';
  const imageProvider = normalizeProvider(
    env.IMAGE_PROVIDER || (imageBaseUrlCandidate ? (isMetisHost(imageBaseUrlCandidate) ? 'metis' : 'gemini') : 'metis'),
    'metis'
  );
  const imageBaseUrl = normalizeBaseUrl(
    env.IMAGE_BASE_URL || env.GEMINI_API_BASE_URL || env.GEMINI_BASE_URL,
    imageProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.metisai.ir'
  );
  const imageModel = env.IMAGE_MODEL || 'gemini-2.5-flash-image';
  const imageModelSource = env.IMAGE_MODEL ? 'IMAGE_MODEL' : 'default';
  const imageLegacyModel = env.GEMINI_IMAGE_MODEL || env.METIS_IMAGE_MODEL || '';
  const imageLegacyModelSource = env.GEMINI_IMAGE_MODEL
    ? 'legacy GEMINI_IMAGE_MODEL'
    : env.METIS_IMAGE_MODEL ? 'legacy METIS_IMAGE_MODEL' : '';
  const imageKeys = {
    metis: pickApiKey([
      { source: 'METIS_IMAGE_API_KEY', value: env.METIS_IMAGE_API_KEY },
      { source: 'legacy METIS_API_KEY', value: env.METIS_API_KEY }
    ]),
    gemini: pickApiKey([
      { source: 'GEMINI_IMAGE_API_KEY', value: env.GEMINI_IMAGE_API_KEY },
      { source: 'legacy GEMINI_API_KEY', value: env.GEMINI_API_KEY }
    ]),
    xai: pickApiKey([{ source: 'XAI_IMAGE_API_KEY', value: env.XAI_IMAGE_API_KEY }])
  };
  const imageKey = imageKeys[imageProvider] || pickApiKey([]);
  const imageRuntimeModel = resolveImageRuntimeModel(imageModel, imageProvider);
  const promptRefinerKey = pickApiKey([
    { source: 'METIS_PROMPT_REFINER_API_KEY', value: env.METIS_PROMPT_REFINER_API_KEY }
  ]);
  const visionKey = pickApiKey([
    { source: 'METIS_VISION_API_KEY', value: env.METIS_VISION_API_KEY }
  ]);
  const intentRouterKey = pickApiKey([
    { source: 'METIS_INTENT_ROUTER_API_KEY', value: env.METIS_INTENT_ROUTER_API_KEY }
  ]);
  const conversationMemoryKey = pickApiKey([
    { source: 'METIS_CONVERSATION_MEMORY_API_KEY', value: env.METIS_CONVERSATION_MEMORY_API_KEY }
  ]);
  const defaultConversationMemoryStorageDir =
    env.NODE_ENV === 'production'
      ? '/var/lib/danoa/conversation-memory'
      : path.join(__dirname, '../../storage/conversation-memory');

  const ai = {
    chat: {
      provider: chatProvider,
      baseUrl: chatBaseUrl,
      baseUrlHost: getHostname(chatBaseUrl),
      apiKey: chatKey.apiKey,
      apiKeySource: chatKey.apiKeySource,
      apiKeyFingerprint: chatKey.apiKeyFingerprint,
      model: defaultModel
    },
    image: {
      provider: imageProvider,
      baseUrl: imageBaseUrl,
      baseUrlHost: getHostname(imageBaseUrl),
      apiKey: imageKey.apiKey,
      apiKeySource: imageKey.apiKeySource,
      apiKeyFingerprint: imageKey.apiKeyFingerprint,
      keys: imageKeys,
      model: imageModel,
      modelSource: imageModelSource,
      legacyModel: imageLegacyModel,
      legacyModelSource: imageLegacyModelSource,
      runtimeModel: imageRuntimeModel,
      resolution: env.IMAGE_RESOLUTION || '1K',
      aspectRatio: env.IMAGE_ASPECT_RATIO || '1:1',
      outputFormat: env.IMAGE_OUTPUT_FORMAT || 'jpg',
      safetyFilterLevel: env.IMAGE_SAFETY_FILTER_LEVEL || 'block_only_high',
      storageDir: normalizePathValue(env.IMAGE_STORAGE_DIR, defaultImageStorageDir),
      publicBaseUrl: String(env.IMAGE_PUBLIC_BASE_URL || '/api/images/serve').replace(/\/+$/, ''),
      maxDownloadMb: Number.isFinite(Number(env.IMAGE_MAX_DOWNLOAD_MB)) ? Number(env.IMAGE_MAX_DOWNLOAD_MB) : 10,
      promptRefiner: {
        provider: env.PROMPT_REFINER_PROVIDER || 'metis',
        model: env.PROMPT_REFINER_MODEL || 'gemini-2.5-flash',
        timeoutMs: Number.isFinite(Number(env.PROMPT_REFINER_TIMEOUT_MS)) ? Number(env.PROMPT_REFINER_TIMEOUT_MS) : 6000,
        temperature: Number.isFinite(Number(env.PROMPT_REFINER_TEMPERATURE)) ? Number(env.PROMPT_REFINER_TEMPERATURE) : 0.2,
        maxTokens: Number.isFinite(Number(env.PROMPT_REFINER_MAX_TOKENS)) ? Number(env.PROMPT_REFINER_MAX_TOKENS) : 700,
        apiKey: promptRefinerKey.apiKey,
        apiKeySource: promptRefinerKey.apiKeySource,
        apiKeyFingerprint: promptRefinerKey.apiKeyFingerprint
      }
    },
    vision: {
      enabled: env.VISION_ENABLED !== 'false',
      provider: env.VISION_PROVIDER || 'metis-gemini',
      baseUrl: normalizeBaseUrl(env.VISION_BASE_URL || env.METIS_VISION_BASE_URL, 'https://api.metisai.ir'),
      defaultModel: env.VISION_DEFAULT_MODEL || env.VISION_MODEL || 'gemini-2.5-flash',
      fastModel: env.VISION_FAST_MODEL || 'gemini-2.5-flash',
      experimentalModel: env.VISION_EXPERIMENTAL_MODEL || 'gemini-2.5-flash-lite-preview',
      qualityModel: env.VISION_QUALITY_MODEL || 'gemini-2.5-flash',
      proModel: env.VISION_PRO_MODEL || 'gemini-2.5-pro',
      mode: env.VISION_MODE || 'balanced',
      allowProModel: env.VISION_ALLOW_PRO_MODEL === 'true',
      timeoutMs: Number.isFinite(Number(env.VISION_TIMEOUT_MS)) ? Number(env.VISION_TIMEOUT_MS) : 30000,
      fallbackTimeoutMs: Number.isFinite(Number(env.VISION_FALLBACK_TIMEOUT_MS)) ? Number(env.VISION_FALLBACK_TIMEOUT_MS) : 45000,
      maxImageMb: Number.isFinite(Number(env.VISION_MAX_IMAGE_MB)) ? Number(env.VISION_MAX_IMAGE_MB) : 10,
      transport: env.VISION_TRANSPORT || 'auto',
      mediaResolution: env.VISION_MEDIA_RESOLUTION || 'auto',
      temperature: Number.isFinite(Number(env.VISION_TEMPERATURE)) ? Number(env.VISION_TEMPERATURE) : 0.1,
      maxOutputTokens: Number.isFinite(Number(env.VISION_MAX_OUTPUT_TOKENS)) ? Number(env.VISION_MAX_OUTPUT_TOKENS) : 900,
      modelHealthEnabled: env.VISION_MODEL_HEALTH_ENABLED !== 'false',
      modelHealthFailureThreshold: Number.isFinite(Number(env.VISION_MODEL_HEALTH_FAILURE_THRESHOLD)) ? Number(env.VISION_MODEL_HEALTH_FAILURE_THRESHOLD) : 3,
      modelHealthCooldownMinutes: Number.isFinite(Number(env.VISION_MODEL_HEALTH_COOLDOWN_MINUTES)) ? Number(env.VISION_MODEL_HEALTH_COOLDOWN_MINUTES) : 60,
      apiKey: visionKey.apiKey,
      apiKeySource: visionKey.apiKeySource,
      apiKeyFingerprint: visionKey.apiKeyFingerprint
    },
    intentRouter: {
      enabled: env.INTENT_ROUTER_ENABLED !== 'false',
      provider: env.INTENT_ROUTER_PROVIDER || 'metis',
      model: env.INTENT_ROUTER_MODEL || 'gemini-2.5-flash-lite-preview',
      fallbackModel: env.INTENT_ROUTER_FALLBACK_MODEL || 'gemini-2.5-flash',
      experimentalModel: env.INTENT_ROUTER_EXPERIMENTAL_MODEL || 'gemini-2.5-flash-lite-preview',
      temperature: Number.isFinite(Number(env.INTENT_ROUTER_TEMPERATURE)) ? Number(env.INTENT_ROUTER_TEMPERATURE) : 0,
      maxOutputTokens: Number.isFinite(Number(env.INTENT_ROUTER_MAX_OUTPUT_TOKENS)) ? Number(env.INTENT_ROUTER_MAX_OUTPUT_TOKENS) : 120,
      timeoutMs: Number.isFinite(Number(env.INTENT_ROUTER_TIMEOUT_MS)) ? Number(env.INTENT_ROUTER_TIMEOUT_MS) : 2500,
      confidenceThreshold: Number.isFinite(Number(env.INTENT_ROUTER_CONFIDENCE_THRESHOLD)) ? Number(env.INTENT_ROUTER_CONFIDENCE_THRESHOLD) : 0.65,
      fallbackToHeuristic: env.INTENT_ROUTER_FALLBACK_TO_HEURISTIC !== 'false',
      allowModelFallback: env.INTENT_ROUTER_ALLOW_MODEL_FALLBACK !== 'false',
      allowChatKeyFallback: env.INTENT_ROUTER_ALLOW_CHAT_KEY_FALLBACK === 'true',
      storeMetadata: env.INTENT_ROUTER_STORE_METADATA !== 'false',
      modelHealthEnabled: env.INTENT_ROUTER_MODEL_HEALTH_ENABLED !== 'false',
      modelHealthFailureThreshold: Number.isFinite(Number(env.INTENT_ROUTER_MODEL_HEALTH_FAILURE_THRESHOLD)) ? Number(env.INTENT_ROUTER_MODEL_HEALTH_FAILURE_THRESHOLD) : 3,
      modelHealthCooldownMinutes: Number.isFinite(Number(env.INTENT_ROUTER_MODEL_HEALTH_COOLDOWN_MINUTES)) ? Number(env.INTENT_ROUTER_MODEL_HEALTH_COOLDOWN_MINUTES) : 60,
      apiKey: intentRouterKey.apiKey,
      apiKeySource: intentRouterKey.apiKeySource,
      apiKeyFingerprint: intentRouterKey.apiKeyFingerprint
    },
    conversationMemory: {
      enabled: env.CONVERSATION_MEMORY_ENABLED !== 'false',
      provider: env.CONVERSATION_MEMORY_PROVIDER || 'metis',
      model: env.CONVERSATION_MEMORY_MODEL || 'gemini-2.5-flash-lite-preview',
      fallbackModel: env.CONVERSATION_MEMORY_FALLBACK_MODEL || 'gemini-2.5-flash',
      temperature: Number.isFinite(Number(env.CONVERSATION_MEMORY_TEMPERATURE)) ? Number(env.CONVERSATION_MEMORY_TEMPERATURE) : 0,
      maxOutputTokens: Number.isFinite(Number(env.CONVERSATION_MEMORY_MAX_OUTPUT_TOKENS)) ? Number(env.CONVERSATION_MEMORY_MAX_OUTPUT_TOKENS) : 3000,
      timeoutMs: Number.isFinite(Number(env.CONVERSATION_MEMORY_TIMEOUT_MS)) ? Number(env.CONVERSATION_MEMORY_TIMEOUT_MS) : 8000,
      allowModelFallback: env.CONVERSATION_MEMORY_ALLOW_MODEL_FALLBACK !== 'false',
      allowChatKeyFallback: env.CONVERSATION_MEMORY_ALLOW_CHAT_KEY_FALLBACK === 'true',
      maxDocumentChars: Number.isFinite(Number(env.CONVERSATION_MEMORY_MAX_DOCUMENT_CHARS)) ? Number(env.CONVERSATION_MEMORY_MAX_DOCUMENT_CHARS) : 20000,
      storeMetadata: env.CONVERSATION_MEMORY_STORE_METADATA !== 'false',
      storageDir: normalizePathValue(env.CONVERSATION_MEMORY_STORAGE_DIR, defaultConversationMemoryStorageDir),
      apiKey: conversationMemoryKey.apiKey,
      apiKeySource: conversationMemoryKey.apiKeySource,
      apiKeyFingerprint: conversationMemoryKey.apiKeyFingerprint
    }
  };

  return {
    port,
    host,
    metisBaseUrl: ai.chat.baseUrl,
    defaultModel,
    metisApiKey: ai.chat.apiKey,
    geminiApiKey: ai.image.apiKey,
    geminiImageModel: ai.image.model,
    geminiBaseUrl: ai.image.baseUrl,
    ai,
    defaultTimeoutMs,
    adminApiKey,
    adminJwtSecret,
    authJwtSecret,
    adminCookieName,
    adminConfigPath,
    systemPromptPath,
    frontendDistPath
  };
}

module.exports = {
  loadRuntimeConfig,
  fingerprintApiKey,
  resolveImageRuntimeModel
};
