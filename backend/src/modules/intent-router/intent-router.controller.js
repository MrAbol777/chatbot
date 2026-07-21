const {
  intentRouterSettingsPayloadToSettings,
  intentRouterSettingKey,
  normalizeIntentRouterSettings,
  validateIntentRouterSettings
} = require('./intent-router.settings');

function createIntentRouterController({
  intentRouterService,
  settingsRepository,
  appendAudit
}) {
  const getSettings = async (_req, res) => {
    const settings = await intentRouterService.getSettings({ force: true });
    return res.json({ settings, settingKeys: intentRouterSettingKey });
  };

  const updateSettings = async (req, res) => {
    try {
      const incoming = intentRouterSettingsPayloadToSettings(req.body);
      const current = settingsRepository && typeof settingsRepository.getAll === 'function'
        ? await settingsRepository.getAll()
        : {};
      const next = normalizeIntentRouterSettings({ settings: { ...current, ...incoming } });
      validateIntentRouterSettings(next);
      const result = await settingsRepository.updateMany(incoming);
      if (intentRouterService && typeof intentRouterService.invalidate === 'function') {
        intentRouterService.invalidate();
      }
      if (typeof appendAudit === 'function') {
        await appendAudit({
          adminUsername: req.admin?.username,
          action: 'update_intent_router_settings',
          target: 'intent_router',
          details: { changedKeys: Object.keys(incoming) }
        });
      }
      return res.json({
        success: true,
        settings: await intentRouterService.getSettings({ force: true }),
        siteSettings: result.settings
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'ذخیره تنظیمات intent-router ناموفق بود.' });
    }
  };

  const testDryRun = async (req, res) => {
    try {
      const userMessage = String(req.body?.userMessage || req.body?.prompt || '').trim();
      const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
      const result = await intentRouterService.testDryRun({
        userMessage,
        context,
        settings: req.body?.settings
      });
      return res.json({
        success: true,
        route: result.route,
        ok: result.ok,
        status: result.status,
        input: result.input,
        metadata: result.metadata
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Dry-run intent-router ناموفق بود.' });
    }
  };

  const modelProbe = async (req, res) => {
    try {
      const result = await intentRouterService.modelProbe({ settings: req.body?.settings });
      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Model probe intent-router ناموفق بود.' });
    }
  };

  return {
    getSettings,
    updateSettings,
    testDryRun,
    modelProbe
  };
}

module.exports = { createIntentRouterController };
