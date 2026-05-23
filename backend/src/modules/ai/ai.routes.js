const express = require('express');
const { createAiController } = require('./ai.controller');
const { createAiService } = require('./ai.service');

function createAiRouter(deps) {
  const router = express.Router();
  const aiService = deps.aiService || createAiService(deps);
  const controller = createAiController({
    aiService,
    errorsRepository: deps.errorsRepository
  });

  router.post('/api/chat', controller.postChat);

  return router;
}

module.exports = { createAiRouter };
