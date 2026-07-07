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
  ('ai.vision.allow_pro_model', CAST('false' AS JSON), 'ai', NOW()),
  ('ai.vision.temperature', CAST('0.1' AS JSON), 'ai', NOW()),
  ('ai.vision.max_output_tokens', CAST('900' AS JSON), 'ai', NOW()),
  ('ai.vision.model_health.enabled', CAST('true' AS JSON), 'ai', NOW()),
  ('ai.vision.model_health.failure_threshold', CAST('3' AS JSON), 'ai', NOW()),
  ('ai.vision.model_health.cooldown_minutes', CAST('60' AS JSON), 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  category = VALUES(category),
  updated_at = VALUES(updated_at);
