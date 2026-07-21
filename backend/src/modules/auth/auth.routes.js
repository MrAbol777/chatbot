const express = require('express');
const { createAuthController } = require('./auth.controller');

function createAuthRouter({ authService, errorsRepository, logger }) {
  const router = express.Router();
  const controller = createAuthController({
    authService,
    errorsRepository,
    logger
  });

  router.post('/api/send-verification-code', controller.sendVerificationCode);
  router.post('/api/auth/phone-status', controller.phoneStatus);
  router.post('/api/verify-code', controller.verifyCode);
  router.post('/api/register-profile', controller.registerProfile);

  return router;
}

module.exports = { createAuthRouter };
