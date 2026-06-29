const express = require('express');

function createAdminAnalyticsRouter({ analyticsService, adminApiKey, requireAdminAuth }) {
  const router = express.Router();

  router.get('/stats', async (req, res) => {
    if (!adminApiKey) {
      return res.status(404).json({ error: 'Not found' });
    }
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    if (authHeader !== `Bearer ${adminApiKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json(await analyticsService.getLegacyStats());
  });

  router.get('/dashboard/stats', requireAdminAuth, async (_req, res) => {
    try {
      return res.json(await analyticsService.getDashboardStats());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت آمار' });
    }
  });

  router.get('/reports/csv', requireAdminAuth, async (req, res) => {
    try {
      const csv = await analyticsService.buildCsvReport({
        users: req.query.users,
        errors: req.query.errors,
        conversations: req.query.conversations,
        messages: req.query.messages
      });
      const fileName = `admin-report-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در تولید گزارش' });
    }
  });

  return router;
}

module.exports = { createAdminAnalyticsRouter };
