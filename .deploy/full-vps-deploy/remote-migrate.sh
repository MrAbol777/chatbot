#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

for file in \
  backend/migrations/018_enable_nano_banana_image_edit.sql \
  backend/migrations/019_intent_router_settings.sql \
  backend/migrations/020_conversation_document_memory.sql
do
  echo "applying:$file"
  docker compose exec -T mysql mariadb -uroot chatbot < "$file"
done

docker compose exec -T mysql mariadb -uroot chatbot -e "
SHOW TABLES LIKE 'conversation_document%';
SELECT setting_key
FROM app_settings
WHERE setting_key IN (
  'ai.intent_router.enabled',
  'ai.conversation_memory.enabled',
  'ai.conversation_memory.writer_enabled'
)
ORDER BY setting_key;
"
