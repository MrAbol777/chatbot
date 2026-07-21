function createVideoStorageCleanupService({ storage, config, logger = null }) {
  return { async run({ limit = 100 } = {}) { const removed = await storage.cleanupTemporary({ maxAgeMinutes: config.tempMaxAgeMinutes, limit: Math.min(1000, Math.max(1, Number(limit) || 100)) }); logger?.info?.({ event: 'video_storage_temp_cleanup', removed }); return removed; } };
}
module.exports = { createVideoStorageCleanupService };
