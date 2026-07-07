SET NAMES utf8mb4;

INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.vision.enabled', 'true', 'ai', NOW()),
  ('ai.vision.provider', JSON_QUOTE('metis-gemini'), 'ai', NOW()),
  ('ai.vision.model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.default_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.fast_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.experimental_model', JSON_QUOTE('gemini-2.5-flash-lite-preview'), 'ai', NOW()),
  ('ai.vision.quality_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.vision.pro_model', JSON_QUOTE('gemini-2.5-pro'), 'ai', NOW()),
  ('ai.vision.mode', JSON_QUOTE('balanced'), 'ai', NOW()),
  ('ai.vision.allow_pro_model', 'false', 'ai', NOW()),
  ('ai.vision.timeout_ms', '30000', 'ai', NOW()),
  ('ai.vision.fallback_timeout_ms', '45000', 'ai', NOW()),
  ('ai.vision.max_image_mb', '10', 'ai', NOW()),
  ('ai.vision.transport', JSON_QUOTE('auto'), 'ai', NOW()),
  ('ai.vision.media_resolution', JSON_QUOTE('auto'), 'ai', NOW()),
  ('ai.vision.temperature', '0.1', 'ai', NOW()),
  ('ai.vision.max_output_tokens', '900', 'ai', NOW()),
  ('ai.vision.system_prompt', JSON_QUOTE('You are a professional image understanding engine for a Persian child-friendly AI product.\n\nAnalyze the provided image accurately. Do not guess beyond visible evidence. If something is uncertain, say it is uncertain.\n\nReturn the answer in Persian unless the user asks otherwise.\n\nFocus on:\n1. Main subjects and objects\n2. Scene and context\n3. Visible text, if any\n4. Colors, style, composition\n5. Important details\n6. Safety/age-appropriateness if relevant\n\nIf the user asks to read text, prioritize OCR-like accuracy.\nIf the image is blurry, rotated, cropped, too small, or unreadable, say so clearly.\nDo not hallucinate.\nDo not identify real people by name.\nKeep the answer age-appropriate and helpful.'), 'ai', NOW()),
  ('ai.vision.ocr_prompt', JSON_QUOTE('Read all visible text in the image exactly as written. Preserve Persian text exactly. If text is unclear, mark it as unclear instead of guessing.'), 'ai', NOW()),
  ('ai.vision.design_analysis_prompt', JSON_QUOTE('Analyze this design visually. Comment on layout, colors, readability, hierarchy, spacing, and what could be improved. Be concise and practical.'), 'ai', NOW()),
  ('ai.vision.product_prompt', JSON_QUOTE('Describe the product, visible features, color, material, condition, and any readable text. Do not invent brand/model if it is not visible.'), 'ai', NOW()),
  ('ai.vision.allow_chat_key_fallback', 'false', 'ai', NOW()),
  ('ai.vision.store_metadata', 'true', 'ai', NOW()),
  ('ai.vision.base_url', JSON_QUOTE('https://api.metisai.ir'), 'ai', NOW()),
  ('ai.vision.model_health.enabled', 'true', 'ai', NOW()),
  ('ai.vision.model_health.failure_threshold', '3', 'ai', NOW()),
  ('ai.vision.model_health.cooldown_minutes', '60', 'ai', NOW())
ON DUPLICATE KEY UPDATE setting_key = setting_key;
