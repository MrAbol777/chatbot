const express = require('express');

function createAdminSettingsRouter({ settingsService, requireAdminAuth }) {
  const router = express.Router();

  router.get('/settings', requireAdminAuth, async (_req, res) => {
    const result = await settingsService.getSettings();
    return res.json(result);
  });

  router.put('/settings', requireAdminAuth, async (req, res) => {
    const result = await settingsService.updateSettings({ body: req.body, admin: req.admin });
    return res.status(result.statusCode).json(result.body);
  });

  return router;
}

module.exports = { createAdminSettingsRouter };
