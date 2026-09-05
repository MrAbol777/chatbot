'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const { imageToImageError } = require('./image-to-image.errors');

const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

function createImageToImageStorage({ rootDirectory, maxBytes = 10 * 1024 * 1024 }) {
  const root = path.resolve(rootDirectory);
  const resolveKey = (key) => {
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('IMAGE_TO_IMAGE_STORAGE_KEY_INVALID');
    return resolved;
  };
  const save = async ({ jobId, kind, index, buffer, mimeType }) => {
    if (!EXTENSIONS[mimeType] || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) {
      throw imageToImageError('IMAGE_TO_IMAGE_STORAGE_INPUT_INVALID', 'فایل تصویر معتبر نیست.');
    }
    const key = path.join(jobId, kind, `${index}.${EXTENSIONS[mimeType]}`).replace(/\\/g, '/');
    const target = resolveKey(key);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, buffer, { flag: 'wx' });
    return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), sizeBytes: buffer.length };
  };
  const removeJob = async (jobId) => {
    const normalizedJobId = typeof jobId === 'string' || typeof jobId === 'number' ? String(jobId).trim() : '';
    if (!normalizedJobId) throw new Error('IMAGE_TO_IMAGE_STORAGE_JOB_ID_REQUIRED');
    const target = resolveKey(normalizedJobId);
    if (target === root) throw new Error('IMAGE_TO_IMAGE_STORAGE_JOB_ID_INVALID');
    await fs.remove(target);
  };
  return {
    rootDirectory: root,
    saveInput: (jobId, index, file) => save({ jobId, kind: 'inputs', index, buffer: file.buffer, mimeType: file.mimetype }),
    saveResult: (jobId, result) => save({ jobId, kind: 'result', index: 'image', buffer: result.buffer, mimeType: result.mimeType }),
    read: async (key) => fs.readFile(resolveKey(key)),
    removeJob
  };
}

module.exports = { EXTENSIONS, createImageToImageStorage };
