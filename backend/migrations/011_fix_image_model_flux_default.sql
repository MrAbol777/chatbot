INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
SELECT 'ai.image.model', JSON_QUOTE('gemini-3-pro-image'), 'ai', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE setting_key = 'ai.image.model'
);

UPDATE app_settings
SET setting_value = JSON_QUOTE('gemini-3-pro-image'),
    updated_at = NOW()
WHERE setting_key = 'ai.image.model'
  AND (
    setting_value IS NULL
    OR JSON_UNQUOTE(setting_value) IS NULL
    OR TRIM(JSON_UNQUOTE(setting_value)) = ''
    OR LOWER(JSON_UNQUOTE(setting_value)) IN (
      'flux-schnell',
      'flux-pro',
      'flux-kontext-max',
      'flux-kontext-pro',
      'gemini-2.5-flash-image',
      'nano-banana'
    )
  );
