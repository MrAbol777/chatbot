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
  sortOrder: 999
});

const BANANAAI_MODEL_IDS = Object.freeze([
  'kling-v3-turbo',
  'seedance-2',
  'seedance-2-mini',
  'grok-imagine-video',
  'gemini-omni-video',
  'kling-3.0'
]);

const BANANAAI_IMAGE_TO_VIDEO_MODEL_ID = 'grok-imagine-video';
const BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY = 'bananaai_grok_imagine_video';
const BANANAAI_GROK_I2V_DURATIONS = Object.freeze(Array.from({ length: 15 }, (_, index) => index + 1));
const BANANAAI_GROK_I2V_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1']);
// 720p is intentionally withheld from the product while it is under review.
// Keep the provider adapter unchanged so it can be re-enabled by restoring this allowlist.
const BANANAAI_GROK_I2V_RESOLUTIONS = Object.freeze(['480p']);

const BANANAAI_VIDEO_MODEL_REGISTRATIONS = Object.freeze(BANANAAI_MODEL_IDS.map((providerModelId, index) => {
  const isProductImageToVideoModel = providerModelId === BANANAAI_IMAGE_TO_VIDEO_MODEL_ID;
  return Object.freeze({
  internalKey: `bananaai_${providerModelId.replace(/[^a-z0-9]+/g, '_')}`,
  provider: 'bananaai',
  providerModelId,
  upstreamOperation: null,
  displayNameFa: providerModelId,
  displayName: providerModelId,
  descriptionFa: isProductImageToVideoModel ? 'مدل ثابت ساخت ویدیو از تصویر برای هر دو سبک سینمایی و انیمیشنی.' : 'مدل BananaAI؛ خارج از مسیر عمومی فعلی و غیرفعال است.',
  isActive: isProductImageToVideoModel,
  isPublic: false,
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  upstreamSupportsImageToVideo: true,
  upstreamSupportsStartImage: true,
  supportsNegativePrompt: false,
  supportsAudio: false,
  supportsFirstFrame: false,
  supportsLastFrame: false,
  supportsIdempotency: false,
  supportsWebhook: false,
  allowedDurations: isProductImageToVideoModel ? [...BANANAAI_GROK_I2V_DURATIONS] : [],
  allowedAspectRatios: isProductImageToVideoModel ? [...BANANAAI_GROK_I2V_ASPECT_RATIOS] : [],
  allowedResolutions: isProductImageToVideoModel ? [...BANANAAI_GROK_I2V_RESOLUTIONS] : [],
  allowedQualities: [],
  maxPromptLength: isProductImageToVideoModel ? 2000 : null,
  maxInputBytes: null,
  costConfig: { estimate: null, status: 'NOT_DOCUMENTED' },
  capabilityConfig: { contractSource: 'bananaai_official_docs', readiness: isProductImageToVideoModel ? 'ACTIVATION_REQUIRED' : 'BLOCKED', productRole: isProductImageToVideoModel ? 'image_to_video_primary' : null },
  providerConfig: { requestContract: 'OFFICIAL_DOCS_VERIFIED', resultContract: 'LIVE_VALIDATION_REQUIRED' },
  sortOrder: 1100 + index
  });
}));

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
  if (model.supportsImageToVideo || !model.supportsTextToVideo || !model.upstreamSupportsImageToVideo || !model.upstreamSupportsStartImage) throw new Error('The local model must be text-to-video only while preserving the upstream I2V metadata.');
  return model;
}

function validateBananaAiVideoModelRegistration(model) {
  if (!model || model.provider !== 'bananaai' || !BANANAAI_MODEL_IDS.includes(model.providerModelId)) throw new Error('BananaAI model must use an official documented provider model ID.');
  const isProductImageToVideoModel = model.providerModelId === BANANAAI_IMAGE_TO_VIDEO_MODEL_ID;
  if (model.isPublic || Boolean(model.isActive) !== isProductImageToVideoModel) throw new Error('Only the private Grok image-to-video model may be active by seed.');
  if (!model.supportsTextToVideo || !model.supportsImageToVideo) throw new Error('BananaAI video models must declare both documented video endpoints.');
  if (model.supportsNegativePrompt || model.supportsAudio || model.supportsFirstFrame || model.supportsLastFrame || model.supportsIdempotency || model.supportsWebhook) throw new Error('Undocumented BananaAI per-model capabilities must remain disabled.');
  if (model.maxInputBytes !== null || model.costConfig?.estimate !== null) throw new Error('Undocumented BananaAI input limits and cost estimates must remain null.');
  if (isProductImageToVideoModel) {
    if (model.internalKey !== BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY || JSON.stringify(model.allowedDurations) !== JSON.stringify(BANANAAI_GROK_I2V_DURATIONS) || JSON.stringify(model.allowedAspectRatios) !== JSON.stringify(BANANAAI_GROK_I2V_ASPECT_RATIOS) || JSON.stringify(model.allowedResolutions) !== JSON.stringify(BANANAAI_GROK_I2V_RESOLUTIONS) || model.maxPromptLength !== 2000) throw new Error('Grok image-to-video product settings must match the verified local allowlist.');
  } else if (model.allowedDurations.length || model.allowedAspectRatios.length || model.allowedResolutions.length || model.maxPromptLength !== null) {
    throw new Error('Inactive BananaAI models must not advertise unverified public settings.');
  }
  return model;
}

const VIDEO_MODEL_REGISTRATIONS = Object.freeze([
  validateVideoModelRegistration(METIS_KLING_V25_TURBO_PRO),
  ...BANANAAI_VIDEO_MODEL_REGISTRATIONS.map(validateBananaAiVideoModelRegistration)
]);

module.exports = {
  METIS_KLING_V25_TURBO_PRO,
  BANANAAI_MODEL_IDS,
  BANANAAI_IMAGE_TO_VIDEO_MODEL_ID,
  BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY,
  BANANAAI_GROK_I2V_DURATIONS,
  BANANAAI_GROK_I2V_ASPECT_RATIOS,
  BANANAAI_GROK_I2V_RESOLUTIONS,
  BANANAAI_VIDEO_MODEL_REGISTRATIONS,
  VIDEO_MODEL_REGISTRATIONS,
  validateVideoModelRegistration,
  validateBananaAiVideoModelRegistration
};
