const express = require('express');
const { createAiController } = require('./ai.controller');
const { createAiService } = require('./ai.service');
const { createUploadOwnershipGuard } = require('../uploads/upload-ownership.middleware');

function createAiRouter(deps) {
  const router = express.Router();
  const aiService = deps.aiService || createAiService(deps);
  const controller = createAiController({
    aiService,
    errorsRepository: deps.errorsRepository,
    usersRepository: deps.usersRepository,
    chatTurnsRepository: deps.chatTurnsRepository,
    conversationsRepository: deps.conversationsRepository,
    uploadedImagesRepository: deps.uploadedImagesRepository,
    intentRouterService: deps.intentRouterService,
    inputOptimizerService: deps.inputOptimizerService,
    conversationTitleService: deps.conversationTitleService,
    conversationMemoryService: deps.conversationMemoryService,
    conversationContextBuilder: deps.conversationContextBuilder,
    conversationMemoryWriterService: deps.conversationMemoryWriterService,
    imageGenerationController: deps.imageGenerationController,
    imageGenerationService: deps.imageGenerationService,
    imageUnderstandingService: deps.imageUnderstandingService,
    noaBillingService: deps.noaBillingService,
    jwt: deps.jwt,
    jwtSecret: deps.jwtSecret,
    principalResolver: deps.principalResolver
  });
  const uploadOwnershipGuard = createUploadOwnershipGuard({
    principalResolver: deps.principalResolver,
    uploadedImagesRepository: deps.uploadedImagesRepository
  });

  router.post('/api/chat', uploadOwnershipGuard, controller.postChat);

  return router;
}

module.exports = { createAiRouter };
