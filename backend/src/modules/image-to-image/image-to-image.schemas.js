'use strict';

const { imageToImageError } = require('./image-to-image.errors');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16']);

function validateSubmit({ prompt, aspectRatio = '1:1', files }) {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedAspectRatio = String(aspectRatio || '1:1').trim();
  if (normalizedPrompt.length < 3 || normalizedPrompt.length > 2_000) {
    throw imageToImageError('IMAGE_TO_IMAGE_PROMPT_INVALID', 'متن ویرایش باید بین ۳ تا ۲۰۰۰ کاراکتر باشد.');
  }
  if (!ALLOWED_ASPECT_RATIOS.has(normalizedAspectRatio)) {
    throw imageToImageError('IMAGE_TO_IMAGE_ASPECT_RATIO_INVALID', 'نسبت تصویر انتخاب‌شده مجاز نیست.');
  }
  if (!Array.isArray(files) || files.length < 1 || files.length > 4) {
    throw imageToImageError('IMAGE_TO_IMAGE_INPUT_COUNT_INVALID', 'بین ۱ تا ۴ تصویر ورودی لازم است.');
  }
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file?.mimetype) || !Buffer.isBuffer(file?.buffer) || !file.buffer.length) {
      throw imageToImageError('IMAGE_TO_IMAGE_INPUT_INVALID', 'فقط فایل‌های JPEG، PNG و WebP معتبر هستند.');
    }
  }
  return { prompt: normalizedPrompt, aspectRatio: normalizedAspectRatio };
}

module.exports = { ALLOWED_MIME_TYPES, validateSubmit };
