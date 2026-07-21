SET NAMES utf8mb4;

INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.vision.model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.default_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.fast_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.experimental_model', JSON_QUOTE('gemini-2.5-flash-lite-preview'), 'ai', NOW()),
  ('ai.vision.quality_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.pro_model', JSON_QUOTE('gemini-2.5-pro'), 'ai', NOW()),
  ('ai.vision.mode', JSON_QUOTE('balanced'), 'ai', NOW()),
  ('ai.vision.allow_pro_model', 'false', 'ai', NOW()),
  ('ai.vision.media_resolution', JSON_QUOTE('auto'), 'ai', NOW()),
  ('ai.vision.temperature', '0.1', 'ai', NOW()),
  ('ai.vision.max_output_tokens', '900', 'ai', NOW()),
  ('ai.vision.model_health.enabled', 'true', 'ai', NOW()),
  ('ai.vision.model_health.failure_threshold', '3', 'ai', NOW()),
  ('ai.vision.model_health.cooldown_minutes', '60', 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  category = VALUES(category),
  updated_at = VALUES(updated_at);
