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

  return {
    getHealth,
    getUpstreamHealth,
    getProbeHealth,
    getVideoGenerationHealth
  };
}

module.exports = { createHealthController };
