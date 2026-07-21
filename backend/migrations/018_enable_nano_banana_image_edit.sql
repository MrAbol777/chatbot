INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES ('ai.image.edit_enabled', 'true', 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = CASE
    WHEN EXISTS (
      SELECT 1
      FROM (
        SELECT setting_key, JSON_UNQUOTE(setting_value) AS setting_value
        FROM app_settings
        WHERE setting_key IN (
          'ai.image.model_preset',
          'ai.image.model.runtime_model',
          'ai.image.model',
          'ai.image.model.admin_value'
        )
      ) AS image_model_settings
      WHERE image_model_settings.setting_value IN (
        'nano-banana',
        'nano-banana-pro',
        'gemini-2.5-flash-image',
        'gemini-3-pro-image'
      )
    )
    THEN 'true'
    ELSE app_settings.setting_value
  END,
  updated_at = CASE
    WHEN EXISTS (
      SELECT 1
      FROM (
        SELECT setting_key, JSON_UNQUOTE(setting_value) AS setting_value
        FROM app_settings
        WHERE setting_key IN (
          'ai.image.model_preset',
          'ai.image.model.runtime_model',
          'ai.image.model',
          'ai.image.model.admin_value'
        )
      ) AS image_model_settings
      WHERE image_model_settings.setting_value IN (
        'nano-banana',
        'nano-banana-pro',
        'gemini-2.5-flash-image',
        'gemini-3-pro-image'
      )
    )
    THEN NOW()
    ELSE app_settings.updated_at
  END;
