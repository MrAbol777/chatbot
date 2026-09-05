function createHealthController({ healthService }) {
  const getHealth = (_req, res) => {
    return res.json(healthService.getStatus());
  };

  const getUpstreamHealth = async (_req, res) => {
    const result = await healthService.checkUpstream();
    return res.status(result.statusCode).json(result.body);
  };

  const getProbeHealth = (_req, res) => {
    return res.status(200).send('ok');
  };

  const getVideoGenerationHealth = async (_req, res) => {
    try { return res.json(await healthService.getVideoGenerationHealth()); }
    catch (_) { return res.status(503).json({ ok: false, code: 'VIDEO_GENERATION_HEALTH_UNAVAILABLE' }); }
  };

  const getImageToImageHealth = async (_req, res) => {
    try {
      const health = await healthService.getImageToImageHealth();
      return res.status(health.ok ? 200 : 503).json(health);
    } catch (_) {
      return res.status(503).json({ ok: false, code: 'IMAGE_TO_IMAGE_HEALTH_UNAVAILABLE' });
    }
  };

  return {
    getHealth,
    getUpstreamHealth,
    getProbeHealth,
    getVideoGenerationHealth,
    getImageToImageHealth
  };
}

module.exports = { createHealthController };
