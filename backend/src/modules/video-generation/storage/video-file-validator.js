const fs = require('fs/promises');
const { VideoStorageError } = require('./video-storage.errors');
const MIME_BY_KIND = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });
function detectVideoKind(buffer) {
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm';
  return null;
}
async function validateVideoFile(filePath, { declaredMimeType, maxBytes }) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new VideoStorageError('VIDEO_RESULT_EMPTY_FILE');
  if (stat.size > maxBytes) throw new VideoStorageError('VIDEO_RESULT_TOO_LARGE');
  const handle = await fs.open(filePath, 'r'); let header;
  try { header = Buffer.alloc(Math.min(32, stat.size)); await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  const kind = detectVideoKind(header);
  if (!kind) throw new VideoStorageError('VIDEO_RESULT_INVALID_SIGNATURE');
  const mimeType = MIME_BY_KIND[kind];
  if (declaredMimeType && String(declaredMimeType).toLowerCase().split(';')[0].trim() !== mimeType) throw new VideoStorageError('VIDEO_RESULT_MIME_MISMATCH');
  return { mimeType, sizeBytes: stat.size, extension: kind === 'mp4' ? '.mp4' : '.webm' };
}
function sanitizeFilename(value, fallback = 'video.mp4') { const name = String(value || '').replace(/[\\/\r\n\0]/g, '_').replace(/[^\w. -]/g, '_').trim().slice(0, 180); return name || fallback; }
module.exports = { validateVideoFile, detectVideoKind, sanitizeFilename };
