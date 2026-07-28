'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { sha256 } = require('./noa.crypto');
const { noaError } = require('./noa.errors');

function detectReceiptImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  return null;
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'receipt')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 255) || 'receipt';
}

function createNoaReceiptStorage({ rootDirectory } = {}) {
  const root = path.resolve(
    rootDirectory ||
    process.env.NOA_RECEIPT_STORAGE_DIR ||
    path.join(process.cwd(), 'data', 'noa-receipts')
  );

  function resolveStorageKey(storageKey) {
    const normalized = String(storageKey || '').replace(/\\/g, '/');
    if (!/^[0-9]{4}\/[0-9]{2}\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(normalized)) {
      throw noaError('NOA_RECEIPT_FILE_NOT_FOUND', 'فایل رسید پیدا نشد.', 404);
    }
    const absolute = path.resolve(root, ...normalized.split('/'));
    const prefix = `${root}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      throw noaError('NOA_RECEIPT_FILE_NOT_FOUND', 'فایل رسید پیدا نشد.', 404);
    }
    return absolute;
  }

  async function save({ buffer, originalFileName }) {
    const detected = detectReceiptImage(buffer);
    if (!detected) {
      throw noaError(
        'NOA_RECEIPT_INVALID_FILE',
        'رسید باید تصویر معتبر JPEG، PNG یا WebP باشد.',
        415
      );
    }
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const fileName = `${randomUUID()}${detected.extension}`;
    const storageKey = `${year}/${month}/${fileName}`;
    const absolute = resolveStorageKey(storageKey);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });
    return {
      storageKey,
      originalFileName: safeOriginalName(originalFileName),
      mimeType: detected.mimeType,
      sizeBytes: buffer.length,
      fileSha256: sha256(buffer)
    };
  }

  async function remove(storageKey) {
    const absolute = resolveStorageKey(storageKey);
    try {
      await fsp.unlink(absolute);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function stat(storageKey) {
    try {
      const result = await fsp.stat(resolveStorageKey(storageKey));
      if (!result.isFile()) {
        throw noaError('NOA_RECEIPT_FILE_NOT_FOUND', 'فایل رسید پیدا نشد.', 404);
      }
      return result;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw noaError('NOA_RECEIPT_FILE_NOT_FOUND', 'فایل رسید پیدا نشد.', 404);
      }
      throw error;
    }
  }

  function createReadStream(storageKey) {
    return fs.createReadStream(resolveStorageKey(storageKey));
  }

  return {
    createReadStream,
    remove,
    rootDirectory: root,
    save,
    stat
  };
}

module.exports = {
  createNoaReceiptStorage,
  detectReceiptImage,
  safeOriginalName
};
