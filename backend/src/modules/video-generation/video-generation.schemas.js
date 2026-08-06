const { fail } = require('./video-generation.errors');
const clean = (value, max = 191) => String(value || '').trim().slice(0, max);
function normalizeMediaIds(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw fail('VIDEO_GENERATION_INVALID_MEDIA_IDS', 'شناسه‌های رسانه ورودی باید یک آرایه مرتب باشند.', 400);
  if (raw.length === 0) throw fail('VIDEO_GENERATION_INVALID_MEDIA_IDS', 'شناسه‌های رسانه ورودی نمی‌تواند خالی باشد.', 400);
  const ids = raw.map((v) => clean(v, 64)).filter(Boolean);
  if (ids.length !== raw.length) throw fail('VIDEO_GENERATION_INVALID_MEDIA_IDS', 'تمامی شناسه‌های رسانه ورودی باید مقدار معتبر داشته باشند.', 400);
  if (ids.length > 7) throw fail('VIDEO_GENERATION_TOO_MANY_MEDIA', 'حداکثر ۷ تصویر ورودی مجاز است.', 400);
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw fail('VIDEO_GENERATION_DUPLICATE_MEDIA', 'شناسه‌های تکراری تصویر مجاز نیستند.', 400);
  return ids;
}
function validateSubmit(input, { modelKeyRequired = true } = {}) {
  if (input?.start_image !== undefined || input?.startImage !== undefined) throw fail('VIDEO_GENERATION_IMAGE_INPUT_DISABLED', 'ورودی تصویر برای این مرحله غیرفعال است.', 409);
  const requestedMode = clean(input.mode, 32);
  const mode = requestedMode === 'image_to_video' ? 'image-to-video' : requestedMode === 'text_to_video' ? 'text-to-video' : requestedMode;
  if (!['text-to-video', 'image-to-video'].includes(mode)) throw fail('VIDEO_GENERATION_INVALID_MODE', 'روش ساخت ویدیو معتبر نیست.');
  const prompt = clean(input.prompt, 4000);
  if (prompt.length < 3) throw fail('VIDEO_GENERATION_INVALID_PROMPT', 'توضیح ویدیو کافی نیست.');
  const modelKey = clean(input.modelKey, 64) || null;
  if ((modelKeyRequired && !modelKey) || (modelKey && !/^[a-z0-9_-]{2,64}$/i.test(modelKey))) throw fail('VIDEO_GENERATION_INVALID_MODEL', 'مدل انتخاب‌شده معتبر نیست.');
  const resolution = clean(input.resolution ?? input.quality, 32) || null;
  const mediaId = clean(input.mediaId, 64) || null;
  const mediaIds = normalizeMediaIds(input.mediaIds);
  if (mediaId && mediaIds) throw fail('VIDEO_GENERATION_INVALID_MEDIA', 'فقط یکی از mediaId یا mediaIds مجاز است.', 400);
  const effectiveMediaIds = mediaIds && mediaIds.length === 1 ? null : mediaIds;
  const effectiveMediaId = mediaIds && mediaIds.length === 1 ? mediaIds[0] : mediaId;
  return {
    mode,
    prompt,
    modelKey,
    aspectRatio: clean(input.aspectRatio, 16),
    duration: clean(input.duration, 32),
    quality: clean(input.quality, 32),
    resolution,
    negativePrompt: clean(input.negativePrompt ?? input.negative_prompt, 4000) || null,
    generateAudio: Boolean(input.generateAudio),
    mediaId: effectiveMediaId,
    mediaIds: effectiveMediaIds,
    styleKey: clean(input.styleKey, 64) || null
  };
}
module.exports = { validateSubmit, normalizeMediaIds };
