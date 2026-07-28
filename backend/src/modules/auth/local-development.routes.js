const express = require('express');

const LOCAL_DEVELOPMENT_PHONE = '09000000001';
const LOCAL_DEVELOPMENT_CREDIT = '100.000000';

const isLocalRequest = (req) => {
  const hostname = String(req.hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
};

function createLocalDevelopmentRouter({ enabled = false, usersRepository, noaBillingService, jwt, jwtSecret, logger = console }) {
  const router = express.Router();
  if (!enabled) return router;

  router.post('/api/auth/local-session', async (req, res) => {
    if (!isLocalRequest(req)) return res.status(404).end();
    try {
      if (!usersRepository || !noaBillingService || !jwt || !jwtSecret) {
        return res.status(503).json({ error: 'LOCAL_DEVELOPMENT_SESSION_UNAVAILABLE' });
      }
      const userId = await usersRepository.ensureUserExists({
        name: 'کاربر توسعه', age: 18, phone: LOCAL_DEVELOPMENT_PHONE
      });
      await noaBillingService.credit({
        userId,
        amountNoa: LOCAL_DEVELOPMENT_CREDIT,
        entryType: 'local_dev_credit',
        referenceType: 'local_development',
        referenceId: 'starter-credit-v1',
        idempotencyKey: 'local-development-starter-credit-v1',
        payloadHash: { userId, amountNoa: LOCAL_DEVELOPMENT_CREDIT },
        actorType: 'system',
        actorId: 'local-development'
      });
      const token = jwt.sign({
        sub: String(userId), phone: LOCAL_DEVELOPMENT_PHONE, type: 'user', localDevelopment: true
      }, jwtSecret, { expiresIn: '30d' });
      return res.json({
        success: true, userId: String(userId), token,
        profile: { id: String(userId), name: 'کاربر توسعه', age: 18, phone: LOCAL_DEVELOPMENT_PHONE }
      });
    } catch (error) {
      logger.error?.('[DEV] local session failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({ error: 'LOCAL_DEVELOPMENT_SESSION_FAILED' });
    }
  });
  return router;
}

module.exports = { createLocalDevelopmentRouter };
