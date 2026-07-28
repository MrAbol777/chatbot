'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');

const EXTENSION = Object.freeze({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' });

function createVideoInputMediaStorage({ root }) {
  const resolvedRoot = path.resolve(root);
  const resolveKey = (storageKey) => {
    const full = path.resolve(resolvedRoot, String(storageKey || ''));
    if (!full.startsWith(`${resolvedRoot}${path.sep}`) || path.dirname(full) !== resolvedRoot) throw new Error('VIDEO_INPUT_MEDIA_PATH_INVALID');
    return full;
  };
  return {
    root: resolvedRoot,
    resolveKey,
    async store({ buffer, mimeType }) {
      await fs.promises.mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
      const storageKey = `${randomUUID()}${EXTENSION[mimeType]}`;
      const finalPath = resolveKey(storageKey);
      const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
      const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
      try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
      try { await fs.promises.rename(temporaryPath, finalPath); }
      catch (error) { await fs.promises.unlink(temporaryPath).catch(() => {}); throw error; }
      return { storageKey, sha256: createHash('sha256').update(buffer).digest('hex'), sizeBytes: buffer.length };
    },
    createReadStream(storageKey) { return fs.createReadStream(resolveKey(storageKey)); },
    remove: async (storageKey) => fs.promises.unlink(resolveKey(storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; })
  };
}

module.exports = { createVideoInputMediaStorage };
