const express = require('express');

function createAdminAnalyticsRouter({ analyticsService, adminApiKey, requireAdminAuth }) {
  const router = express.Router();
  const buildReportFileName = (format) => `danua-report-${new Date().toISOString().slice(0, 10)}.${format}`;

  const sendReport = async (req, res, forcedFormat) => {
    const requestedFormat = String(forcedFormat || req.query.format || 'csv').trim().toLowerCase();
    if (!['csv', 'txt'].includes(requestedFormat)) {
      return res.status(400).json({ error: 'فرمت گزارش پشتیبانی نمی‌شود.' });
    }
    const report = await analyticsService.buildReport({
      format: requestedFormat,
      sections: req.query.sections,
      users: req.query.users,
      errors: req.query.errors,
      conversations: req.query.conversations,
      messages: req.query.messages,
      userIds: req.query.userIds,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate
    });
    const fileName = buildReportFileName(report.extension);
    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(`${report.format === 'csv' ? '\uFEFF' : ''}${report.content}`);
  };

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
      return sendReport(req, res, 'csv');
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در تولید گزارش' });
    }
  });

  router.get('/reports/export', requireAdminAuth, async (req, res) => {
    try {
      return sendReport(req, res);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در تولید گزارش' });
    }
  });

  return router;
}

module.exports = { createAdminAnalyticsRouter };
