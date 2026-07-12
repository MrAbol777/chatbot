#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

echo "APP_LOGS"
docker compose logs --tail=160 app

echo "ENV_NAMES"
docker compose exec -T app sh -lc 'env | cut -d= -f1 | sort | grep -E "^(METIS|GEMINI|OPENAI|ADMIN|DATABASE|NODE|PORT|CONVERSATION|IMAGE)_" || true'

echo "HEALTH"
curl -fsS http://127.0.0.1:3000/api/health
echo
