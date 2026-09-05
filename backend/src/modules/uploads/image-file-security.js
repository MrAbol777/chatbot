'use strict';

const MIME_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
});

function normalizeImageMime(value) {
  const mime = String(value || '').trim().toLowerCase();
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return '';

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return '';
}

function areCompatibleImageMimes(claimed, detected) {
  if (claimed === detected) return true;
  const heifFamily = new Set(['image/heic', 'image/heif']);
  return heifFamily.has(claimed) && heifFamily.has(detected);
}

function validateImageBuffer(buffer, claimedMime = '') {
  const claimed = normalizeImageMime(claimedMime);
  const detected = detectImageMime(buffer);
  if (!detected || (claimed && !areCompatibleImageMimes(claimed, detected))) {
    const error = new Error('UNSUPPORTED_IMAGE_FORMAT');
    error.code = 'UNSUPPORTED_IMAGE_FORMAT';
    throw error;
  }
  return detected;
}

function safeProviderImageFilename(mimeType, index = 0) {
  const normalized = normalizeImageMime(mimeType);
  const extension = MIME_EXTENSION[normalized] || 'jpg';
  const safeIndex = Number.isInteger(index) && index >= 0 ? index + 1 : 1;
  return `danoa-image-${safeIndex}.${extension}`;
}

module.exports = {
  normalizeImageMime,
  detectImageMime,
  validateImageBuffer,
  safeProviderImageFilename
};
