INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.image.prompt_refiner.enabled', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.provider', JSON_QUOTE('metis'), 'ai', NOW()),
  ('ai.image.prompt_refiner.model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.image.prompt_refiner.temperature', '0.2', 'ai', NOW()),
  ('ai.image.prompt_refiner.max_tokens', '700', 'ai', NOW()),
  ('ai.image.prompt_refiner.timeout_ms', '6000', 'ai', NOW()),
  ('ai.image.prompt_refiner.fallback_enabled', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.cache_enabled', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.cache_ttl_minutes', '1440', 'ai', NOW()),
  ('ai.image.prompt_refiner.preserve_persian_text', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.human_subject_guard', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.child_safety_guard', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.default_style', JSON_QUOTE('clean, colorful, child-friendly digital illustration, soft lighting, high quality'), 'ai', NOW()),
  ('ai.image.prompt_refiner.default_negative_prompt', JSON_QUOTE('no watermark, no distorted text, no extra fingers, no blurry face, no unrelated objects'), 'ai', NOW()),
  ('ai.image.prompt_refiner.system_prompt', JSON_QUOTE('You are an image prompt refinement engine for a Persian child-friendly AI product. Return only valid JSON matching the requested schema. Preserve the main subject, keep Persian text inside the image unchanged, and enforce child-safe rules.'), 'ai', NOW()),
  ('ai.image.prompt_refiner.store_metadata', 'true', 'ai', NOW()),
  ('ai.image.prompt_refiner.allow_chat_key_fallback', 'false', 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = setting_value,
  updated_at = updated_at;
