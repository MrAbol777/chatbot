const express = require('express');
const multer = require('multer');
const { createImageUnderstandingController } = require('./image-understanding.controller');
const { createImageUnderstandingService } = require('./image-understanding.service');

function createImageUnderstandingRouter(deps = {}) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 5
    }
  });

  const imageUnderstandingService =
    deps.imageUnderstandingService ||
    createImageUnderstandingService({
      httpClient: deps.httpClient,
      settingsRepository: deps.settingsRepository,
      visionConfig: deps.visionConfig,
      chatConfig: deps.chatConfig,
      uploadedImagesRepository: deps.uploadedImagesRepository,
      imageGenerationController: deps.imageGenerationController,
      db: deps.db,
      logger: deps.logger
    });

  const controller = createImageUnderstandingController({ imageUnderstandingService });

  router.post('/analyze', upload.array('images', 5), controller.analyze);
  router.post('/analyze-dry-run', express.json({ limit: '1mb' }), controller.dryRun);

  return {
    router,
    controller,
    imageUnderstandingService,
    visionSettingsResolver: imageUnderstandingService.settingsResolver
  };
}

module.exports = { createImageUnderstandingRouter };
