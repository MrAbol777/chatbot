const express = require('express');
const fs = require('fs-extra');
const { resolveImageRuntimeModel } = require('../../../bootstrap/config');

function createAdminRuntimeStatusRouter({
  requireAdminAuth,
  repositories,
  runtimeConfig,
  imageRuntimeSettingsResolver,
  imagePromptRefinerService,
  imageUnderstandingService,
  intentRouterService,
  conversationMemoryWriterService
}) {
  const router = express.Router();

  router.get('/input-optimizations', requireAdminAuth, async (req, res) => {
    const records = await repositories?.inputOptimizations?.listForAdmin?.({
      conversationId: typeof req.query?.conversationId === 'string' ? req.query.conversationId : '',
      status: typeof req.query?.status === 'string' ? req.query.status : '',
      limit: req.query?.limit
    }) || [];
    return res.json({ items: records });
  });

  router.get('/ai-runtime-status', requireAdminAuth, async (_req, res) => {
    const getHost = (value) => {
      try {
        return new URL(String(value || '')).hostname;
      } catch (_error) {
        return '';
      }
    };
    const safeKey = (keyInfo = {}) => ({
      apiKeySource: keyInfo.apiKeySource || 'missing',
      apiKeySet: Boolean(keyInfo.apiKey),
      apiKeyFingerprint: keyInfo.apiKeyFingerprint || ''
    });
    const getMetisModelProviderName = (model) => {
      const normalized = String(model || '').trim().toLowerCase();
      if (['nano-banana', 'nano-banana-pro', 'nano-banana-2'].includes(normalized)) return 'google';
      if (['flux-pro', 'flux-schnell', 'flux-kontext-max', 'flux-kontext-pro'].includes(normalized)) return 'black-forest-labs';
      if (['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'dall-e-3', 'dall-e-2'].includes(normalized)) return 'openai';
      if (normalized === 'qwen-image-edit') return 'qwen';
      if (['real-esrgan', 'remove-bg'].includes(normalized)) return 'nightmareai';
      if (['face-to-sticker', 'become-image'].includes(normalized)) return 'fofr';
      return 'unknown';
    };
    const titleProvider = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === 'metis') return 'Metis';
      if (normalized === 'gemini') return 'Gemini';
      if (normalized === 'xai') return 'xAI';
      return normalized || 'unknown';
    };
    const checkStorageWritable = async (storageDir) => {
      const normalized = typeof storageDir === 'string' ? storageDir.trim() : '';
      if (!normalized) return false;
      try {
        await fs.ensureDir(normalized);
        await fs.access(normalized, fs.constants.W_OK);
        return true;
      } catch (_error) {
        return false;
      }
    };

    const settings = repositories?.settings && typeof repositories.settings.getAll === 'function'
      ? await repositories.settings.getAll().catch(() => ({}))
      : {};
    const storedImageModel = repositories?.settings && typeof repositories.settings.getStored === 'function'
      ? await repositories.settings.getStored('ai.image.model').catch(() => undefined)
      : undefined;
    const chatRuntime = runtimeConfig.ai?.chat || {};
    const imageRuntime = runtimeConfig.ai?.image || {};
    const resolvedImageRuntime = imageRuntimeSettingsResolver && typeof imageRuntimeSettingsResolver.getRuntimeSettings === 'function'
      ? await imageRuntimeSettingsResolver.getRuntimeSettings()
      : {};
    const imagePromptRefinerDiagnostics = imagePromptRefinerService && typeof imagePromptRefinerService.getDiagnostics === 'function'
      ? await imagePromptRefinerService.getDiagnostics({ force: true }).catch(() => null)
      : null;
    const visionDiagnostics = imageUnderstandingService && typeof imageUnderstandingService.getDiagnostics === 'function'
      ? await imageUnderstandingService.getDiagnostics({ force: true }).catch(() => null)
      : null;
    const intentRouterDiagnostics = intentRouterService && typeof intentRouterService.getDiagnostics === 'function'
      ? await intentRouterService.getDiagnostics({ force: true }).catch(() => null)
      : null;
    const conversationMemoryDiagnostics = conversationMemoryWriterService && typeof conversationMemoryWriterService.getDiagnostics === 'function'
      ? await conversationMemoryWriterService.getDiagnostics({ force: true }).catch(() => null)
      : null;
    const imageProvider = String(resolvedImageRuntime.provider || settings['ai.image.provider'] || imageRuntime.provider || 'metis').trim().toLowerCase();
    const imageModel = String(resolvedImageRuntime.modelAdminValue || storedImageModel || imageRuntime.model || 'gemini-2.5-flash-image').trim();
    const imageModelSource = resolvedImageRuntime.modelSource || (storedImageModel ? 'ai.image.model' : imageRuntime.modelSource || 'default');
    const imageRuntimeModel = String(resolvedImageRuntime.runtimeModel || resolveImageRuntimeModel(imageModel, imageProvider)).trim();
    const imageBaseUrl = String(resolvedImageRuntime.baseUrl || settings['ai.image.base_url'] || imageRuntime.baseUrl || 'https://api.metisai.ir').trim();
    const imageStorageDir = String(imageRuntime.storageDir || process.env.IMAGE_STORAGE_DIR || '').trim();
    const imagePublicBaseUrl = String(imageRuntime.publicBaseUrl || process.env.IMAGE_PUBLIC_BASE_URL || '/api/images/serve').replace(/\/+$/, '');
    const imageKey = imageRuntime.keys?.[imageProvider] || {
      apiKeySource: 'missing',
      apiKey: '',
      apiKeyFingerprint: ''
    };
    const storageWritable = await checkStorageWritable(imageStorageDir);
    return res.json({
      chat: {
        provider: titleProvider(chatRuntime.provider),
        model: settings['ai.chat.model'] || chatRuntime.model || null,
        baseUrlHost: chatRuntime.baseUrlHost || getHost(chatRuntime.baseUrl),
        ...safeKey(chatRuntime)
      },
      image: {
        enabled: Boolean(resolvedImageRuntime.enabled),
        provider: titleProvider(imageProvider),
        modelSource: imageModelSource,
        modelAdminValue: imageModel,
        modelRuntimeValue: imageRuntimeModel,
        modelProviderName: resolvedImageRuntime.runtimeProviderName || (imageProvider === 'metis' ? getMetisModelProviderName(imageRuntimeModel) : imageProvider),
        operation: resolvedImageRuntime.operation || 'Imagine',
        baseUrlHost: getHost(imageBaseUrl),
        ...safeKey(imageKey),
        resolution: resolvedImageRuntime.resolution || settings['ai.image.resolution'] || imageRuntime.resolution || '1K',
        aspectRatio: resolvedImageRuntime.aspectRatio || settings['ai.image.aspect_ratio'] || imageRuntime.aspectRatio || '1:1',
        outputFormat: resolvedImageRuntime.outputFormat || settings['ai.image.output_format'] || imageRuntime.outputFormat || 'jpg',
        safetyFilterLevel: resolvedImageRuntime.safetyFilterLevel || settings['ai.image.safety_filter_level'] || imageRuntime.safetyFilterLevel || 'block_only_high',
        pollIntervalMs: resolvedImageRuntime.pollIntervalMs,
        pollTimeoutMs: resolvedImageRuntime.pollTimeoutMs,
        maxDownloadMb: resolvedImageRuntime.maxDownloadMb,
        editEnabled: Boolean(resolvedImageRuntime.editEnabled),
        promptEnhancerEnabled: Boolean(resolvedImageRuntime.promptEnhancerEnabled),
        lastValidationStatus: resolvedImageRuntime.lastValidationStatus || 'valid',
        storageDir: imageStorageDir,
        storageWritable,
        publicServeRoute: `${imagePublicBaseUrl}/:taskId`
      },
      imagePromptRefiner: imagePromptRefinerDiagnostics || {
        enabled: false,
        provider: 'metis',
        model: 'gemini-2.5-flash',
        apiKeySource: 'missing',
        apiKeySet: false,
        temperature: 0.2,
        maxTokens: 700,
        timeoutMs: 6000,
        fallbackEnabled: true,
        cacheEnabled: true,
        cacheTtlMinutes: 1440,
        lastValidationStatus: 'unavailable'
      },
      intentRouter: intentRouterDiagnostics || {
        enabled: false,
        provider: 'metis',
        model: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-flash',
        experimentalModel: 'gemini-2.5-flash',
        apiKeySource: 'missing',
        apiKeySet: false,
        temperature: 0,
        maxOutputTokens: 120,
        timeoutMs: 2500,
        confidenceThreshold: 0.65,
        fallbackToHeuristic: true,
        allowModelFallback: true,
        allowChatKeyFallback: false,
        storeMetadata: true,
        health: {
          enabled: true,
          failureThreshold: 3,
          cooldownMinutes: 60,
          models: {}
        },
        lastValidationStatus: 'unavailable'
      },
      conversationMemory: conversationMemoryDiagnostics || {
        enabled: false,
        provider: 'metis',
        model: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-flash',
        apiKeySource: 'missing',
        apiKeySet: false,
        temperature: 0,
        maxOutputTokens: 3000,
        timeoutMs: 8000,
        allowModelFallback: true,
        allowChatKeyFallback: false,
        maxDocumentChars: 20000,
        storeMetadata: true,
        queueSize: 0,
        lastValidationStatus: 'unavailable'
      },
      vision: visionDiagnostics || {
        enabled: false,
        provider: 'metis-gemini',
        mode: 'balanced',
        defaultModel: 'gemini-2.5-flash',
        fastModel: 'gemini-2.5-flash',
        experimentalModel: 'gemini-2.5-flash-lite-preview',
        qualityModel: 'gemini-2.5-flash',
        proModel: 'gemini-2.5-pro',
        allowProModel: false,
        apiKeySource: 'missing',
        apiKeySet: false,
        transport: 'auto',
        timeoutMs: 30000,
        fallbackTimeoutMs: 45000,
        maxImageMb: 10,
        mediaResolution: 'auto',
        temperature: 0.1,
        maxOutputTokens: 900,
        selectedModelForSimpleImage: 'gemini-2.5-flash',
        selectedModelForOcrOrDesign: 'gemini-2.5-flash',
        modelHealth: {
          'gemini-2.5-flash-lite-preview': {
            status: 'failed_or_experimental',
            failures: 0,
            cooldownUntil: null,
            lastError: null
          },
          'gemini-2.5-flash': {
            status: 'healthy',
            failures: 0,
            cooldownUntil: null,
            lastError: null
          }
        },
        lastValidationStatus: 'unavailable'
      }
    });
  });

  return router;
}

module.exports = { createAdminRuntimeStatusRouter };
