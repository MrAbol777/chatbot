const express = require('express');
const axios = require('axios');
const { createImageGenerationController } = require('./image-generation.controller');
const { createImageGenerationService } = require('./image-generation.service');
const { createAuthMiddleware } = require('./auth.middleware');
const { createImageRuntimeSettingsResolver } = require('./image-runtime-settings');
const { createImagePromptRefinerService } = require('./image-prompt-refiner.service');
const { createImageResultHttpClient } = require('./image-result-http-client');

function createImageGenerationRouter(deps) {
  const router = express.Router();

  const authMiddleware = createAuthMiddleware({
    jwtSecret: deps.authJwtSecret,
    db: deps.db,
    principalResolver: deps.principalResolver
  });

  const baseHttpClient = deps.httpClient || axios;
  const imageHttpClient = createImageResultHttpClient({
    httpClient: baseHttpClient,
    imageConfig: deps.imageConfig,
    env: process.env
  });
  const imageGenerationService =
    deps.imageGenerationService ||
    createImageGenerationService({
      httpClient: imageHttpClient,
      geminiApiKey: deps.geminiApiKey,
      baseUrl: deps.geminiBaseUrl,
      imageModel: deps.geminiImageModel || 'gemini-2.5-flash-image',
      imageConfig: deps.imageConfig
    });
  const imageRuntimeSettingsResolver =
    deps.imageRuntimeSettingsResolver ||
    createImageRuntimeSettingsResolver({
      settingsRepository: deps.settingsRepository,
      imageConfig: deps.imageConfig
    });
  const imagePromptRefinerService =
    deps.imagePromptRefinerService ||
    createImagePromptRefinerService({
      httpClient: baseHttpClient,
      settingsRepository: deps.settingsRepository,
      refinerConfig: deps.imageConfig?.promptRefiner,
      chatConfig: deps.chatConfig,
      fallbackPromptBuilder: (prompt, options) => {
        const { buildFinalImagePrompt } = require('./image-generation.controller');
        return buildFinalImagePrompt(prompt, options);
      }
    });

  const controller = createImageGenerationController({
    imageGenerationService,
    imagePromptRefinerService,
    inputOptimizerService: deps.inputOptimizerService,
    conversationTitleService: deps.conversationTitleService,
    db: deps.db,
    settingsRepository: deps.settingsRepository,
    conversationsRepository: deps.conversationsRepository,
    eventsRepository: deps.eventsRepository,
    noaBillingService: deps.noaBillingService,
    imageModelFallback: deps.imageConfig?.model || deps.geminiImageModel,
    imageModelSourceFallback: deps.imageConfig?.modelSource || (deps.geminiImageModel ? 'legacy GEMINI_IMAGE_MODEL' : 'default'),
    imageProviderFallback: deps.imageConfig?.provider,
    imageBaseUrlFallback: deps.imageConfig?.baseUrl,
    imageStorageDirFallback: deps.imageConfig?.storageDir,
    imagePublicBaseUrlFallback: deps.imageConfig?.publicBaseUrl,
    imageMaxDownloadMbFallback: deps.imageConfig?.maxDownloadMb,
    imageRuntimeSettingsResolver
  });

  // Protected routes (generate, status, same-origin image serving)
  router.use(authMiddleware);
  router.post('/generate', controller.generateImage);
  router.post('/edit', controller.editImage);
  router.get('/', controller.listImages);
  router.get('/:taskId/details', controller.getImageDetails);
  router.delete('/:taskId', controller.deleteImage);
  router.get('/status/:taskId', controller.getImageStatus);
  router.get('/result/:taskId', controller.getImageResult);
  router.get('/serve/:taskId', controller.serveImage);

  // Keep an empty public router for mount compatibility; image serving is ownership-checked.
  const publicRouter = express.Router();

  return { router, publicRouter, controller, imageGenerationService, imageRuntimeSettingsResolver, imagePromptRefinerService };
}

module.exports = { createImageGenerationRouter };
