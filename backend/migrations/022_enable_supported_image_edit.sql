-- Nano Banana and Gemini image presets support image_input editing.
UPDATE app_settings
SET setting_value = 'true', updated_at = NOW()
WHERE setting_key = 'ai.image.edit_enabled'
  AND EXISTS (
    SELECT 1 FROM (
      SELECT JSON_UNQUOTE(setting_value) AS model_value
      FROM app_settings
      WHERE setting_key IN (
        'ai.image.model_preset',
        'ai.image.model.runtime_model',
        'ai.image.model',
        'ai.image.model.admin_value'
      )
    ) AS supported_models
    WHERE supported_models.model_value IN (
      'nano-banana',
      'nano-banana-pro',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image'
    )
  );
