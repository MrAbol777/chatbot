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
  const normalizedModel = String(model || 'gemini-3-pro-image').trim() || 'gemini-3-pro-image';
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
  const imageModel = env.IMAGE_MODEL || 'gemini-3-pro-image';
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
      maxDownloadMb: Number.isFinite(Number(env.IMAGE_MAX_DOWNLOAD_MB)) ? Number(env.IMAGE_MAX_DOWNLOAD_MB) : 10
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
