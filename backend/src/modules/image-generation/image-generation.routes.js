const express = require('express');
const { createImageGenerationController } = require('./image-generation.controller');
const { createImageGenerationService } = require('./image-generation.service');

function createImageGenerationRouter(deps) {
  const router = express.Router();
  const imageGenerationService =
    deps.imageGenerationService ||
    createImageGenerationService({
      httpClient: deps.httpClient,
      metisApiKey: deps.metisApiKey,
      baseUrl: deps.baseUrl
    });
  const controller = createImageGenerationController({ imageGenerationService });

  router.post('/', controller.generateImage);

  return router;
}

module.exports = { createImageGenerationRouter };
