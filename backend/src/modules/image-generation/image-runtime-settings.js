const { resolveImageRuntimeModel } = require('../../bootstrap/config');

const IMAGE_SETTINGS_CACHE_TTL_MS = 30000;
const DEFAULT_IMAGE_ADMIN_MODEL = 'gemini-3-pro-image';
const DEFAULT_IMAGE_RUNTIME_MODEL = 'nano-banana-pro';
const DEFAULT_IMAGE_RUNTIME_PROVIDER_NAME = 'google';
const DEFAULT_IMAGE_OPERATION = 'Imagine';
const DEFAULT_NEGATIVE_PROMPT = 'no humans, no unrelated objects, no text distortion, no watermark';

const ALLOWED_PROVIDERS = ['metis', 'gemini', 'xai'];
const ALLOWED_RESOLUTIONS = ['1K', '2K'];
const ALLOWED_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const ALLOWED_OUTPUT_FORMATS = ['jpg', 'png'];
const ALLOWED_SAFETY_LEVELS = ['block_low_and_above', 'block_medium_and_above', 'block_only_high', 'block_none'];

const IMAGE_MODEL_PRESETS = [
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    adminValue: 'gemini-3-pro-image',
    provider: 'metis',
    runtimeProviderName: 'google',
    runtimeModel: 'nano-banana-pro',
    operation: 'Imagine',
    supportsTextToImage: true,
    supportsImageEdit: true,
    defaultResolution: '1K',
    allowedResolutions: ['1K', '2K'],
    allowedAspectRatios: ALLOWED_ASPECT_RATIOS,
    allowedOutputFormats: ['jpg', 'png'],
    allowedSafetyLevels: ['block_low_and_above', 'block_medium_and_above', 'block_only_high']
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana',
    adminValue: 'gemini-2.5-flash-image',
    provider: 'metis',
    runtimeProviderName: 'google',
    runtimeModel: 'nano-banana',
    operation: 'Imagine',
    supportsTextToImage: true,
    supportsImageEdit: true,
    defaultResolution: '1K'
  },
  {
    id: 'flux-schnell',
    label: 'Flux Schnell',
    adminValue: 'flux-schnell',
    provider: 'metis',
    runtimeProviderName: 'black-forest-labs',
    runtimeModel: 'flux-schnell',
    operation: 'Imagine',
    supportsTextToImage: true,
    supportsImageEdit: false,
    defaultResolution: '1K'
  },
  {
    id: 'custom',
    label: 'Custom',
    adminValue: 'custom',
    provider: 'metis',
    runtimeProviderName: '',
    runtimeModel: '',
    operation: 'Imagine',
    supportsTextToImage: true,
    supportsImageEdit: false,
    defaultResolution: '1K'
  }
];

const DEFAULT_IMAGE_RUNTIME_SETTINGS = {
  enabled: true,
  provider: 'metis',
  modelPreset: 'nano-banana-pro',
  modelAdminValue: DEFAULT_IMAGE_ADMIN_MODEL,
  runtimeProviderName: DEFAULT_IMAGE_RUNTIME_PROVIDER_NAME,
  runtimeModel: DEFAULT_IMAGE_RUNTIME_MODEL,
  operation: DEFAULT_IMAGE_OPERATION,
  resolution: '1K',
  aspectRatio: '1:1',
  outputFormat: 'jpg',
  safetyFilterLevel: 'block_only_high',
  promptEnhancerEnabled: true,
  defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  pollIntervalMs: 2000,
  pollTimeoutMs: 120000,
  maxDownloadMb: 10,
  editEnabled: false,
  customArgsJson: '{}',
  customArgs: {},
  modelSource: 'default',
  lastValidationStatus: 'valid'
};

const settingKey = {
  enabled: 'ai.image.enabled',
  provider: 'ai.image.provider',
  modelPreset: 'ai.image.model_preset',
  legacyModel: 'ai.image.model',
  modelAdminValue: 'ai.image.model.admin_value',
  runtimeProviderName: 'ai.image.model.runtime_provider_name',
  runtimeModel: 'ai.image.model.runtime_model',
  operation: 'ai.image.operation',
  resolution: 'ai.image.resolution',
  aspectRatio: 'ai.image.aspect_ratio',
  outputFormat: 'ai.image.output_format',
  safetyFilterLevel: 'ai.image.safety_filter_level',
  promptEnhancerEnabled: 'ai.image.prompt_enhancer_enabled',
  defaultNegativePrompt: 'ai.image.default_negative_prompt',
  pollIntervalMs: 'ai.image.poll_interval_ms',
  pollTimeoutMs: 'ai.image.poll_timeout_ms',
  maxDownloadMb: 'ai.image.max_download_mb',
  editEnabled: 'ai.image.edit_enabled',
  customArgsJson: 'ai.image.custom_args_json',
  baseUrl: 'ai.image.base_url'
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

const normalizeNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const findPreset = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return IMAGE_MODEL_PRESETS.find((preset) => (
    preset.id === normalized ||
    String(preset.adminValue || '').toLowerCase() === normalized ||
    String(preset.runtimeModel || '').toLowerCase() === normalized
  )) || null;
};

const parseCustomArgs = (value) => {
  if (!value || value === '{}') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const parsed = JSON.parse(String(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('custom_args_json باید یک JSON object معتبر باشد.');
  }
  return parsed;
};

const validateRuntimeSettings = (settings) => {
  const errors = [];
  if (!ALLOWED_PROVIDERS.includes(settings.provider)) errors.push('provider ساخت تصویر معتبر نیست.');
  if (!ALLOWED_RESOLUTIONS.includes(settings.resolution)) errors.push('رزولوشن تصویر معتبر نیست.');
  if (!ALLOWED_ASPECT_RATIOS.includes(settings.aspectRatio)) errors.push('نسبت تصویر معتبر نیست.');
  if (!ALLOWED_OUTPUT_FORMATS.includes(settings.outputFormat)) errors.push('فرمت خروجی تصویر معتبر نیست.');
  if (!ALLOWED_SAFETY_LEVELS.includes(settings.safetyFilterLevel)) errors.push('سطح safety filter معتبر نیست.');
  if (settings.pollIntervalMs < 500 || settings.pollIntervalMs > 10000) errors.push('poll interval باید بین ۵۰۰ و ۱۰۰۰۰ میلی‌ثانیه باشد.');
  if (settings.pollTimeoutMs < 10000 || settings.pollTimeoutMs > 300000) errors.push('poll timeout باید بین ۱۰۰۰۰ و ۳۰۰۰۰۰ میلی‌ثانیه باشد.');
  if (settings.maxDownloadMb < 1 || settings.maxDownloadMb > 25) errors.push('حداکثر حجم دانلود باید بین ۱ و ۲۵ مگابایت باشد.');
  if (settings.enabled && !settings.runtimeModel) errors.push('مدل runtime ساخت تصویر نباید خالی باشد.');
  if (settings.enabled && settings.provider === 'metis' && !settings.runtimeProviderName) {
    errors.push('runtime provider name برای Metis نباید خالی باشد.');
  }
  if (!settings.operation) errors.push('operation ساخت تصویر نباید خالی باشد.');

  try {
    parseCustomArgs(settings.customArgsJson);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'custom_args_json معتبر نیست.');
  }

  if (errors.length > 0) {
    const error = new Error(errors.join(' '));
    error.validationErrors = errors;
    throw error;
  }

  return true;
};

const getSetting = (settings, key, fallback) => {
  const value = settings && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined;
  return value === undefined ? fallback : value;
};

const normalizeRuntimeSettings = ({ settings = {}, stored = {}, imageConfig = {} } = {}) => {
  const legacyModel = normalizeString(stored[settingKey.legacyModel] || settings[settingKey.legacyModel], '');
  const adminModelFromDb = normalizeString(stored[settingKey.modelAdminValue] || settings[settingKey.modelAdminValue], '');
  const envModel = normalizeString(imageConfig.model, '');
  const modelAdminValue = adminModelFromDb || legacyModel || envModel || DEFAULT_IMAGE_ADMIN_MODEL;
  const preset = findPreset(getSetting(settings, settingKey.modelPreset, modelAdminValue)) || findPreset(modelAdminValue) || IMAGE_MODEL_PRESETS[0];
  const provider = normalizeString(getSetting(settings, settingKey.provider, imageConfig.provider || preset.provider), 'metis').toLowerCase();
  const runtimeModel = normalizeString(
    getSetting(settings, settingKey.runtimeModel, '') || preset.runtimeModel || resolveImageRuntimeModel(modelAdminValue, provider),
    DEFAULT_IMAGE_RUNTIME_MODEL
  );
  const runtimeProviderName = normalizeString(
    getSetting(settings, settingKey.runtimeProviderName, '') || preset.runtimeProviderName,
    provider === 'metis' ? DEFAULT_IMAGE_RUNTIME_PROVIDER_NAME : provider
  );
  let customArgs = {};
  const customArgsJson = typeof getSetting(settings, settingKey.customArgsJson, '{}') === 'string'
    ? getSetting(settings, settingKey.customArgsJson, '{}')
    : JSON.stringify(getSetting(settings, settingKey.customArgsJson, {}));
  try {
    customArgs = parseCustomArgs(customArgsJson);
  } catch (_error) {
    customArgs = {};
  }

  const modelSource = adminModelFromDb
    ? settingKey.modelAdminValue
    : legacyModel ? settingKey.legacyModel : imageConfig.modelSource || 'default';

  return {
    ...DEFAULT_IMAGE_RUNTIME_SETTINGS,
    enabled: normalizeBoolean(getSetting(settings, settingKey.enabled, true), true),
    provider,
    baseUrl: normalizeString(getSetting(settings, settingKey.baseUrl, imageConfig.baseUrl || 'https://api.metisai.ir'), 'https://api.metisai.ir'),
    modelPreset: normalizeString(getSetting(settings, settingKey.modelPreset, preset.id), preset.id),
    modelAdminValue,
    runtimeProviderName,
    runtimeModel,
    operation: normalizeString(getSetting(settings, settingKey.operation, preset.operation || DEFAULT_IMAGE_OPERATION), DEFAULT_IMAGE_OPERATION),
    resolution: normalizeString(getSetting(settings, settingKey.resolution, imageConfig.resolution || preset.defaultResolution || '1K'), '1K'),
    aspectRatio: normalizeString(getSetting(settings, settingKey.aspectRatio, imageConfig.aspectRatio || '1:1'), '1:1'),
    outputFormat: normalizeString(getSetting(settings, settingKey.outputFormat, imageConfig.outputFormat || 'jpg'), 'jpg'),
    safetyFilterLevel: normalizeString(getSetting(settings, settingKey.safetyFilterLevel, imageConfig.safetyFilterLevel || 'block_only_high'), 'block_only_high'),
    promptEnhancerEnabled: normalizeBoolean(getSetting(settings, settingKey.promptEnhancerEnabled, true), true),
    defaultNegativePrompt: normalizeString(getSetting(settings, settingKey.defaultNegativePrompt, DEFAULT_NEGATIVE_PROMPT), DEFAULT_NEGATIVE_PROMPT),
    pollIntervalMs: normalizeNumber(getSetting(settings, settingKey.pollIntervalMs, 2000), 2000),
    pollTimeoutMs: normalizeNumber(getSetting(settings, settingKey.pollTimeoutMs, 120000), 120000),
    maxDownloadMb: normalizeNumber(getSetting(settings, settingKey.maxDownloadMb, imageConfig.maxDownloadMb || 10), 10),
    editEnabled: normalizeBoolean(getSetting(settings, settingKey.editEnabled, false), false),
    customArgsJson,
    customArgs,
    modelSource,
    lastValidationStatus: 'valid'
  };
};

const buildMetisRequestBody = ({ prompt, runtimeSettings, imageInput = [] }) => ({
  model: {
    name: runtimeSettings.runtimeProviderName,
    model: runtimeSettings.runtimeModel
  },
  operation: runtimeSettings.operation,
  args: {
    prompt,
    aspect_ratio: runtimeSettings.aspectRatio,
    resolution: runtimeSettings.resolution,
    output_format: runtimeSettings.outputFormat,
    safety_filter_level: runtimeSettings.safetyFilterLevel,
    ...runtimeSettings.customArgs,
    ...(Array.isArray(imageInput) && imageInput.length > 0 && runtimeSettings.editEnabled ? { image_input: imageInput } : {})
  }
});

function createImageRuntimeSettingsResolver({ settingsRepository, imageConfig = {}, ttlMs = IMAGE_SETTINGS_CACHE_TTL_MS } = {}) {
  let cached = null;
  let cachedAt = 0;
  let lastValid = null;

  const getStoredSettings = async () => {
    if (!settingsRepository || typeof settingsRepository.getStored !== 'function') return {};
    const pairs = await Promise.all(
      Object.values(settingKey).map(async (key) => [key, await settingsRepository.getStored(key).catch(() => undefined)])
    );
    return Object.fromEntries(pairs.filter(([, value]) => value !== undefined));
  };

  const load = async () => {
    const all = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll()
      : {};
    const stored = await getStoredSettings();
    const runtimeSettings = normalizeRuntimeSettings({ settings: all, stored, imageConfig });
    validateRuntimeSettings(runtimeSettings);
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
      const fallback = normalizeRuntimeSettings({ settings: {}, stored: {}, imageConfig });
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
    validateRuntimeSettings,
    normalizeRuntimeSettings,
    buildMetisRequestBody,
    getPresets: () => IMAGE_MODEL_PRESETS
  };
}

const imageSettingsPayloadToSettings = (payload = {}) => {
  const raw = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
  const preset = findPreset(raw.modelPreset || raw[settingKey.modelPreset]);
  return {
    [settingKey.enabled]: raw.enabled,
    [settingKey.provider]: raw.provider,
    [settingKey.modelPreset]: raw.modelPreset,
    [settingKey.legacyModel]: raw.modelAdminValue,
    [settingKey.modelAdminValue]: raw.modelAdminValue,
    [settingKey.runtimeProviderName]: raw.runtimeProviderName ?? preset?.runtimeProviderName,
    [settingKey.runtimeModel]: raw.runtimeModel ?? preset?.runtimeModel,
    [settingKey.operation]: raw.operation,
    [settingKey.resolution]: raw.resolution,
    [settingKey.aspectRatio]: raw.aspectRatio,
    [settingKey.outputFormat]: raw.outputFormat,
    [settingKey.safetyFilterLevel]: raw.safetyFilterLevel,
    [settingKey.promptEnhancerEnabled]: raw.promptEnhancerEnabled,
    [settingKey.defaultNegativePrompt]: raw.defaultNegativePrompt,
    [settingKey.pollIntervalMs]: raw.pollIntervalMs,
    [settingKey.pollTimeoutMs]: raw.pollTimeoutMs,
    [settingKey.maxDownloadMb]: raw.maxDownloadMb,
    [settingKey.editEnabled]: raw.editEnabled,
    [settingKey.customArgsJson]: raw.customArgsJson
  };
};

module.exports = {
  ALLOWED_ASPECT_RATIOS,
  ALLOWED_OUTPUT_FORMATS,
  ALLOWED_PROVIDERS,
  ALLOWED_RESOLUTIONS,
  ALLOWED_SAFETY_LEVELS,
  DEFAULT_IMAGE_RUNTIME_SETTINGS,
  IMAGE_MODEL_PRESETS,
  IMAGE_SETTINGS_CACHE_TTL_MS,
  buildMetisRequestBody,
  createImageRuntimeSettingsResolver,
  imageSettingsPayloadToSettings,
  normalizeRuntimeSettings,
  settingKey,
  validateRuntimeSettings
};
