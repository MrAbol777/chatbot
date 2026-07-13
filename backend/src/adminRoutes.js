const express = require('express');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const { resolveImageRuntimeModel } = require('./bootstrap/config');
const {
  IMAGE_MODEL_PRESETS,
  buildMetisRequestBody,
  imageSettingsPayloadToSettings,
  normalizeRuntimeSettings,
  settingKey,
  validateRuntimeSettings
} = require('./modules/image-generation/image-runtime-settings');
const { buildFinalImagePrompt } = require('./modules/image-generation/image-generation.controller');
const {
  normalizePromptRefinerSettings,
  promptRefinerSettingKey
} = require('./modules/image-generation/image-prompt-refiner.service');
const {
  normalizeVisionSettings,
  validateVisionSettings,
  visionSettingKey,
  visionSettingsPayloadToSettings
} = require('./modules/image-understanding/image-understanding-settings');
const { createIntentRouterAdminRouter } = require('./modules/intent-router/intent-router.routes');
const { createConversationMemoryAdminRouter } = require('./modules/conversation-memory/conversation-memory.routes');
const { createAdminAnalyticsService } = require('./modules/admin/analytics/service');
const { createAdminAnalyticsRouter } = require('./modules/admin/analytics/routes');
const { createAdminSystemService } = require('./modules/admin/system/service');
const { createAdminSystemRouter } = require('./modules/admin/system/routes');
const { createAdminLogsService } = require('./modules/admin/logs/service');
const { createAdminLogsRouter } = require('./modules/admin/logs/routes');
const { createAdminSettingsService } = require('./modules/admin/settings/service');
const { createAdminSettingsRouter } = require('./modules/admin/settings/routes');
const { createLoginLimiter, createRequireAdminAuth, parseBannedFilter } = require('./modules/admin/common/auth');
const {
  CONFIG_FILE_PATH,
  SYSTEM_PROMPT_PATH,
  DEFAULT_CONFIG,
  ensureAdminData,
  ensureConfigData,
  readAuditLogs,
  appendAudit
} = require('./modules/admin/common/storage');

const ADMIN_IMAGE_MIME_FALLBACK = 'image/jpeg';
const isSafeRedirectImageUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

function createAdminModule({
  jwtSecret,
  cookieName = 'admin_token',
  onSystemPromptUpdated,
  adminApiKey = '',
  repositories,
  runtimeConfig = {},
  imageRuntimeSettingsResolver,
  imageGenerationService,
  imagePromptRefinerService,
  imageUnderstandingService,
  intentRouterService,
  conversationMemoryService,
  conversationMemoryWriterService
}) {
  const router = express.Router();
  const adminVisionUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1
    }
  });
  const isSystemPromptEditEnabled = () => process.env.ENABLE_SYSTEM_PROMPT_EDIT !== 'false';
  const usersRepository = repositories?.users;
  const analyticsRepository = repositories?.analytics;
  const plansRepository = repositories?.plans;
  const supervisedOtpRepository = repositories?.supervisedOtp;

  const loginLimiter = createLoginLimiter();
  const requireAdminAuth = createRequireAdminAuth({
    cookieName,
    jwtSecret
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!username || !password) {
        return res.status(400).json({ error: 'نام کاربری یا رمز عبور نامعتبر است.' });
      }

      const admins = await ensureAdminData();
      const admin = admins.find((item) => item.username === username);
      if (!admin) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      const ok = await bcrypt.compare(password, admin.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      const token = jwt.sign(
        {
          id: admin.id,
          username: admin.username,
          role: admin.role
        },
        jwtSecret,
        { expiresIn: '8h' }
      );

      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
      });

      await appendAudit({
        adminUsername: admin.username,
        action: 'admin_login',
        target: admin.id,
        details: { role: admin.role }
      });

      return res.json({
        success: true,
        admin: { username: admin.username, role: admin.role }
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در ورود ادمین' });
    }
  });

  router.post('/logout', requireAdminAuth, async (req, res) => {
    res.clearCookie(cookieName);
    await appendAudit({
      adminUsername: req.admin?.username,
      action: 'admin_logout',
      target: req.admin?.id,
      details: {}
    });
    return res.json({ success: true });
  });

  router.get('/me', requireAdminAuth, (req, res) => {
    return res.json({ admin: req.admin });
  });

  const getImageRuntimeSettings = async (options = {}) => {
    if (imageRuntimeSettingsResolver && typeof imageRuntimeSettingsResolver.getRuntimeSettings === 'function') {
      return imageRuntimeSettingsResolver.getRuntimeSettings(options);
    }
    const settings = repositories?.settings && typeof repositories.settings.getAll === 'function'
      ? await repositories.settings.getAll().catch(() => ({}))
      : {};
    return normalizeRuntimeSettings({
      settings,
      stored: {},
      imageConfig: runtimeConfig.ai?.image || {}
    });
  };

  const makeImageDryRun = async (prompt, overrideSettings = null) => {
    let runtimeSettings;
    if (overrideSettings && typeof overrideSettings === 'object') {
      const current = repositories?.settings && typeof repositories.settings.getAll === 'function'
        ? await repositories.settings.getAll()
        : {};
      runtimeSettings = normalizeRuntimeSettings({
        settings: { ...current, ...overrideSettings },
        stored: overrideSettings,
        imageConfig: runtimeConfig.ai?.image || {}
      });
      validateRuntimeSettings(runtimeSettings);
    } else {
      runtimeSettings = await getImageRuntimeSettings({ force: true });
    }
    const originalPrompt = prompt || 'A single blue banana, clean white background';
    const fallbackPrompt = buildFinalImagePrompt(originalPrompt, {
      promptEnhancerEnabled: runtimeSettings.promptEnhancerEnabled,
      defaultNegativePrompt: runtimeSettings.defaultNegativePrompt
    });
    const refiner = imagePromptRefinerService;
    const promptRefinerSettings = normalizePromptRefinerSettings({
      settings: overrideSettings && typeof overrideSettings === 'object'
        ? { ...(repositories?.settings && typeof repositories.settings.getAll === 'function' ? await repositories.settings.getAll() : {}), ...overrideSettings }
        : repositories?.settings && typeof repositories.settings.getAll === 'function' ? await repositories.settings.getAll().catch(() => ({})) : {},
      refinerConfig: runtimeConfig.ai?.image?.promptRefiner || {}
    });
    const refineResult = refiner && typeof refiner.refine === 'function'
      ? await refiner.refine({
          userPrompt: originalPrompt,
          imageMode: 'text-to-image',
          locale: 'fa',
          imageSettings: runtimeSettings,
          settings: overrideSettings
        })
      : { ok: false, refinedPrompt: fallbackPrompt, negativePrompt: runtimeSettings.defaultNegativePrompt, status: 'disabled' };
    const mergedNegativePrompt = refineResult.ok && typeof refiner.mergeNegativePrompts === 'function'
      ? refiner.mergeNegativePrompts(runtimeSettings.defaultNegativePrompt, refineResult.negativePrompt)
      : runtimeSettings.defaultNegativePrompt;
    const finalPrompt = refineResult.ok && typeof refiner.buildFinalPromptWithNegative === 'function'
      ? refiner.buildFinalPromptWithNegative({ refinedPrompt: refineResult.refinedPrompt, negativePrompt: mergedNegativePrompt })
      : fallbackPrompt;
    return {
      runtimeSettings,
      promptRefinerSettings,
      promptRefiner: {
        ...refineResult,
        negativePrompt: refineResult.ok ? mergedNegativePrompt : refineResult.negativePrompt
      },
      originalPrompt,
      finalPrompt,
      requestBody: buildMetisRequestBody({ prompt: finalPrompt, runtimeSettings })
    };
  };

  const getPromptRefinerSettings = async (settingsOverride = null) => normalizePromptRefinerSettings({
    settings: settingsOverride || (repositories?.settings && typeof repositories.settings.getAll === 'function'
      ? await repositories.settings.getAll().catch(() => ({}))
      : {}),
    refinerConfig: runtimeConfig.ai?.image?.promptRefiner || {}
  });

  const getVisionRuntimeSettings = async (settingsOverride = null) => {
    if (!settingsOverride && imageUnderstandingService && typeof imageUnderstandingService.getRuntimeSettings === 'function') {
      return imageUnderstandingService.getRuntimeSettings({ force: true });
    }
    return normalizeVisionSettings({
      settings: settingsOverride || (repositories?.settings && typeof repositories.settings.getAll === 'function'
        ? await repositories.settings.getAll().catch(() => ({}))
        : {}),
      visionConfig: runtimeConfig.ai?.vision || {}
    });
  };

  router.get('/image-model-presets', requireAdminAuth, (_req, res) => {
    return res.json({ presets: IMAGE_MODEL_PRESETS });
  });

  router.get('/image-settings', requireAdminAuth, async (_req, res) => {
    const runtimeSettings = await getImageRuntimeSettings({ force: true });
    return res.json({
      settings: runtimeSettings,
      presets: IMAGE_MODEL_PRESETS,
      settingKeys: settingKey
    });
  });

  router.put('/image-settings', requireAdminAuth, async (req, res) => {
    try {
      const incomingSettings = imageSettingsPayloadToSettings(req.body);
      const cleanSettings = Object.fromEntries(
        Object.entries(incomingSettings).filter(([, value]) => value !== undefined)
      );
      const current = repositories?.settings && typeof repositories.settings.getAll === 'function'
        ? await repositories.settings.getAll()
        : {};
      const nextSettings = { ...current, ...cleanSettings };
      const runtimeSettings = normalizeRuntimeSettings({
        settings: nextSettings,
        stored: cleanSettings,
        imageConfig: runtimeConfig.ai?.image || {}
      });
      validateRuntimeSettings(runtimeSettings);

      const before = current;
      const result = await repositories.settings.updateMany(cleanSettings);
      if (imageRuntimeSettingsResolver && typeof imageRuntimeSettingsResolver.invalidate === 'function') {
        imageRuntimeSettingsResolver.invalidate();
      }
      if (imagePromptRefinerService && typeof imagePromptRefinerService.invalidate === 'function') {
        imagePromptRefinerService.invalidate();
      }
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_image_settings',
        target: 'image_settings',
        details: {
          changedKeys: Object.keys(cleanSettings),
          before: Object.fromEntries(Object.keys(cleanSettings).map((key) => [key, before[key]])),
          after: cleanSettings
        }
      });

      return res.json({
        success: true,
        settings: await getImageRuntimeSettings({ force: true }),
        siteSettings: result.settings
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'ذخیره تنظیمات ساخت تصویر ناموفق بود.'
      });
    }
  });

  router.post('/image-settings/test-dry-run', requireAdminAuth, async (req, res) => {
    try {
      const dryRun = await makeImageDryRun(String(req.body?.prompt || '').trim(), req.body?.settings);
      return res.json({
        success: true,
        mode: 'dry-run',
        originalPrompt: dryRun.originalPrompt,
        finalPrompt: dryRun.finalPrompt,
        refiner: dryRun.promptRefiner,
        runtime: {
          provider: dryRun.runtimeSettings.provider,
          modelSource: dryRun.runtimeSettings.modelSource,
          modelAdminValue: dryRun.runtimeSettings.modelAdminValue,
          runtimeProviderName: dryRun.runtimeSettings.runtimeProviderName,
          runtimeModel: dryRun.runtimeSettings.runtimeModel,
          operation: dryRun.runtimeSettings.operation,
          resolution: dryRun.runtimeSettings.resolution,
          aspectRatio: dryRun.runtimeSettings.aspectRatio,
          outputFormat: dryRun.runtimeSettings.outputFormat,
          safetyFilterLevel: dryRun.runtimeSettings.safetyFilterLevel
        },
        requestBody: dryRun.requestBody
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Dry-run ساخت تصویر ناموفق بود.' });
    }
  });

  router.get('/image-prompt-refiner-settings', requireAdminAuth, async (_req, res) => {
    return res.json({
      settings: await getPromptRefinerSettings(),
      settingKeys: promptRefinerSettingKey
    });
  });

  router.put('/image-prompt-refiner-settings', requireAdminAuth, async (req, res) => {
    try {
      const raw = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body;
      const cleanSettings = Object.fromEntries(
        Object.values(promptRefinerSettingKey)
          .filter((key) => Object.prototype.hasOwnProperty.call(raw || {}, key))
          .map((key) => [key, raw[key]])
      );
      const result = await repositories.settings.updateMany(cleanSettings);
      if (imagePromptRefinerService && typeof imagePromptRefinerService.invalidate === 'function') {
        imagePromptRefinerService.invalidate();
      }
      if (imageRuntimeSettingsResolver && typeof imageRuntimeSettingsResolver.invalidate === 'function') {
        imageRuntimeSettingsResolver.invalidate();
      }
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_image_prompt_refiner_settings',
        target: 'image_prompt_refiner',
        details: { changedKeys: Object.keys(cleanSettings) }
      });
      return res.json({
        success: true,
        settings: await getPromptRefinerSettings(result.settings),
        siteSettings: result.settings
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'ذخیره تنظیمات بهینه‌ساز پرامپت تصویر ناموفق بود.' });
    }
  });

  router.post('/image-prompt-refiner/test-dry-run', requireAdminAuth, async (req, res) => {
    try {
      const dryRun = await makeImageDryRun(String(req.body?.prompt || '').trim(), req.body?.settings);
      return res.json({
        success: true,
        mode: 'prompt-refiner-dry-run',
        originalPrompt: dryRun.originalPrompt,
        refinedPrompt: dryRun.promptRefiner?.refinedPrompt || dryRun.finalPrompt,
        negativePrompt: dryRun.promptRefiner?.negativePrompt || '',
        detectedSubject: dryRun.promptRefiner?.detectedSubject || null,
        hasHumanSubject: Boolean(dryRun.promptRefiner?.hasHumanSubject),
        hasChildSubject: Boolean(dryRun.promptRefiner?.hasChildSubject),
        containsTextInImage: Boolean(dryRun.promptRefiner?.containsTextInImage),
        textToRender: dryRun.promptRefiner?.textToRender || null,
        refiner: dryRun.promptRefiner,
        runtime: {
          provider: dryRun.runtimeSettings.provider,
          modelSource: dryRun.runtimeSettings.modelSource,
          modelAdminValue: dryRun.runtimeSettings.modelAdminValue,
          runtimeProviderName: dryRun.runtimeSettings.runtimeProviderName,
          runtimeModel: dryRun.runtimeSettings.runtimeModel,
          operation: dryRun.runtimeSettings.operation,
          resolution: dryRun.runtimeSettings.resolution,
          aspectRatio: dryRun.runtimeSettings.aspectRatio,
          outputFormat: dryRun.runtimeSettings.outputFormat,
          safetyFilterLevel: dryRun.runtimeSettings.safetyFilterLevel
        },
        finalPrompt: dryRun.finalPrompt,
        requestBody: dryRun.requestBody
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Dry-run بهینه‌ساز پرامپت تصویر ناموفق بود.' });
    }
  });

  router.post('/image-settings/test-live', requireAdminAuth, async (req, res) => {
    try {
      if (!imageGenerationService || typeof imageGenerationService.generateImage !== 'function') {
        return res.status(503).json({ error: 'سرویس ساخت تصویر در دسترس نیست.' });
      }
      const dryRun = await makeImageDryRun(String(req.body?.prompt || '').trim(), req.body?.settings);
      const runtimeSettings = dryRun.runtimeSettings;
      const image = await imageGenerationService.generateImage(dryRun.finalPrompt, {
        imageModel: runtimeSettings.modelAdminValue,
        modelSource: runtimeSettings.modelSource,
        runtimeProviderName: runtimeSettings.runtimeProviderName,
        runtimeModel: runtimeSettings.runtimeModel,
        operation: runtimeSettings.operation,
        provider: runtimeSettings.provider,
        baseUrl: runtimeSettings.baseUrl,
        resolution: runtimeSettings.resolution,
        aspectRatio: runtimeSettings.aspectRatio,
        outputFormat: runtimeSettings.outputFormat,
        safetyFilterLevel: runtimeSettings.safetyFilterLevel,
        pollIntervalMs: runtimeSettings.pollIntervalMs,
        pollTimeoutMs: runtimeSettings.pollTimeoutMs,
        customArgs: runtimeSettings.customArgs,
        editEnabled: runtimeSettings.editEnabled,
        originalPrompt: dryRun.originalPrompt,
        taskId: 'admin-live-test',
        maxDownloadMb: runtimeSettings.maxDownloadMb
      });
      return res.json({
        success: true,
        mode: 'live',
        finalPrompt: dryRun.finalPrompt,
        requestBody: dryRun.requestBody,
        result: {
          provider: image.provider,
          modelAdminValue: image.modelAdminValue,
          modelRuntimeValue: image.modelRuntimeValue,
          mimeType: image.mimeType,
          bytes: image.buffer?.length || 0,
          remoteImageUrlHost: image.remoteImageUrlHost || null
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'تست واقعی ساخت تصویر ناموفق بود.' });
    }
  });

  router.post('/image-prompt-refiner/test-live', requireAdminAuth, async (req, res) => {
    try {
      if (!imageGenerationService || typeof imageGenerationService.generateImage !== 'function') {
        return res.status(503).json({ error: 'سرویس ساخت تصویر در دسترس نیست.' });
      }
      const dryRun = await makeImageDryRun(String(req.body?.prompt || '').trim(), req.body?.settings);
      const runtimeSettings = dryRun.runtimeSettings;
      const image = await imageGenerationService.generateImage(dryRun.finalPrompt, {
        imageModel: runtimeSettings.modelAdminValue,
        modelSource: runtimeSettings.modelSource,
        runtimeProviderName: runtimeSettings.runtimeProviderName,
        runtimeModel: runtimeSettings.runtimeModel,
        operation: runtimeSettings.operation,
        provider: runtimeSettings.provider,
        baseUrl: runtimeSettings.baseUrl,
        resolution: runtimeSettings.resolution,
        aspectRatio: runtimeSettings.aspectRatio,
        outputFormat: runtimeSettings.outputFormat,
        safetyFilterLevel: runtimeSettings.safetyFilterLevel,
        pollIntervalMs: runtimeSettings.pollIntervalMs,
        pollTimeoutMs: runtimeSettings.pollTimeoutMs,
        customArgs: runtimeSettings.customArgs,
        editEnabled: runtimeSettings.editEnabled,
        originalPrompt: dryRun.originalPrompt,
        taskId: 'admin-prompt-refiner-live-test',
        maxDownloadMb: runtimeSettings.maxDownloadMb
      });
      return res.json({
        success: true,
        mode: 'prompt-refiner-live',
        originalPrompt: dryRun.originalPrompt,
        refiner: dryRun.promptRefiner,
        finalPrompt: dryRun.finalPrompt,
        requestBody: dryRun.requestBody,
        result: {
          provider: image.provider,
          modelAdminValue: image.modelAdminValue,
          modelRuntimeValue: image.modelRuntimeValue,
          mimeType: image.mimeType,
          bytes: image.buffer?.length || 0,
          remoteImageUrlHost: image.remoteImageUrlHost || null
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'تست واقعی بهینه‌ساز پرامپت تصویر ناموفق بود.' });
    }
  });

  router.get('/vision-settings', requireAdminAuth, async (_req, res) => {
    const settings = await getVisionRuntimeSettings();
    const diagnostics = imageUnderstandingService && typeof imageUnderstandingService.getDiagnostics === 'function'
      ? await imageUnderstandingService.getDiagnostics({ force: true }).catch(() => null)
      : null;
    return res.json({
      settings,
      diagnostics,
      settingKeys: visionSettingKey
    });
  });

  router.put('/vision-settings', requireAdminAuth, async (req, res) => {
    try {
      const incomingSettings = visionSettingsPayloadToSettings(req.body);
      const cleanSettings = Object.fromEntries(
        Object.entries(incomingSettings).filter(([, value]) => value !== undefined)
      );
      const current = repositories?.settings && typeof repositories.settings.getAll === 'function'
        ? await repositories.settings.getAll()
        : {};
      const runtimeSettings = normalizeVisionSettings({
        settings: { ...current, ...cleanSettings },
        visionConfig: runtimeConfig.ai?.vision || {}
      });
      validateVisionSettings(runtimeSettings);
      const result = await repositories.settings.updateMany(cleanSettings);
      if (imageUnderstandingService && typeof imageUnderstandingService.invalidate === 'function') {
        imageUnderstandingService.invalidate();
      }
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_vision_settings',
        target: 'vision_settings',
        details: {
          changedKeys: Object.keys(cleanSettings),
          before: Object.fromEntries(Object.keys(cleanSettings).map((key) => [key, current[key]])),
          after: cleanSettings
        }
      });
      return res.json({
        success: true,
        settings: await getVisionRuntimeSettings(result.settings),
        siteSettings: result.settings
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'ذخیره تنظیمات خواندن تصویر ناموفق بود.'
      });
    }
  });

  router.post('/vision/test-dry-run', requireAdminAuth, async (req, res) => {
    try {
      if (!imageUnderstandingService || typeof imageUnderstandingService.makeDryRun !== 'function') {
        return res.status(503).json({ error: 'سرویس خواندن تصویر در دسترس نیست.' });
      }
      const dryRun = await imageUnderstandingService.makeDryRun({
        prompt: String(req.body?.prompt || '').trim(),
        settingsOverride: req.body?.settings,
        transport: req.body?.transport
      });
      return res.json({
        success: true,
        mode: 'vision-dry-run',
        model: dryRun.model,
        transport: dryRun.transport,
        endpoint: dryRun.endpoint,
        adapter: dryRun.adapter,
        requestBody: dryRun.requestBody
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Dry-run خواندن تصویر ناموفق بود.' });
    }
  });

  router.post('/vision/test-live', requireAdminAuth, adminVisionUpload.single('image'), async (req, res) => {
    try {
      if (!imageUnderstandingService || typeof imageUnderstandingService.analyzeImages !== 'function') {
        return res.status(503).json({ error: 'سرویس خواندن تصویر در دسترس نیست.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'برای تست واقعی، یک تصویر آپلود کن.' });
      }
      const prompt = String(req.body?.prompt || 'این عکس رو دقیق توضیح بده').trim();
      const settingsOverride = req.body?.settings ? JSON.parse(req.body.settings) : null;
      const result = await imageUnderstandingService.analyzeImages({
        userPrompt: prompt,
        images: [{
          id: req.file.originalname,
          source: 'admin_upload',
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
          originalName: req.file.originalname
        }],
        requestId: res.locals.requestId,
        settingsOverride,
        transport: req.body?.transport
      });
      return res.json({
        success: true,
        mode: 'vision-live',
        reply: result.answer,
        model: result.model,
        provider: result.provider,
        requestBody: result.requestBody,
        diagnostics: result.diagnostics
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'تست واقعی خواندن تصویر ناموفق بود.'
      });
    }
  });

  router.post('/vision/model-probe', requireAdminAuth, async (req, res) => {
    try {
      if (!imageUnderstandingService || typeof imageUnderstandingService.probeModels !== 'function') {
        return res.status(503).json({ error: 'سرویس تست مدل Vision در دسترس نیست.' });
      }
      const probe = await imageUnderstandingService.probeModels({
        settingsOverride: req.body?.settings,
        transport: req.body?.transport || 'inline'
      });
      return res.json({
        success: true,
        transport: probe.transport,
        apiKeySource: probe.apiKeySource,
        models: probe.models,
        modelHealth: probe.modelHealth
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'تست مدل Vision ناموفق بود.'
      });
    }
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
    const resolvedImageRuntime = await getImageRuntimeSettings();
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
    const freePlan =
      plansRepository && typeof plansRepository.getDefaultPlanForFreeUser === 'function'
        ? await plansRepository.getDefaultPlanForFreeUser().catch(() => null)
        : null;
    const guestDailyLimit = settings['guest.image_limit_daily'] ?? null;
    const guestHourlyLimit = settings['guest.image_limit_hourly'] ?? null;
    const freeDailyLimit = freePlan?.dailyImageLimit ?? null;
    const freeHourlyLimit = freePlan?.hourlyImageLimit ?? null;
    const describeImagePlan = ({ planId, planName, dailyLimit, hourlyLimit }) => {
      const disabledReason =
        dailyLimit === 0 ? 'daily_image_limit_disabled' :
        hourlyLimit === 0 ? 'hourly_image_limit_disabled' :
        null;
      return {
        planId,
        planName,
        dailyImageLimit: dailyLimit,
        hourlyImageLimit: hourlyLimit,
        usedToday: null,
        usedThisHour: null,
        enabled: !disabledReason,
        disabledReason
      };
    };

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
        model: 'gemini-2.5-flash-lite-preview',
        fallbackModel: 'gemini-2.5-flash',
        experimentalModel: 'gemini-2.5-flash-lite-preview',
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
        model: 'gemini-2.5-flash-lite-preview',
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
      },
      imagePlan: {
        defaultFree: describeImagePlan({
          planId: freePlan?.id || 'free',
          planName: freePlan?.name || 'free',
          dailyLimit: freeDailyLimit,
          hourlyLimit: freeHourlyLimit
        }),
        guest: describeImagePlan({
          planId: 'guest',
          planName: 'guest',
          dailyLimit: guestDailyLimit,
          hourlyLimit: guestHourlyLimit
        })
      }
    });
  });

  router.get('/users', requireAdminAuth, async (req, res) => {
    try {
      const { q = '', phone = '', isBanned, page = '1', pageSize = '20' } = req.query;
      const result = await analyticsRepository.listUsersWithConversationStats({
        search: q,
        phone,
        isBanned: parseBannedFilter(isBanned),
        page,
        pageSize
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت کاربران' });
    }
  });

  router.get('/users/:id', requireAdminAuth, async (req, res) => {
    try {
      const profile = await usersRepository.getUserFullProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }
      return res.json(profile);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت کاربر' });
    }
  });

  // All generated images are served through this admin-only list.  Keep the
  // original user prompt separate from the final prompt sent to the provider.
  router.get('/image-generations', requireAdminAuth, async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim().slice(0, 191);
      const status = String(req.query?.status || '').trim().toUpperCase();
      const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query?.pageSize || '20'), 10) || 20));
      const offset = (page - 1) * pageSize;
      const allowedStatuses = new Set(['QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED']);
      const filters = ['g.deleted_at IS NULL'];
      const values = [];

      if (status && allowedStatuses.has(status)) {
        filters.push('g.status = ?');
        values.push(status);
      }
      if (query) {
        filters.push('(u.name LIKE ? OR u.phone LIKE ? OR g.original_prompt LIKE ? OR g.prompt LIKE ?)');
        const search = `%${query}%`;
        values.push(search, search, search, search);
      }

      const where = filters.join(' AND ');
      const [countResult, itemsResult] = await Promise.all([
        repositories.db.query(
          `SELECT COUNT(*) AS total
           FROM image_generations g
           INNER JOIN app_users u ON u.user_id = g.user_id
           WHERE ${where}`,
          values
        ),
        repositories.db.query(
          `SELECT g.id, g.task_id, g.user_id, g.original_prompt, g.refined_prompt, g.prompt,
                  g.status, g.operation, g.created_at, g.provider, g.model_admin_value,
                  u.name AS user_name, u.phone AS user_phone, u.age AS user_age
           FROM image_generations g
           INNER JOIN app_users u ON u.user_id = g.user_id
           WHERE ${where}
           ORDER BY g.created_at DESC, g.id DESC
           LIMIT ? OFFSET ?`,
          [...values, pageSize, offset]
        )
      ]);
      const [countRows] = countResult;
      const [items] = itemsResult;
      const totalRow = countRows[0];

      const rows = items.map((item) => ({
        id: String(item.id),
        taskId: item.task_id,
        userId: item.user_id,
        user: {
          name: item.user_name || 'کاربر مهمان',
          phone: item.user_phone || null,
          age: item.user_age ?? null
        },
        originalPrompt: item.original_prompt || item.prompt || '',
        apiPrompt: item.refined_prompt || item.prompt || '',
        status: item.status,
        operation: item.operation || 'generate',
        createdAt: item.created_at,
        provider: item.provider || null,
        model: item.model_admin_value || null,
        imageUrl: item.status === 'COMPLETED'
          ? `/api/admin/users/${encodeURIComponent(String(item.user_id))}/images/${encodeURIComponent(String(item.id))}`
          : null
      }));

      return res.json({ items: rows, total: Number(totalRow?.total || 0), page, pageSize });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت تصاویر ساخته‌شده' });
    }
  });

  router.get('/users/:id/images/:taskId', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.params.id || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      if (!userId || !taskId) {
        return res.status(400).json({ error: 'شناسه کاربر و تصویر الزامی است.' });
      }

      const [rows] = await repositories.db.query(
        `SELECT id, task_id, status, image_url, local_file_path, mime_type
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );
      const record = rows[0];
      if (!record) {
        return res.status(404).json({ error: 'تصویر پیدا نشد.' });
      }
      if (record.status !== 'COMPLETED') {
        return res.status(409).json({ error: 'تصویر هنوز آماده نیست.' });
      }

      const localPath = typeof record.local_file_path === 'string' ? record.local_file_path.trim() : '';
      if (localPath && await fs.pathExists(localPath)) {
        const stat = await fs.stat(localPath);
        if (!stat.isFile() || stat.size <= 0) {
          return res.status(404).json({ error: 'فایل تصویر پیدا نشد.' });
        }
        res.type(record.mime_type || ADMIN_IMAGE_MIME_FALLBACK);
        res.setHeader('Cache-Control', 'private, max-age=300');
        return fs.createReadStream(localPath).pipe(res);
      }

      if (isSafeRedirectImageUrl(record.image_url)) {
        return res.redirect(record.image_url);
      }

      return res.status(404).json({ error: 'فایل تصویر پیدا نشد.' });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت تصویر' });
    }
  });

  router.patch('/users/:id/ban', requireAdminAuth, async (req, res) => {
    const isBanned = Boolean(req.body?.isBanned);
    const user = await usersRepository.setUserBanStatus(req.params.id, isBanned);
    if (!user) {
      return res.status(404).json({ error: 'کاربر پیدا نشد.' });
    }

    await appendAudit({
      adminUsername: req.admin?.username,
      action: isBanned ? 'ban_user' : 'unban_user',
      target: req.params.id,
      details: { isBanned }
    });

    return res.json({ success: true, user });
  });

  router.delete('/users/:id', requireAdminAuth, async (req, res) => {
    const result = await usersRepository.deleteUserAndConversations(req.params.id);
    if (!result.deleted) {
      return res.status(404).json({ error: 'کاربر پیدا نشد.' });
    }

    await appendAudit({
      adminUsername: req.admin?.username,
      action: 'delete_user',
      target: req.params.id,
      details: { deletedConversations: result.conversationCount }
    });

    return res.json({ success: true, ...result });
  });

  router.get('/subscriptions', requireAdminAuth, async (_req, res) => {
    try {
      const [subscriptions, usersResult] = await Promise.all([
        plansRepository.readUserSubscriptions(),
        analyticsRepository.listUsersWithConversationStats({ page: 1, pageSize: 100 })
      ]);
      const plans = await plansRepository.listPlans();
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const userById = new Map((usersResult.items || []).map((user) => [String(user.user_id), user]));
      const userSubscriptions = subscriptions.map((item) => ({
        ...item,
        plan: planById.get(item.planId) || null,
        user: userById.get(String(item.userId)) || null
      }));
      return res.json({
        plans,
        userSubscriptions,
        users: usersResult.items || [],
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت اشتراک‌ها' });
    }
  });

  router.put('/subscriptions/plans/:id', requireAdminAuth, async (req, res) => {
    try {
      const planId = String(req.params.id || '').trim();
      const current = await plansRepository.getPlanById(planId);
      if (!current) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }

      const nextPlan = {
        ...current,
        ...req.body,
        id: planId,
        features: Array.isArray(req.body?.features)
          ? req.body.features
          : typeof req.body?.featuresText === 'string'
            ? req.body.featuresText.split('\n').map((item) => item.trim()).filter(Boolean)
            : current.features
      };
      const savedPlan = await plansRepository.upsertPlan(nextPlan);

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_subscription_plan',
        target: planId,
        details: { name: nextPlan.name, isActive: nextPlan.isActive }
      });

      return res.json({ success: true, plan: savedPlan });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'ذخیره پلن ناموفق بود.' });
    }
  });

  router.patch('/subscriptions/plans/:id/active', requireAdminAuth, async (req, res) => {
    try {
      const planId = String(req.params.id || '').trim();
      const plan = await plansRepository.setPlanActive(planId, Boolean(req.body?.isActive));
      if (!plan) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'toggle_subscription_plan',
        target: planId,
        details: { isActive: plan.isActive }
      });
      return res.json({ success: true, plan });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'تغییر وضعیت پلن ناموفق بود.' });
    }
  });

  router.post('/subscriptions/assign', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.body?.userId || '').trim();
      const planId = String(req.body?.planId || '').trim();
      const expiresAt = typeof req.body?.expiresAt === 'string' && req.body.expiresAt.trim() ? req.body.expiresAt.trim() : null;
      if (!userId || !planId) {
        return res.status(400).json({ error: 'کاربر و پلن الزامی است.' });
      }

      const user = await usersRepository.getUserFullProfile(userId);
      if (!user) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }

      const plan = await plansRepository.getPlanById(planId);
      if (!plan) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }

      const assignedAt = new Date().toISOString();
      const nextSubscription = {
        userId,
        planId,
        status: 'active',
        assignedAt,
        expiresAt,
        note: typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      };
      const subscriptions = await plansRepository.readUserSubscriptions();
      const userSubscriptions = await plansRepository.writeUserSubscriptions([
        nextSubscription,
        ...subscriptions.filter((item) => String(item.userId) !== userId)
      ]);

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'assign_subscription',
        target: userId,
        details: { planId, expiresAt }
      });

      return res.json({ success: true, subscription: userSubscriptions.find((item) => item.userId === userId) });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'اختصاص اشتراک ناموفق بود.' });
    }
  });

  router.delete('/subscriptions/users/:userId', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const subscriptions = await plansRepository.readUserSubscriptions();
      const before = subscriptions.length;
      const userSubscriptions = await plansRepository.writeUserSubscriptions(
        subscriptions.filter((item) => String(item.userId) !== userId)
      );

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'cancel_subscription',
        target: userId,
        details: { removed: before !== userSubscriptions.length }
      });

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'لغو اشتراک ناموفق بود.' });
    }
  });

  router.get('/supervised-otp', requireAdminAuth, async (_req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      return res.json(await supervisedOtpRepository.getConfig());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت Supervised OTP' });
    }
  });

  router.put('/supervised-otp', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.updateConfig({
        enabled: Boolean(req.body?.enabled),
        code: req.body?.code,
        expires_at: req.body?.expires_at,
        max_uses: req.body?.max_uses
      });
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_supervised_otp',
        target: 'supervised_otp',
        details: {
          enabled: config.enabled,
          hasCode: config.hasCode,
          expires_at: config.expires_at,
          max_uses: config.max_uses
        }
      });
      return res.json(config);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      return res.status(statusCode).json({ error: error instanceof Error ? error.message : 'ذخیره Supervised OTP ناموفق بود.' });
    }
  });

  router.post('/supervised-otp/reset-used-count', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.resetUsedCount();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'reset_supervised_otp_used_count',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'ریست شمارنده Supervised OTP ناموفق بود.' });
    }
  });

  router.delete('/supervised-otp', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.deleteCode();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'delete_supervised_otp',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'حذف Supervised OTP ناموفق بود.' });
    }
  });

  const analyticsService = createAdminAnalyticsService({
    analyticsRepository: { readDB: (...args) => analyticsRepository.readDB(...args) },
    getTotalUsers: (...args) => analyticsRepository.getTotalUsers(...args),
    getActiveUsersToday: (...args) => analyticsRepository.getActiveUsersToday(...args),
    getApiCallsToday: (...args) => analyticsRepository.getApiCallsToday(...args),
    getErrorCountToday: (...args) => analyticsRepository.getErrorCountToday(...args),
    getUserGrowth: (...args) => analyticsRepository.getUserGrowth(...args),
    getApiUsage: (...args) => analyticsRepository.getApiUsage(...args),
    getErrorDistribution: (...args) => analyticsRepository.getErrorDistribution(...args),
    getRecentAuditLogs: (...args) => analyticsRepository.getRecentAuditLogs(...args),
    getStats: (...args) => analyticsRepository.getStats(...args),
    getPlanSubscriptions: (...args) => plansRepository.readUserSubscriptions(...args),
    getSupervisedOtpUsage: (...args) => supervisedOtpRepository?.listUsage?.(...args)
  });
  const analyticsRouter = createAdminAnalyticsRouter({
    analyticsService,
    adminApiKey,
    requireAdminAuth
  });

  const systemService = createAdminSystemService({
    ensureConfigData,
    fileStore: fs,
    configFilePath: CONFIG_FILE_PATH,
    systemPromptFilePath: SYSTEM_PROMPT_PATH,
    appendAudit,
    isSystemPromptEditEnabled,
    onSystemPromptUpdated,
    defaultConfig: DEFAULT_CONFIG,
    readJson: fs.readJson,
    writeJson: fs.writeJson
  });
  const systemRouter = createAdminSystemRouter({
    systemService,
    requireAdminAuth
  });

  const logsService = createAdminLogsService({
    readDB: (...args) => analyticsRepository.readDB(...args),
    readAuditLogs
  });
  const logsRouter = createAdminLogsRouter({
    logsService,
    requireAdminAuth
  });

  const settingsService = createAdminSettingsService({
    settingsRepository: repositories.settings,
    appendAudit,
    onSettingsUpdated: async ({ changedKeys }) => {
      if (
        changedKeys.some((key) => String(key).startsWith('ai.image.')) &&
        imageRuntimeSettingsResolver &&
        typeof imageRuntimeSettingsResolver.invalidate === 'function'
      ) {
        imageRuntimeSettingsResolver.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.image.prompt_refiner.')) &&
        imagePromptRefinerService &&
        typeof imagePromptRefinerService.invalidate === 'function'
      ) {
        imagePromptRefinerService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.vision.')) &&
        imageUnderstandingService &&
        typeof imageUnderstandingService.invalidate === 'function'
      ) {
        imageUnderstandingService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.intent_router.')) &&
        intentRouterService &&
        typeof intentRouterService.invalidate === 'function'
      ) {
        intentRouterService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.conversation_memory.')) &&
        conversationMemoryWriterService &&
        typeof conversationMemoryWriterService.invalidate === 'function'
      ) {
        conversationMemoryWriterService.invalidate();
      }
    }
  });
  const settingsRouter = createAdminSettingsRouter({
    settingsService,
    requireAdminAuth
  });
  const intentRouterAdminRouter = createIntentRouterAdminRouter({
    intentRouterService,
    settingsRepository: repositories.settings,
    requireAdminAuth,
    appendAudit
  });
  const conversationMemoryAdminRouter = createConversationMemoryAdminRouter({
    requireAdminAuth,
    conversationMemoryService,
    conversationsRepository: repositories.conversations,
    chatMessagesRepository: repositories.chatMessages
  });

  router.use(analyticsRouter);
  router.use(systemRouter);
  router.use(conversationMemoryAdminRouter);
  router.use(intentRouterAdminRouter);
  router.use(settingsRouter);
  router.use(logsRouter);

  return {
    router,
    requireAdminAuth,
    ensureAdminData,
    ensureConfigData
  };
}

function createAdminRouter(deps) {
  return createAdminModule(deps);
}

module.exports = {
  createAdminModule,
  createAdminRouter,
  ensureConfigData,
  ensureAdminData
};
