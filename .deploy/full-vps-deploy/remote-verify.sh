#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

echo "APP_HEALTH_STATUS"
docker inspect -f '{{.State.Health.Status}}' chatbot-app

echo "LOCAL_HEALTH"
curl -fsS http://127.0.0.1:3000/healthz
echo

echo "DOMAIN_HEALTH"
curl -fsS https://www.danoa.ir/healthz
echo

echo "INTENT_ROUTER_LOAD"
docker compose exec -T app node -e "const s=require('./backend/src/modules/intent-router/intent-router.settings'); console.log(s.INTENT_ROUTER_ALLOWED_INTENTS.join(','));"

echo "CONVERSATION_MEMORY_STORAGE"
test -d data/conversation-memory
docker compose exec -T app test -d /var/lib/danoa/conversation-memory
echo "conversation-memory-storage-ok"

echo "COMPOSE_PS"
docker compose ps
