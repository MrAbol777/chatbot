const { createSmsRouter } = require('./sms.routes');
const { createSmsService } = require('./sms.service');
const { createSmsController } = require('./sms.controller');

function createSmsModule(deps) {
  const service = createSmsService(deps);
  const controller = createSmsController({
    smsService: service,
    logger: deps.logger,
    now: deps.now
  });
  const router = createSmsRouter({ ...deps, smsService: service });

  return {
    router,
    controller,
    service
  };
}

module.exports = { createSmsModule };
