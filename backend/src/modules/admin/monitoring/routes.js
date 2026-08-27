'use strict';

const express = require('express');

function createMonitoringRouter({ monitoringService, requireAdminAuth }) {
  const router = express.Router();

  router.get('/monitoring/overview', requireAdminAuth, async (req, res) => {
    try {
      const payload = await monitoringService.getOverview({ range: req.query.range });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(payload);
    } catch (error) {
      console.error('[monitoring] overview failed', {
        code: error?.code || 'MONITORING_OVERVIEW_FAILED',
        message: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'MONITORING_OVERVIEW_FAILED',
        message: 'دریافت اطلاعات مرکز پایش انجام نشد.'
      });
    }
  });

  return router;
}

module.exports = { createMonitoringRouter };
