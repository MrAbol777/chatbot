#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

docker compose exec -T mysql mariadb -uroot chatbot -e "
SELECT id, error_type, endpoint, status_code, LEFT(details, 1200) AS details, created_at
FROM app_app_errors
WHERE endpoint = '/api/chat'
ORDER BY id DESC
LIMIT 10;
"
