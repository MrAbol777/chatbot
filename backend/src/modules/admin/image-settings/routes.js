const express = require('express');
const {
  IMAGE_MODEL_PRESETS,
  buildMetisRequestBody,
  imageSettingsPayloadToSettings,
  normalizeRuntimeSettings,
  settingKey,
  validateRuntimeSettings
} = require('../../image-generation/image-runtime-settings');
const { buildFinalImagePrompt } = require('../../image-generation/image-generation.controller');
const {
  normalizePromptRefinerSettings,
  promptRefinerSettingKey
} = require('../../image-generation/image-prompt-refiner.service');

function createAdminImageSettingsRouter({
  requireAdminAuth,
  imageRuntimeSettingsResolver,
  imagePromptRefinerService,
  imageGenerationService,
  repositories,
  runtimeConfig,
  appendAudit
}) {
  const router = express.Router();

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

  return router;
}

module.exports = { createAdminImageSettingsRouter };
