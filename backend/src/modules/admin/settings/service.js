const { SETTING_DEFINITIONS } = require('../../settings/defaults');

function createAdminSettingsService({ settingsRepository, appendAudit }) {
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
      const result = await settingsRepository.updateMany(incoming);
      const changedKeys = Object.keys(result.updated);

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
