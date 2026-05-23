const express = require('express');
const { createSmsController } = require('./sms.controller');
const { createSmsService } = require('./sms.service');

function createSmsRouter(deps) {
  const router = express.Router();
  const smsService = deps.smsService || createSmsService(deps);
  const controller = createSmsController({
    smsService,
    logger: deps.logger,
    now: deps.now
  });

  router.post('/api/sms/send-otp', controller.sendOtp);
  router.post('/api/sms/verify-otp', controller.verifyOtp);
  router.post('/api/sms/test-otp', controller.testOtp);

  return router;
}

module.exports = { createSmsRouter };
