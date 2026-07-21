const express = require('express');

function createAdminSystemRouter({ systemService, requireAdminAuth }) {
  const router = express.Router();

  router.get('/config', requireAdminAuth, async (_req, res) => {
    const config = await systemService.getConfig();
    return res.json(config);
  });

  router.put('/config', requireAdminAuth, async (req, res) => {
    const result = await systemService.updateConfig({ body: req.body, admin: req.admin });
    return res.json(result);
  });

  router.get('/config/system-prompt', requireAdminAuth, async (_req, res) => {
    const result = await systemService.getSystemPrompt();
    return res.status(result.statusCode).json(result.body);
  });

  router.put('/config/system-prompt', requireAdminAuth, async (req, res) => {
    const result = await systemService.updateSystemPrompt({ body: req.body, admin: req.admin });
    return res.status(result.statusCode).json(result.body);
  });

  return router;
}

module.exports = { createAdminSystemRouter };
