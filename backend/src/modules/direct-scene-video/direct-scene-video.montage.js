'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const safeId = (value) => /^[a-zA-Z0-9_-]{8,191}$/.test(String(value || '')) ? String(value) : '';
const concatLine = (file) => `file '${String(file).replace(/'/g, "'\\''")}'`;

function runFfmpeg({ ffmpegPath = 'ffmpeg', args, spawnProcess = spawn, timeoutMs = 10 * 60_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('DIRECT_VIDEO_MONTAGE_TIMEOUT'), { code: 'DIRECT_VIDEO_MONTAGE_TIMEOUT' })); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(Object.assign(error, { code: 'DIRECT_VIDEO_MONTAGE_UNAVAILABLE' })); });
    child.stderr?.on('data', (chunk) => { if (stderr.length < 4000) stderr += String(chunk); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      return reject(Object.assign(new Error('DIRECT_VIDEO_MONTAGE_FAILED'), { code: 'DIRECT_VIDEO_MONTAGE_FAILED', details: stderr.slice(-2000) }));
    });
  });
}

function createDirectSceneVideoMontage({ videoService, videoStorage, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', logger = console }) {
  if (!videoService || !videoStorage) throw new Error('DIRECT_VIDEO_MONTAGE_DEPENDENCIES_REQUIRED');
  const completed = new Map();

  async function compose({ userId, generationIds }) {
    const ids = (Array.isArray(generationIds) ? generationIds : []).map(safeId).filter(Boolean);
    if (!ids.length || ids.length > 24) throw Object.assign(new Error('DIRECT_VIDEO_GENERATIONS_INVALID'), { code: 'DIRECT_VIDEO_GENERATIONS_INVALID' });
    const records = await Promise.all(ids.map((id) => videoService.getContentRecord(id, userId)));
    if (records.some((record) => !record || record.status !== 'succeeded' || !record.result_storage_key)) {
      throw Object.assign(new Error('DIRECT_VIDEO_SCENES_NOT_READY'), { code: 'DIRECT_VIDEO_SCENES_NOT_READY' });
    }
    const files = records.map((record) => videoStorage.resolveSafeKey(record.result_storage_key));
    const montageId = `direct-video-${randomUUID()}`;
    const resultKey = `direct-scene-video/${montageId}.mp4`;
    const outputPath = videoStorage.resolveSafeKey(resultKey);
    const listPath = path.join(os.tmpdir(), `${montageId}.txt`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(listPath, `${files.map(concatLine).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await runFfmpeg({ ffmpegPath, args: ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath] });
      const stat = await fs.stat(outputPath);
      if (!stat.isFile() || stat.size < 1024) throw Object.assign(new Error('DIRECT_VIDEO_MONTAGE_EMPTY'), { code: 'DIRECT_VIDEO_MONTAGE_FAILED' });
      completed.set(montageId, { userId: String(userId), resultKey, sizeBytes: stat.size, createdAt: new Date().toISOString() });
      logger.log?.('DIRECT_SCENE_VIDEO', 'montage_completed', { userId: String(userId), montageId, sceneCount: ids.length, sizeBytes: stat.size });
      return { montageId, storageKey: resultKey, contentUrl: `/api/direct-scene-video/${encodeURIComponent(montageId)}/content`, downloadUrl: `/api/direct-scene-video/${encodeURIComponent(montageId)}/content?download=1`, sizeBytes: stat.size };
    } finally {
      await fs.unlink(listPath).catch(() => {});
    }
  }

  function getForUser(montageId, userId) {
    const item = completed.get(String(montageId || ''));
    return item && item.userId === String(userId) ? item : null;
  }

  return { compose, getForUser, runFfmpeg };
}

module.exports = { createDirectSceneVideoMontage, runFfmpeg };
