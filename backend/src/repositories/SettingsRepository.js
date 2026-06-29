const {
  DEFAULT_SETTINGS,
  SETTING_DEFINITIONS,
  coerceSettingValue,
  getDefaultSetting
} = require('../modules/settings/defaults');

class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  async getAll() {
    await this.db.init();
    const [rows] = await this.db.query('SELECT setting_key, setting_value FROM app_settings');
    const values = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      const key = row.setting_key;
      if (!SETTING_DEFINITIONS[key]) continue;
      try {
        const rawValue =
          typeof row.setting_value === 'string'
            ? JSON.parse(row.setting_value)
            : row.setting_value;
        values[key] = coerceSettingValue(key, rawValue);
      } catch (_error) {
        values[key] = getDefaultSetting(key);
      }
    }

    return values;
  }

  async get(key) {
    const settings = await this.getAll();
    return settings[key] ?? getDefaultSetting(key);
  }

  async updateMany(input = {}) {
    await this.db.init();
    const entries = Object.entries(input)
      .filter(([key]) => SETTING_DEFINITIONS[key]?.adminEditable)
      .map(([key, value]) => [key, coerceSettingValue(key, value)]);

    const nextSettings = {};
    const timestamp = new Date();
    for (const [key, value] of entries) {
      const category = SETTING_DEFINITIONS[key].category;
      await this.db.query(
        `INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), category = VALUES(category), updated_at = VALUES(updated_at)`,
        [key, JSON.stringify(value), category, timestamp]
      );
      nextSettings[key] = value;
    }

    return {
      updated: nextSettings,
      settings: await this.getAll()
    };
  }
}

module.exports = { SettingsRepository };
