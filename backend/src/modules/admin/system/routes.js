const express = require('express');

function createAdminSystemRouter({ systemService, requireAdminAuth, requireSensitiveAdminRole }) {
  const router = express.Router();
  if (typeof requireSensitiveAdminRole !== 'function') throw new Error('requireSensitiveAdminRole is required');

  const guards = [requireAdminAuth, requireSensitiveAdminRole];

  router.get('/config', ...guards, async (_req, res) => {
    const config = await systemService.getConfig();
    return res.json(config);
  });

  router.put('/config', ...guards, async (req, res) => {
    const result = await systemService.updateConfig({ body: req.body, admin: req.admin });
    return res.json(result);
  });

  router.get('/config/system-prompt', ...guards, async (_req, res) => {
    const result = await systemService.getSystemPrompt();
    return res.status(result.statusCode).json(result.body);
  });

  router.get('/config/system-prompt/history', ...guards, async (_req, res) => {
    const result = await systemService.getPromptHistory();
    return res.status(result.statusCode).json(result.body);
  });

  router.put('/config/system-prompt', ...guards, async (req, res) => {
    const result = await systemService.updateSystemPrompt({ body: req.body, admin: req.admin });
    return res.status(result.statusCode).json(result.body);
  });

  router.post('/config/system-prompt/rollback', ...guards, async (req, res) => {
    const result = await systemService.rollbackPrompt({ body: req.body, admin: req.admin });
    return res.status(result.statusCode).json(result.body);
  });

  return router;
}

module.exports = { createAdminSystemRouter };
