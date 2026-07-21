const express = require('express');
const { createHealthController } = require('./health.controller');
const { createHealthService } = require('./health.service');

function createHealthRouter(deps) {
  const router = express.Router();
  const healthService = createHealthService(deps);
  const controller = createHealthController({ healthService });

  router.get('/api/health', controller.getHealth);
  router.get('/api/health/upstream', controller.getUpstreamHealth);
  router.get('/health', controller.getProbeHealth);
  router.get('/healthz', controller.getProbeHealth);

  return router;
}

module.exports = { createHealthRouter };
