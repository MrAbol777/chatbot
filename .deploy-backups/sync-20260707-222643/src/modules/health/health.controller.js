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

  return {
    getHealth,
    getUpstreamHealth,
    getProbeHealth
  };
}

module.exports = { createHealthController };
