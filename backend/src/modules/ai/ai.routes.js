const express = require('express');
const { createAiController } = require('./ai.controller');
const { createAiService } = require('./ai.service');

function createAiRouter(deps) {
  const router = express.Router();
  const aiService = deps.aiService || createAiService(deps);
  const controller = createAiController({
    aiService,
    errorsRepository: deps.errorsRepository,
    guestsRepository: deps.guestsRepository,
    usersRepository: deps.usersRepository,
    plansRepository: deps.plansRepository,
    chatTurnsRepository: deps.chatTurnsRepository,
    settingsRepository: deps.settingsRepository,
    uploadedImagesRepository: deps.uploadedImagesRepository,
    intentRouterService: deps.intentRouterService,
    conversationMemoryService: deps.conversationMemoryService,
    conversationContextBuilder: deps.conversationContextBuilder,
    conversationMemoryWriterService: deps.conversationMemoryWriterService,
    imageGenerationController: deps.imageGenerationController,
    imageGenerationService: deps.imageGenerationService,
    imageUnderstandingService: deps.imageUnderstandingService,
    jwt: deps.jwt,
    jwtSecret: deps.jwtSecret
  });

  router.post('/api/chat', controller.postChat);

  return router;
}

module.exports = { createAiRouter };
