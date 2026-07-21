const VISION_SETTINGS_CACHE_TTL_MS = 30000;

const DEFAULT_VISION_SYSTEM_PROMPT = [
  'You are a professional image understanding engine for a Persian child-friendly AI product.',
  'Analyze the provided image accurately. Do not guess beyond visible evidence. If something is uncertain, say it is uncertain.',
  'Return the answer in Persian unless the user asks otherwise.',
  'Focus on main subjects, scene context, visible text, colors, style, composition, important details, and age-appropriateness when relevant.',
  'If the user asks to read text, prioritize OCR-like accuracy.',
  'If the image is blurry, rotated, cropped, too small, or unreadable, say so clearly.',
  'Do not hallucinate. Do not identify real people by name. Keep the answer age-appropriate and helpful.'
].join('\n');

const DEFAULT_OCR_PROMPT =
  'Read all visible text in the image exactly as written. Preserve Persian text exactly. If text is unclear, mark it as unclear instead of guessing.';

const DEFAULT_DESIGN_PROMPT =
  'Analyze this design visually. Comment on layout, colors, readability, hierarchy, spacing, and what could be improved. Be concise and practical.';

const DEFAULT_PRODUCT_PROMPT =
  'Describe the product, visible features, color, material, condition, and any readable text. Do not invent brand/model if it is not visible.';

const DEFAULT_VISION_DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_VISION_FAST_MODEL = 'gemini-2.5-flash';
const DEFAULT_VISION_EXPERIMENTAL_MODEL = 'gemini-2.5-flash-lite-preview';
const DEFAULT_VISION_QUALITY_MODEL = 'gemini-2.5-flash';
const DEFAULT_VISION_PRO_MODEL = 'gemini-2.5-pro';

const DEFAULT_VISION_SETTINGS = {
  enabled: true,
  provider: 'metis-gemini',
  defaultModel: DEFAULT_VISION_DEFAULT_MODEL,
  fastModel: DEFAULT_VISION_FAST_MODEL,
  experimentalModel: DEFAULT_VISION_EXPERIMENTAL_MODEL,
  qualityModel: DEFAULT_VISION_QUALITY_MODEL,
  proModel: DEFAULT_VISION_PRO_MODEL,
  model: DEFAULT_VISION_DEFAULT_MODEL,
  mode: 'balanced',
  allowProModel: false,
  timeoutMs: 30000,
  fallbackTimeoutMs: 45000,
  maxImageMb: 10,
  transport: 'auto',
  mediaResolution: 'auto',
  temperature: 0.1,
  maxOutputTokens: 900,
  systemPrompt: DEFAULT_VISION_SYSTEM_PROMPT,
  ocrPrompt: DEFAULT_OCR_PROMPT,
  designAnalysisPrompt: DEFAULT_DESIGN_PROMPT,
  productPrompt: DEFAULT_PRODUCT_PROMPT,
  allowChatKeyFallback: false,
  storeMetadata: true,
  baseUrl: 'https://api.metisai.ir',
  modelHealthEnabled: true,
  modelHealthFailureThreshold: 3,
  modelHealthCooldownMinutes: 60,
  lastValidationStatus: 'valid'
};

const visionSettingKey = {
  enabled: 'ai.vision.enabled',
  provider: 'ai.vision.provider',
  legacyModel: 'ai.vision.model',
  defaultModel: 'ai.vision.default_model',
  fastModel: 'ai.vision.fast_model',
  experimentalModel: 'ai.vision.experimental_model',
  qualityModel: 'ai.vision.quality_model',
  proModel: 'ai.vision.pro_model',
  mode: 'ai.vision.mode',
  allowProModel: 'ai.vision.allow_pro_model',
  timeoutMs: 'ai.vision.timeout_ms',
  fallbackTimeoutMs: 'ai.vision.fallback_timeout_ms',
  maxImageMb: 'ai.vision.max_image_mb',
  transport: 'ai.vision.transport',
  mediaResolution: 'ai.vision.media_resolution',
  temperature: 'ai.vision.temperature',
  maxOutputTokens: 'ai.vision.max_output_tokens',
  systemPrompt: 'ai.vision.system_prompt',
  ocrPrompt: 'ai.vision.ocr_prompt',
  designAnalysisPrompt: 'ai.vision.design_analysis_prompt',
  productPrompt: 'ai.vision.product_prompt',
  allowChatKeyFallback: 'ai.vision.allow_chat_key_fallback',
  storeMetadata: 'ai.vision.store_metadata',
  baseUrl: 'ai.vision.base_url',
  modelHealthEnabled: 'ai.vision.model_health.enabled',
  modelHealthFailureThreshold: 'ai.vision.model_health.failure_threshold',
  modelHealthCooldownMinutes: 'ai.vision.model_health.cooldown_minutes'
};

const ALLOWED_PROVIDERS = ['metis-gemini'];
const ALLOWED_MODES = ['economy', 'balanced', 'accurate', 'pro'];
const ALLOWED_TRANSPORTS = ['inline', 'metis_storage', 'auto'];
const ALLOWED_MEDIA_RESOLUTIONS = ['auto', 'normal', 'high'];

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

const normalizeNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeMode = (value) => {
  const normalized = normalizeString(value, 'balanced').toLowerCase();
  if (normalized === 'quality') return 'accurate';
  if (normalized === 'fast') return 'economy';
  return normalized;
};

const getSetting = (settings, key, fallback) => {
  const value = settings && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined;
  return value === undefined ? fallback : value;
};

const normalizeVisionSettings = ({ settings = {}, visionConfig = {} } = {}) => {
  const mode = normalizeMode(getSetting(settings, visionSettingKey.mode, visionConfig.mode || 'balanced'));
  const provider = normalizeString(getSetting(settings, visionSettingKey.provider, visionConfig.provider || 'metis-gemini'), 'metis-gemini').toLowerCase();
  const transport = normalizeString(getSetting(settings, visionSettingKey.transport, visionConfig.transport || 'auto'), 'auto').toLowerCase();
  const mediaResolution = normalizeString(
    getSetting(settings, visionSettingKey.mediaResolution, visionConfig.mediaResolution || 'auto'),
    'auto'
  ).toLowerCase();
  const legacyModel = normalizeString(getSetting(settings, visionSettingKey.legacyModel, visionConfig.model || ''), '');
  const defaultModel = normalizeString(
    getSetting(settings, visionSettingKey.defaultModel, visionConfig.defaultModel || legacyModel || DEFAULT_VISION_DEFAULT_MODEL),
    DEFAULT_VISION_DEFAULT_MODEL
  );

  return {
    ...DEFAULT_VISION_SETTINGS,
    enabled: normalizeBoolean(getSetting(settings, visionSettingKey.enabled, visionConfig.enabled ?? true), true),
    provider,
    defaultModel,
    fastModel: normalizeString(getSetting(settings, visionSettingKey.fastModel, visionConfig.fastModel || DEFAULT_VISION_FAST_MODEL), DEFAULT_VISION_FAST_MODEL),
    experimentalModel: normalizeString(
      getSetting(settings, visionSettingKey.experimentalModel, visionConfig.experimentalModel || DEFAULT_VISION_EXPERIMENTAL_MODEL),
      DEFAULT_VISION_EXPERIMENTAL_MODEL
    ),
    qualityModel: normalizeString(getSetting(settings, visionSettingKey.qualityModel, visionConfig.qualityModel || DEFAULT_VISION_QUALITY_MODEL), DEFAULT_VISION_QUALITY_MODEL),
    proModel: normalizeString(getSetting(settings, visionSettingKey.proModel, visionConfig.proModel || DEFAULT_VISION_PRO_MODEL), DEFAULT_VISION_PRO_MODEL),
    model: defaultModel,
    mode,
    allowProModel: normalizeBoolean(getSetting(settings, visionSettingKey.allowProModel, visionConfig.allowProModel ?? false), false),
    timeoutMs: normalizeNumber(getSetting(settings, visionSettingKey.timeoutMs, visionConfig.timeoutMs || 30000), 30000),
    fallbackTimeoutMs: normalizeNumber(getSetting(settings, visionSettingKey.fallbackTimeoutMs, visionConfig.fallbackTimeoutMs || 45000), 45000),
    maxImageMb: normalizeNumber(getSetting(settings, visionSettingKey.maxImageMb, visionConfig.maxImageMb || 10), 10),
    transport,
    mediaResolution,
    temperature: normalizeNumber(getSetting(settings, visionSettingKey.temperature, visionConfig.temperature ?? 0.1), 0.1),
    maxOutputTokens: normalizeNumber(getSetting(settings, visionSettingKey.maxOutputTokens, visionConfig.maxOutputTokens || 900), 900),
    systemPrompt: normalizeString(getSetting(settings, visionSettingKey.systemPrompt, visionConfig.systemPrompt || DEFAULT_VISION_SYSTEM_PROMPT), DEFAULT_VISION_SYSTEM_PROMPT),
    ocrPrompt: normalizeString(getSetting(settings, visionSettingKey.ocrPrompt, visionConfig.ocrPrompt || DEFAULT_OCR_PROMPT), DEFAULT_OCR_PROMPT),
    designAnalysisPrompt: normalizeString(
      getSetting(settings, visionSettingKey.designAnalysisPrompt, visionConfig.designAnalysisPrompt || DEFAULT_DESIGN_PROMPT),
      DEFAULT_DESIGN_PROMPT
    ),
    productPrompt: normalizeString(getSetting(settings, visionSettingKey.productPrompt, visionConfig.productPrompt || DEFAULT_PRODUCT_PROMPT), DEFAULT_PRODUCT_PROMPT),
    allowChatKeyFallback: normalizeBoolean(getSetting(settings, visionSettingKey.allowChatKeyFallback, visionConfig.allowChatKeyFallback ?? false), false),
    storeMetadata: normalizeBoolean(getSetting(settings, visionSettingKey.storeMetadata, visionConfig.storeMetadata ?? true), true),
    baseUrl: normalizeString(getSetting(settings, visionSettingKey.baseUrl, visionConfig.baseUrl || 'https://api.metisai.ir'), 'https://api.metisai.ir').replace(/\/+$/, ''),
    modelHealthEnabled: normalizeBoolean(getSetting(settings, visionSettingKey.modelHealthEnabled, visionConfig.modelHealthEnabled ?? true), true),
    modelHealthFailureThreshold: normalizeNumber(
      getSetting(settings, visionSettingKey.modelHealthFailureThreshold, visionConfig.modelHealthFailureThreshold || 3),
      3
    ),
    modelHealthCooldownMinutes: normalizeNumber(
      getSetting(settings, visionSettingKey.modelHealthCooldownMinutes, visionConfig.modelHealthCooldownMinutes || 60),
      60
    ),
    lastValidationStatus: 'valid'
  };
};

const validateVisionSettings = (settings) => {
  const errors = [];
  if (!ALLOWED_PROVIDERS.includes(settings.provider)) errors.push('provider خواندن تصویر معتبر نیست.');
  if (!ALLOWED_MODES.includes(settings.mode)) errors.push('mode خواندن تصویر معتبر نیست.');
  if (!ALLOWED_TRANSPORTS.includes(settings.transport)) errors.push('transport خواندن تصویر معتبر نیست.');
  if (!ALLOWED_MEDIA_RESOLUTIONS.includes(settings.mediaResolution)) errors.push('media resolution خواندن تصویر معتبر نیست.');
  if (settings.timeoutMs < 5000 || settings.timeoutMs > 180000) errors.push('timeout خواندن تصویر باید بین ۵۰۰۰ و ۱۸۰۰۰۰ میلی‌ثانیه باشد.');
  if (settings.fallbackTimeoutMs < 5000 || settings.fallbackTimeoutMs > 180000) errors.push('fallback timeout خواندن تصویر باید بین ۵۰۰۰ و ۱۸۰۰۰۰ میلی‌ثانیه باشد.');
  if (settings.maxImageMb < 1 || settings.maxImageMb > 25) errors.push('حداکثر حجم تصویر Vision باید بین ۱ و ۲۵ مگابایت باشد.');
  if (settings.temperature < 0 || settings.temperature > 2) errors.push('temperature خواندن تصویر باید بین ۰ و ۲ باشد.');
  if (settings.maxOutputTokens < 100 || settings.maxOutputTokens > 8192) errors.push('max output tokens خواندن تصویر معتبر نیست.');
  if (settings.modelHealthFailureThreshold < 1 || settings.modelHealthFailureThreshold > 20) errors.push('آستانه سلامت مدل Vision باید بین ۱ و ۲۰ باشد.');
  if (settings.modelHealthCooldownMinutes < 1 || settings.modelHealthCooldownMinutes > 1440) errors.push('cooldown سلامت مدل Vision باید بین ۱ و ۱۴۴۰ دقیقه باشد.');
  if (settings.enabled && !settings.defaultModel) errors.push('مدل default خواندن تصویر نباید خالی باشد.');
  if (settings.enabled && !settings.fastModel) errors.push('مدل fast خواندن تصویر نباید خالی باشد.');
  if (settings.enabled && !settings.experimentalModel) errors.push('مدل experimental خواندن تصویر نباید خالی باشد.');
  if (settings.enabled && !settings.qualityModel) errors.push('مدل quality خواندن تصویر نباید خالی باشد.');
  if (settings.enabled && !settings.proModel) errors.push('مدل pro خواندن تصویر نباید خالی باشد.');
  if (settings.enabled && !settings.systemPrompt) errors.push('system prompt خواندن تصویر نباید خالی باشد.');

  if (errors.length > 0) {
    const error = new Error(errors.join(' '));
    error.validationErrors = errors;
    throw error;
  }

  return true;
};

function createVisionSettingsResolver({ settingsRepository, visionConfig = {}, ttlMs = VISION_SETTINGS_CACHE_TTL_MS } = {}) {
  let cached = null;
  let cachedAt = 0;
  let lastValid = null;

  const load = async () => {
    const all = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll()
      : {};
    const runtimeSettings = normalizeVisionSettings({ settings: all, visionConfig });
    validateVisionSettings(runtimeSettings);
    cached = runtimeSettings;
    cachedAt = Date.now();
    lastValid = runtimeSettings;
    return runtimeSettings;
  };

  const getRuntimeSettings = async ({ force = false } = {}) => {
    if (!force && cached && Date.now() - cachedAt < ttlMs) {
      return cached;
    }
    try {
      return await load();
    } catch (error) {
      if (lastValid) {
        return {
          ...lastValid,
          lastValidationStatus: 'using-last-valid',
          lastValidationError: error instanceof Error ? error.message : String(error)
        };
      }
      const fallback = normalizeVisionSettings({ settings: {}, visionConfig });
      return {
        ...fallback,
        lastValidationStatus: 'fallback',
        lastValidationError: error instanceof Error ? error.message : String(error)
      };
    }
  };

  return {
    getRuntimeSettings,
    invalidate: () => {
      cached = null;
      cachedAt = 0;
    },
    normalizeVisionSettings,
    validateVisionSettings
  };
}

const visionSettingsPayloadToSettings = (payload = {}) => {
  const raw = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
  return {
    [visionSettingKey.enabled]: raw.enabled,
    [visionSettingKey.provider]: raw.provider,
    [visionSettingKey.legacyModel]: raw.model,
    [visionSettingKey.defaultModel]: raw.defaultModel,
    [visionSettingKey.fastModel]: raw.fastModel,
    [visionSettingKey.experimentalModel]: raw.experimentalModel,
    [visionSettingKey.qualityModel]: raw.qualityModel,
    [visionSettingKey.proModel]: raw.proModel,
    [visionSettingKey.mode]: raw.mode,
    [visionSettingKey.allowProModel]: raw.allowProModel,
    [visionSettingKey.timeoutMs]: raw.timeoutMs,
    [visionSettingKey.fallbackTimeoutMs]: raw.fallbackTimeoutMs,
    [visionSettingKey.maxImageMb]: raw.maxImageMb,
    [visionSettingKey.transport]: raw.transport,
    [visionSettingKey.mediaResolution]: raw.mediaResolution,
    [visionSettingKey.temperature]: raw.temperature,
    [visionSettingKey.maxOutputTokens]: raw.maxOutputTokens,
    [visionSettingKey.systemPrompt]: raw.systemPrompt,
    [visionSettingKey.ocrPrompt]: raw.ocrPrompt,
    [visionSettingKey.designAnalysisPrompt]: raw.designAnalysisPrompt,
    [visionSettingKey.productPrompt]: raw.productPrompt,
    [visionSettingKey.allowChatKeyFallback]: raw.allowChatKeyFallback,
    [visionSettingKey.storeMetadata]: raw.storeMetadata,
    [visionSettingKey.baseUrl]: raw.baseUrl,
    [visionSettingKey.modelHealthEnabled]: raw.modelHealthEnabled,
    [visionSettingKey.modelHealthFailureThreshold]: raw.modelHealthFailureThreshold,
    [visionSettingKey.modelHealthCooldownMinutes]: raw.modelHealthCooldownMinutes
  };
};

module.exports = {
  ALLOWED_MEDIA_RESOLUTIONS,
  ALLOWED_MODES,
  ALLOWED_PROVIDERS,
  ALLOWED_TRANSPORTS,
  DEFAULT_DESIGN_PROMPT,
  DEFAULT_OCR_PROMPT,
  DEFAULT_PRODUCT_PROMPT,
  DEFAULT_VISION_DEFAULT_MODEL,
  DEFAULT_VISION_EXPERIMENTAL_MODEL,
  DEFAULT_VISION_FAST_MODEL,
  DEFAULT_VISION_PRO_MODEL,
  DEFAULT_VISION_QUALITY_MODEL,
  DEFAULT_VISION_SETTINGS,
  DEFAULT_VISION_SYSTEM_PROMPT,
  VISION_SETTINGS_CACHE_TTL_MS,
  createVisionSettingsResolver,
  normalizeVisionSettings,
  validateVisionSettings,
  visionSettingKey,
  visionSettingsPayloadToSettings
};
