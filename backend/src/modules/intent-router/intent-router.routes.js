const express = require('express');
const { createIntentRouterController } = require('./intent-router.controller');

function createIntentRouterAdminRouter({
  intentRouterService,
  settingsRepository,
  requireAdminAuth,
  appendAudit
}) {
  const router = express.Router();
  const controller = createIntentRouterController({
    intentRouterService,
    settingsRepository,
    appendAudit
  });

  router.get('/intent-router-settings', requireAdminAuth, controller.getSettings);
  router.put('/intent-router-settings', requireAdminAuth, controller.updateSettings);
  router.post('/intent-router/test-dry-run', requireAdminAuth, controller.testDryRun);
  router.post('/intent-router/model-probe', requireAdminAuth, controller.modelProbe);

  return router;
}

module.exports = { createIntentRouterAdminRouter };
