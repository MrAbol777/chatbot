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

  // Serve endpoint must be public — img tags can't send Authorization headers.
  // The taskId itself acts as access control (you need to know it to access the image).
  // We register it BEFORE the auth middleware by creating a separate router.
  const publicRouter = express.Router();
  publicRouter.get('/serve/:taskId', controller.serveImage);

  return { router, publicRouter };
}

module.exports = { createImageGenerationRouter };
