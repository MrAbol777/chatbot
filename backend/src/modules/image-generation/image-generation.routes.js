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
      httpClient: deps.httpClient || axios,
      metisApiKey: deps.metisApiKey,
      baseUrl: deps.baseUrl,
      imageModel: deps.metisImageModel || 'nano-banana-2'
    });

  const controller = createImageGenerationController({
    imageGenerationService,
    db: deps.db
  });

  // Protected routes (generate, status)
  router.use(authMiddleware);
  router.post('/generate', controller.generateImage);
  router.get('/status/:taskId', controller.getImageStatus);

  // Serve endpoint is public — img tags can't send Authorization headers.
  // The taskId itself acts as access control.
  const publicRouter = express.Router();
  publicRouter.get('/serve/:taskId', controller.serveImage);

  return { router, publicRouter };
}

module.exports = { createImageGenerationRouter };
