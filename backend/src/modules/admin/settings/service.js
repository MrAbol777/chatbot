const { SETTING_DEFINITIONS } = require('../../settings/defaults');
const {
  normalizeRuntimeSettings,
  validateRuntimeSettings
} = require('../../image-generation/image-runtime-settings');
const {
  normalizeVisionSettings,
  validateVisionSettings
} = require('../../image-understanding/image-understanding-settings');
const {
  normalizeIntentRouterSettings,
  validateIntentRouterSettings
} = require('../../intent-router/intent-router.settings');
const { normalizeInputOptimizerSettings } = require('../../input-optimizer/input-optimizer.service');

function createAdminSettingsService({ settingsRepository, appendAudit, onSettingsUpdated }) {
  const getSettings = async () => {
    const settings = await settingsRepository.getAll();
    return {
      settings,
      definitions: SETTING_DEFINITIONS
    };
  };

  const updateSettings = async ({ body, admin }) => {
    const incoming = body?.settings && typeof body.settings === 'object' ? body.settings : body;
    if (!incoming || typeof incoming !== 'object') {
      return { statusCode: 400, body: { error: 'تنظیمات معتبر ارسال نشده است.' } };
    }

    try {
      const before = await settingsRepository.getAll();
      if (Object.keys(incoming).some((key) => key.startsWith('ai.image.'))) {
        const runtimeSettings = normalizeRuntimeSettings({
          settings: { ...before, ...incoming },
          stored: incoming
        });
        validateRuntimeSettings(runtimeSettings);
      }
      if (Object.keys(incoming).some((key) => key.startsWith('ai.vision.'))) {
        const visionSettings = normalizeVisionSettings({
          settings: { ...before, ...incoming }
        });
        validateVisionSettings(visionSettings);
      }
      if (Object.keys(incoming).some((key) => key.startsWith('ai.intent_router.'))) {
        const intentRouterSettings = normalizeIntentRouterSettings({
          settings: { ...before, ...incoming }
        });
        validateIntentRouterSettings(intentRouterSettings);
      }
      if (Object.keys(incoming).some((key) => key.startsWith('input_optimizer.'))) {
        const optimizerSettings = normalizeInputOptimizerSettings({ settings: { ...before, ...incoming } });
        if (!optimizerSettings.model || optimizerSettings.maxRetries > 1) throw new Error('تنظیمات Input Optimizer معتبر نیست.');
      }
      const result = await settingsRepository.updateMany(incoming);
      const changedKeys = Object.keys(result.updated);
      if (typeof onSettingsUpdated === 'function') {
        await onSettingsUpdated({ changedKeys, updated: result.updated });
      }

      await appendAudit({
        adminUsername: admin?.username,
        action: 'update_site_settings',
        target: 'settings',
        details: {
          changedKeys,
          before: Object.fromEntries(changedKeys.map((key) => [key, before[key]])),
          after: result.updated
        }
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          settings: result.settings,
          definitions: SETTING_DEFINITIONS
        }
      };
    } catch (error) {
      return {
        statusCode: 400,
        body: {
          error: error instanceof Error ? error.message : 'ذخیره تنظیمات ناموفق بود.'
        }
      };
    }
  };

  return {
    getSettings,
    updateSettings
  };
}

module.exports = { createAdminSettingsService };
