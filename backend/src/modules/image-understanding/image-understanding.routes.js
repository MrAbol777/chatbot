const express = require('express');
const multer = require('multer');
const { createImageUnderstandingController } = require('./image-understanding.controller');
const { createImageUnderstandingService } = require('./image-understanding.service');
const { createUploadOwnershipGuard } = require('../uploads/upload-ownership.middleware');

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

  const controller = createImageUnderstandingController({
    imageUnderstandingService,
    noaBillingService: deps.noaBillingService,
    principalResolver: deps.principalResolver
  });
  const uploadOwnershipGuard = createUploadOwnershipGuard({
    principalResolver: deps.principalResolver,
    uploadedImagesRepository: deps.uploadedImagesRepository
  });

  router.post('/analyze', upload.array('images', 5), uploadOwnershipGuard, controller.analyze);
  router.post('/analyze-dry-run', express.json({ limit: '1mb' }), controller.dryRun);

  return {
    router,
    controller,
    imageUnderstandingService,
    visionSettingsResolver: imageUnderstandingService.settingsResolver
  };
}

module.exports = { createImageUnderstandingRouter };
