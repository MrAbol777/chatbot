const express = require('express');
const { createImageGenerationController } = require('./image-generation.controller');
const { createImageGenerationService } = require('./image-generation.service');
const { createAuthMiddleware } = require('./auth.middleware');

function createImageGenerationRouter(deps) {
  const router = express.Router();

  const authMiddleware = createAuthMiddleware({
    jwtSecret: deps.authJwtSecret
  });

  const imageGenerationService =
    deps.imageGenerationService ||
    createImageGenerationService({
      httpClient: deps.httpClient,
      metisApiKey: deps.metisApiKey,
      baseUrl: deps.baseUrl
    });

  const controller = createImageGenerationController({
    imageGenerationService,
    db: deps.db
  });

  // All routes require authentication
  router.use(authMiddleware);

  router.post('/generate', controller.generateImage);
  router.get('/status/:taskId', controller.getImageStatus);
  router.get('/serve/:taskId', controller.serveImage);

  return router;
}

module.exports = { createImageGenerationRouter };
