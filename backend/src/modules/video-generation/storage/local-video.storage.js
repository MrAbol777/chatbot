const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { VideoStorageError } = require('./video-storage.errors');
const { validateVideoFile } = require('./video-file-validator');

function createLocalVideoStorage(config) {
  const root = path.resolve(config.root); const tempRoot = path.resolve(config.temporaryRoot || path.join(root, '.tmp'));
  const injectFault = process.env.NODE_ENV === 'test' && typeof config.faultInjector === 'function' ? async (point) => config.faultInjector(point) : async () => {};
  const inside = (candidate, base = root) => candidate === base || candidate.startsWith(`${base}${path.sep}`);
  async function ensureRoots() { await fsp.mkdir(tempRoot, { recursive: true }); for (const directory of [root, tempRoot]) { const stat = await fsp.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE'); } }
  function resolveSafeKey(key) { const value = String(key || '').replace(/\\/g, '/'); if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,240}\.(mp4|webm)$/.test(value) || value.includes('..')) throw new VideoStorageError('VIDEO_STORAGE_INVALID_KEY'); const target = path.resolve(root, value); if (!inside(target)) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE'); return target; }
  function temporaryPathForKey(key) { resolveSafeKey(key); return path.join(tempRoot, `${crypto.createHash('sha256').update(String(key)).digest('hex')}.part`); }
  async function assertRegular(file) { const real = await fsp.realpath(file).catch(() => null); if (real && !inside(real)) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE'); const stat = await fsp.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new VideoStorageError('VIDEO_STORAGE_INVALID_FILE'); return stat; }
  return {
    async createTemporaryTarget(key = null) {
      await injectFault('before_temp_file');
      await ensureRoots();
      const target = key ? temporaryPathForKey(key) : path.join(tempRoot, `${crypto.randomUUID()}.part`);
      try {
        const handle = await fsp.open(target, 'wx', 0o600);
        await handle.close();
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await assertRegular(target);
      }
      await injectFault('after_temp_file');
      return target;
    },
    async writeStream(stream, temporaryPath) {
      await ensureRoots(); if (!inside(path.resolve(temporaryPath), tempRoot)) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE');
      let bytes = 0; let wroteChunk = false; const hash = crypto.createHash('sha256'); const limiter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > config.maxBytes) return callback(new VideoStorageError('VIDEO_RESULT_TOO_LARGE')); hash.update(chunk); if (!wroteChunk) { wroteChunk = true; Promise.resolve(injectFault('mid_write_stream')).then(() => callback(null, chunk), callback); return; } callback(null, chunk); } });
      try { await pipeline(stream, limiter, fs.createWriteStream(temporaryPath, { flags: 'w', mode: 0o600 })); await injectFault('after_stream_complete'); return { bytes, sha256: hash.digest('hex') }; }
      catch (error) { if (process.env.NODE_ENV === 'test' && error?.simulateCrash) throw error; await fsp.unlink(temporaryPath).catch(() => {}); if (error instanceof VideoStorageError) throw error; throw new VideoStorageError('VIDEO_RESULT_STREAM_INTERRUPTED', undefined, { retryable: true }); }
    },
    async validateStoredFile(filePath, options) { const validation = await validateVideoFile(filePath, { ...options, maxBytes: config.maxBytes }); await injectFault('after_validation'); return validation; },
    async commitTemporaryFile(temporaryPath, key) {
      const destination = resolveSafeKey(key);
      if (!inside(path.resolve(temporaryPath), tempRoot)) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE');
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      const [realRoot, realParent] = await Promise.all([fsp.realpath(root), fsp.realpath(path.dirname(destination))]);
      if (!inside(realParent, realRoot)) throw new VideoStorageError('VIDEO_STORAGE_PATH_ESCAPE');
      const existing = await fsp.lstat(destination).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) throw new VideoStorageError('VIDEO_STORAGE_INVALID_FILE');
        return destination;
      }
      await injectFault('before_atomic_rename');
      // link(2) is an atomic no-clobber commit on the same filesystem. fs.rename
      // may overwrite an existing result on POSIX, which breaks recovery races.
      try {
        await fsp.link(temporaryPath, destination);
        await fsp.unlink(temporaryPath);
      } catch (error) {
        if (error.code === 'EEXIST') {
          const winner = await assertRegular(destination);
          if (!winner.isFile()) throw new VideoStorageError('VIDEO_STORAGE_INVALID_FILE');
          return destination;
        }
        throw new VideoStorageError('VIDEO_STORAGE_COMMIT_FAILED', undefined, { retryable: true });
      }
      await injectFault('after_atomic_rename');
      return destination;
    },
    async exists(key) { const file = resolveSafeKey(key); try { await assertRegular(file); return true; } catch (error) { if (error instanceof VideoStorageError) throw error; if (error?.code === 'ENOENT') return false; throw error; } },
    openReadStream(key, options = {}) { const file = resolveSafeKey(key); return fs.createReadStream(file, options); },
    async stat(key) { return assertRegular(resolveSafeKey(key)); },
    async hasTemporary(file) { try { await assertRegular(file); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } },
    async remove(key) { await fsp.unlink(resolveSafeKey(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); },
    async removeTemporary(file) { if (inside(path.resolve(file), tempRoot)) { await injectFault('before_temp_cleanup'); await fsp.unlink(file).catch(() => {}); } },
    resolveSafeKey,
    temporaryPathForKey,
    async cleanupTemporary({ maxAgeMinutes = config.tempMaxAgeMinutes, limit = 100 } = {}) { await ensureRoots(); const cutoff = Date.now() - maxAgeMinutes * 60_000; const entries = await fsp.readdir(tempRoot, { withFileTypes: true }); let removed = 0; for (const entry of entries.slice(0, Math.max(0, limit))) { if (!entry.isFile() || entry.isSymbolicLink()) continue; const file = path.join(tempRoot, entry.name); const stat = await fsp.lstat(file); if (stat.mtimeMs < cutoff) { await fsp.unlink(file); removed += 1; } } return removed; }
  };
}
module.exports = { createLocalVideoStorage };
