-- The preview model returned HTTP 404 on the Metis generateContent endpoint.
-- Update only the known obsolete value so explicit administrator choices remain untouched.
UPDATE app_settings
SET setting_value = JSON_QUOTE('gemini-2.5-flash'),
    updated_at = NOW()
WHERE setting_key IN (
  'ai.intent_router.model',
  'ai.intent_router.experimental_model',
  'ai.conversation_memory.model'
)
  AND JSON_UNQUOTE(setting_value) = 'gemini-2.5-flash-lite-preview';
