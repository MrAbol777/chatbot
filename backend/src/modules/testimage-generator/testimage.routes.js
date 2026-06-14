const express = require('express');
const { createTestimageController } = require('./testimage.controller');
const { createAuthMiddleware } = require('../image-generation/auth.middleware');

function createTestimageRouter(deps) {
  const router = express.Router();

  const authMiddleware = createAuthMiddleware({
    jwtSecret: deps.authJwtSecret
  });

  const controller = createTestimageController({
    testimageService: require('./testimage.service')
  });

  // Generate endpoint requires authentication
  router.use(authMiddleware);
  router.post('/generate', controller.generateImage);

  // Serve endpoint is public — no auth required
  const publicRouter = express.Router();
  publicRouter.get('/serve/:fileName', controller.serveImage);

  return { router, publicRouter };
}

module.exports = { createTestimageRouter };
