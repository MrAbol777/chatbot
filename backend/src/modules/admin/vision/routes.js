const express = require('express');
const multer = require('multer');
const {
  normalizeVisionSettings,
  validateVisionSettings,
  visionSettingKey,
  visionSettingsPayloadToSettings
} = require('../../image-understanding/image-understanding-settings');

function createAdminVisionRouter({
  requireAdminAuth,
  imageUnderstandingService,
  repositories,
  runtimeConfig,
  appendAudit
}) {
  const router = express.Router();
  const adminVisionUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1
    }
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

  return router;
}

module.exports = { createAdminVisionRouter };
