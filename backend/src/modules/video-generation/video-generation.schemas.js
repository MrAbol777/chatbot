const { fail } = require('./video-generation.errors');
const clean = (value, max = 191) => String(value || '').trim().slice(0, max);
function validateSubmit(input) {
  if (input?.start_image !== undefined || input?.startImage !== undefined) throw fail('VIDEO_GENERATION_IMAGE_INPUT_DISABLED', 'ورودی تصویر برای این مرحله غیرفعال است.', 409);
  const mode = clean(input.mode, 32);
  if (!['text-to-video', 'image-to-video'].includes(mode)) throw fail('VIDEO_GENERATION_INVALID_MODE', 'روش ساخت ویدیو معتبر نیست.');
  const prompt = clean(input.prompt, 4000);
  if (prompt.length < 3) throw fail('VIDEO_GENERATION_INVALID_PROMPT', 'توضیح ویدیو کافی نیست.');
  const modelKey = clean(input.modelKey, 64);
  if (!/^[a-z0-9_-]{2,64}$/i.test(modelKey)) throw fail('VIDEO_GENERATION_INVALID_MODEL', 'مدل انتخاب‌شده معتبر نیست.');
  return { mode, prompt, modelKey, aspectRatio: clean(input.aspectRatio, 16), duration: clean(input.duration, 32), quality: clean(input.quality, 32), negativePrompt: clean(input.negativePrompt ?? input.negative_prompt, 4000) || null, mediaId: clean(input.mediaId, 191) || null };
}
module.exports = { validateSubmit };
