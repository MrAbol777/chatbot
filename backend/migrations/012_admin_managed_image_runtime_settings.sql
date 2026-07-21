INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.image.enabled', 'true', 'ai', NOW()),
  ('ai.image.model_preset', JSON_QUOTE('nano-banana'), 'ai', NOW()),
  ('ai.image.model.admin_value', JSON_QUOTE('gemini-2.5-flash-image'), 'ai', NOW()),
  ('ai.image.model.runtime_provider_name', JSON_QUOTE('google'), 'ai', NOW()),
  ('ai.image.model.runtime_model', JSON_QUOTE('nano-banana'), 'ai', NOW()),
  ('ai.image.operation', JSON_QUOTE('Imagine'), 'ai', NOW()),
  ('ai.image.prompt_enhancer_enabled', 'true', 'ai', NOW()),
  ('ai.image.default_negative_prompt', JSON_QUOTE('no humans, no unrelated objects, no text distortion, no watermark'), 'ai', NOW()),
  ('ai.image.poll_interval_ms', '2000', 'ai', NOW()),
  ('ai.image.poll_timeout_ms', '120000', 'ai', NOW()),
  ('ai.image.max_download_mb', '10', 'ai', NOW()),
  ('ai.image.edit_enabled', 'false', 'ai', NOW()),
  ('ai.image.custom_args_json', JSON_QUOTE('{}'), 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = setting_value,
  updated_at = updated_at;

UPDATE app_settings
SET setting_value = COALESCE(
      (SELECT legacy.setting_value FROM (SELECT setting_value FROM app_settings WHERE setting_key = 'ai.image.model') AS legacy),
      JSON_QUOTE('gemini-2.5-flash-image')
    ),
    updated_at = NOW()
WHERE setting_key = 'ai.image.model.admin_value'
  AND (
    JSON_UNQUOTE(setting_value) IS NULL
    OR JSON_UNQUOTE(setting_value) = ''
    OR JSON_UNQUOTE(setting_value) = 'custom'
  );
