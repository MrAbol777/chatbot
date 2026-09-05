const express = require('express');

function createAdminSettingsRouter({ settingsService, requireAdminAuth, requireSensitiveAdminRole }) {
  const router = express.Router();
  if (typeof requireSensitiveAdminRole !== 'function') throw new Error('requireSensitiveAdminRole is required');

  const guards = [requireAdminAuth, requireSensitiveAdminRole];

  router.get('/settings', ...guards, async (_req, res) => {
    const result = await settingsService.getSettings();
    return res.json(result);
  });

  router.put('/settings', ...guards, async (req, res) => {
    const result = await settingsService.updateSettings({ body: req.body, admin: req.admin });
    return res.status(result.statusCode).json(result.body);
  });

  return router;
}

module.exports = { createAdminSettingsRouter };
