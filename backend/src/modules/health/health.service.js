const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const { loadVideoStorageConfig } = require('../video-generation/storage/video-storage.config');

function createHealthService({ metisBaseUrl, defaultModel, videoWorkerState, db = null, env = process.env }) {
  const getStatus = () => ({
    ok: true,
    service: 'hemraz-backend',
    model: defaultModel,
    baseUrl: metisBaseUrl,
    ...(typeof videoWorkerState === 'function' ? { videoWorker: videoWorkerState() } : {})
  });

  // Provider health/model probes may consume rate limits or disclose provider
  // behaviour. Deployment readiness is intentionally local-only instead.
  const checkUpstream = async () => ({
    ok: false,
    statusCode: 501,
    body: { ok: false, code: 'UPSTREAM_HEALTH_DISABLED', message: 'بررسی زندهٔ Provider غیرفعال است.' }
  });

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
