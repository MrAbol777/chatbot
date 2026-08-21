const express = require('express');
const {
  ADMIN_ROLES,
  createRequireAdminRole
} = require('../common/auth');

function createAdminSupervisedOtpRouter({
  requireAdminAuth,
  supervisedOtpRepository,
  appendAudit
}) {
  const router = express.Router();

  router.get('/supervised-otp', requireAdminAuth, createRequireAdminRole([ADMIN_ROLES.SUPERADMIN, ADMIN_ROLES.ADMIN]), async (_req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      return res.json(await supervisedOtpRepository.getConfig());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت Supervised OTP' });
    }
  });

  router.put('/supervised-otp', requireAdminAuth, createRequireAdminRole([ADMIN_ROLES.SUPERADMIN, ADMIN_ROLES.ADMIN]), async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.updateConfig({
        enabled: Boolean(req.body?.enabled),
        code: req.body?.code,
        expires_at: req.body?.expires_at,
        max_uses: req.body?.max_uses
      });
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_supervised_otp',
        target: 'supervised_otp',
        details: {
          enabled: config.enabled,
          hasCode: config.hasCode,
          expires_at: config.expires_at,
          max_uses: config.max_uses
        }
      });
      return res.json(config);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      return res.status(statusCode).json({ error: error instanceof Error ? error.message : 'ذخیره Supervised OTP ناموفق بود.' });
    }
  });

  router.post('/supervised-otp/reset-used-count', requireAdminAuth, createRequireAdminRole([ADMIN_ROLES.SUPERADMIN, ADMIN_ROLES.ADMIN]), async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.resetUsedCount();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'reset_supervised_otp_used_count',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'ریست شمارنده Supervised OTP ناموفق بود.' });
    }
  });

  router.delete('/supervised-otp', requireAdminAuth, createRequireAdminRole([ADMIN_ROLES.SUPERADMIN, ADMIN_ROLES.ADMIN]), async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.deleteCode();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'delete_supervised_otp',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'حذف Supervised OTP ناموفق بود.' });
    }
  });

  return router;
}

module.exports = { createAdminSupervisedOtpRouter };
