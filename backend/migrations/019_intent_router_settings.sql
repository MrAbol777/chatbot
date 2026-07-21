INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
VALUES
  ('ai.intent_router.enabled', 'true', 'ai', NOW()),
  ('ai.intent_router.provider', JSON_QUOTE('metis'), 'ai', NOW()),
  ('ai.intent_router.model', JSON_QUOTE('gemini-2.5-flash-lite-preview'), 'ai', NOW()),
  ('ai.intent_router.fallback_model', JSON_QUOTE('gemini-2.5-flash'), 'ai', NOW()),
  ('ai.intent_router.experimental_model', JSON_QUOTE('gemini-2.5-flash-lite-preview'), 'ai', NOW()),
  ('ai.intent_router.temperature', '0', 'ai', NOW()),
  ('ai.intent_router.max_output_tokens', '120', 'ai', NOW()),
  ('ai.intent_router.timeout_ms', '2500', 'ai', NOW()),
  ('ai.intent_router.confidence_threshold', '0.65', 'ai', NOW()),
  ('ai.intent_router.fallback_to_heuristic', 'true', 'ai', NOW()),
  ('ai.intent_router.allow_model_fallback', 'true', 'ai', NOW()),
  ('ai.intent_router.allow_chat_key_fallback', 'false', 'ai', NOW()),
  ('ai.intent_router.store_metadata', 'true', 'ai', NOW()),
  ('ai.intent_router.model_health.enabled', 'true', 'ai', NOW()),
  ('ai.intent_router.model_health.failure_threshold', '3', 'ai', NOW()),
  ('ai.intent_router.model_health.cooldown_minutes', '60', 'ai', NOW())
ON DUPLICATE KEY UPDATE
  setting_value = setting_value,
  updated_at = updated_at;
