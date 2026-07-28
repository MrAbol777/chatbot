'use strict';

const MAGIC = Object.freeze({
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/webp': (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
});

function validateVideoInputImage(buffer, declaredMimeType, maxBytes) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw Object.assign(new Error('Invalid image size.'), { code: 'VIDEO_INPUT_MEDIA_SIZE_INVALID', status: 400 });
  const mimeType = String(declaredMimeType || '').toLowerCase();
  if (!MAGIC[mimeType] || !MAGIC[mimeType](buffer)) throw Object.assign(new Error('Image MIME does not match its content.'), { code: 'VIDEO_INPUT_MEDIA_TYPE_INVALID', status: 400 });
  return { mimeType, sizeBytes: buffer.length };
}

module.exports = { validateVideoInputImage };
