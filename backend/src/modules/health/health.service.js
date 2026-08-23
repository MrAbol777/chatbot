const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const { loadVideoStorageConfig } = require('../video-generation/storage/video-storage.config');

function createHealthService({ metisBaseUrl, metisApiKey, defaultModel, videoWorkerState, db = null, env = process.env }) {
  const getStatus = () => ({
    ok: true,
    service: 'hemraz-backend',
    model: defaultModel,
    baseUrl: metisBaseUrl,
    ...(typeof videoWorkerState === 'function' ? { videoWorker: videoWorkerState() } : {})
  });

  // Keep this probe local: live provider calls can consume credits/rate limits
  // and can leak provider behaviour. The response still gives monitoring a
  // useful, deterministic readiness signal instead of an opaque 501.
  const checkUpstream = async () => {
    const configured = /^https?:\/\//i.test(String(metisBaseUrl || '').trim())
      && Boolean(String(metisApiKey || '').trim());
    return {
      ok: configured,
      statusCode: configured ? 200 : 503,
      body: {
        ok: configured,
        ready: configured,
        liveProbe: false,
        code: configured ? 'UPSTREAM_CONFIGURED' : 'UPSTREAM_NOT_CONFIGURED',
        message: configured
          ? 'تنظیمات اتصال به Provider آماده است؛ بررسی زنده انجام نشده است.'
          : 'تنظیمات اتصال به Provider کامل نیست.'
      }
    };
  };

  const getVideoGenerationHealth = async () => {
    const storage = loadVideoStorageConfig(env);
    await fs.access(storage.root, fsConstants.W_OK);
    await fs.access(storage.temporaryRoot, fsConstants.W_OK);
    if (!db) throw new Error('Video generation database is not configured.');
    const [rows] = await db.query("SELECT status,COUNT(*) AS count FROM app_video_generations GROUP BY status");
    const [leases] = await db.query("SELECT COUNT(*) AS count FROM app_video_generations WHERE worker_lease_until>NOW() AND status IN ('submitted','processing','storing')");
    const counts = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
    return {
      ok: true,
      featureEnabled: String(env.VIDEO_GENERATION_ENABLED || '0') === '1',
      worker: typeof videoWorkerState === 'function' ? videoWorkerState() : { enabled: false, mode: 'disabled', state: 'disabled' },
      activeLeases: Number(leases[0]?.count || 0),
      queueCount: Number(counts.queued || 0) + Number(counts.submitted || 0),
      processingCount: Number(counts.processing || 0),
      storingCount: Number(counts.storing || 0),
      recentFailedCount: Number(counts.failed || 0),
      storageWritable: true
    };
  };

  return {
    getStatus,
    checkUpstream,
    getVideoGenerationHealth
  };
}

module.exports = { createHealthService };
