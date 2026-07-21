const METIS_KLING_V25_TURBO_PRO = Object.freeze({
  internalKey: 'metis_kling_v25_turbo_pro',
  provider: 'metis',
  upstreamVendor: 'kwaivgi',
  providerModelId: 'kling-v2.5-turbo-pro',
  upstreamOperation: 'Video Generation',
  displayNameFa: 'کلینگ ۲.۵ توربو پرو',
  displayName: 'Kling v2.5 Turbo Pro',
  descriptionFa: 'مدل مناسب ویدیوهای کوتاه ۵ یا ۱۰ ثانیه‌ای برای شات‌های تبلیغاتی و سوشال است. پشتیبانی upstream از start_image فعلاً در دانوآ غیرفعال است.',
  // Kept disabled until an internal-only activation and live-provider review are approved.
  isActive: false,
  supportsTextToVideo: true,
  supportsImageToVideo: false,
  upstreamSupportsImageToVideo: true,
  upstreamSupportsStartImage: true,
  supportsNegativePrompt: true,
  allowedDurations: [5, 10],
  allowedAspectRatios: ['16:9', '9:16', '1:1'],
  allowedQualities: [],
  maxPromptLength: null,
  quotaUnits: 1,
  sortOrder: 999
});

const REAL_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1']);
const REAL_DURATIONS = new Set([5, 10]);

function validateVideoModelRegistration(model) {
  if (!model || !String(model.internalKey || '').trim() || !String(model.provider || '').trim() || !String(model.providerModelId || '').trim()) throw new Error('Video model registration requires a stable internal key, provider, and provider model ID.');
  if (model.upstreamOperation !== 'Video Generation') throw new Error('Video model operation must match the verified upstream contract exactly.');
  if (!String(model.displayNameFa || '').trim() || !String(model.displayName || '').trim()) throw new Error('Video model registration requires both display titles.');
  if (!Array.isArray(model.allowedDurations) || !model.allowedDurations.length || model.allowedDurations.some((value) => !Number.isInteger(value) || value <= 0 || !REAL_DURATIONS.has(value))) throw new Error('Video model durations must be the verified positive integer allowlist.');
  if (!Array.isArray(model.allowedAspectRatios) || !model.allowedAspectRatios.length || model.allowedAspectRatios.some((value) => !REAL_ASPECT_RATIOS.has(value))) throw new Error('Video model aspect ratios must be the verified allowlist.');
  if (!Array.isArray(model.allowedQualities) || model.allowedQualities.length) throw new Error('Video model quality must remain empty until a real quality enum is verified.');
  if (model.maxPromptLength !== null) throw new Error('Video model maximum prompt length must remain null until verified.');
  if (!Number.isSafeInteger(model.quotaUnits) || model.quotaUnits <= 0) throw new Error('Video model quota units must be a positive safe integer.');
  if (model.supportsImageToVideo || !model.supportsTextToVideo || !model.upstreamSupportsImageToVideo || !model.upstreamSupportsStartImage) throw new Error('The local model must be text-to-video only while preserving the upstream I2V metadata.');
  return model;
}

const VIDEO_MODEL_REGISTRATIONS = Object.freeze([validateVideoModelRegistration(METIS_KLING_V25_TURBO_PRO)]);

module.exports = { METIS_KLING_V25_TURBO_PRO, VIDEO_MODEL_REGISTRATIONS, validateVideoModelRegistration };
