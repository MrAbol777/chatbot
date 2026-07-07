INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.image.provider', '"metis"', 'ai', NOW()),
  ('ai.image.base_url', '"https://api.metisai.ir"', 'ai', NOW()),
  ('ai.image.resolution', '"1K"', 'ai', NOW()),
  ('ai.image.aspect_ratio', '"1:1"', 'ai', NOW()),
  ('ai.image.output_format', '"jpg"', 'ai', NOW()),
  ('ai.image.safety_filter_level', '"block_only_high"', 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = setting_value,
  updated_at = updated_at;

UPDATE app_settings
SET setting_value = '"gemini-3-pro-image"',
    updated_at = NOW()
WHERE setting_key = 'ai.image.model'
  AND setting_value IN ('"gemini-2.5-flash-image"', '"nano-banana"', 'null', '');
