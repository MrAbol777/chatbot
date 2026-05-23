const express = require('express');

function createAdminLogsRouter({ logsService, requireAdminAuth }) {
  const router = express.Router();

  router.get('/errors', requireAdminAuth, async (req, res) => {
    try {
      const result = await logsService.getErrors({
        errorType: req.query.errorType,
        from: req.query.from,
        to: req.query.to
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت خطاها' });
    }
  });

  router.get('/audit-logs', requireAdminAuth, async (req, res) => {
    const result = await logsService.getAuditLogs({
      page: req.query.page,
      pageSize: req.query.pageSize
    });
    return res.json(result);
  });

  return router;
}

module.exports = { createAdminLogsRouter };
