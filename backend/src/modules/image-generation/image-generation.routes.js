const express = require('express');
const axios = require('axios');
const { createImageGenerationController } = require('./image-generation.controller');
const { createImageGenerationService } = require('./image-generation.service');
const { createAuthMiddleware } = require('./auth.middleware');

function createImageGenerationRouter(deps) {
  const router = express.Router();

  const authMiddleware = createAuthMiddleware({
    jwtSecret: deps.authJwtSecret,
    db: deps.db
  });

  const imageGenerationService =
    deps.imageGenerationService ||
    createImageGenerationService({
      httpClient: deps.httpClient || axios,
      geminiApiKey: deps.geminiApiKey,
      baseUrl: deps.geminiBaseUrl,
      imageModel: deps.geminiImageModel || 'gemini-2.5-flash-image'
    });

  const controller = createImageGenerationController({
    imageGenerationService,
    db: deps.db,
    plansRepository: deps.plansRepository,
    settingsRepository: deps.settingsRepository,
    guestsRepository: deps.guestsRepository,
    conversationsRepository: deps.conversationsRepository,
    eventsRepository: deps.eventsRepository,
    imageModelFallback: deps.geminiImageModel
  });

  // Protected routes (generate, status)
  router.use(authMiddleware);
  router.post('/generate', controller.generateImage);
  router.get('/status/:taskId', controller.getImageStatus);
  router.get('/result/:taskId', controller.getImageResult);

  // Serve endpoint is public — img tags can't send Authorization headers.
  // The taskId itself acts as access control.
  const publicRouter = express.Router();
  publicRouter.get('/serve/:taskId', controller.serveImage);

  return { router, publicRouter, controller, imageGenerationService };
}

module.exports = { createImageGenerationRouter };
