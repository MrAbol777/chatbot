#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

curl -sS -i \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:3000/api/chat \
  --data '{"message":"سلام","profile":{"id":"diagnostic-guest","name":"Diagnostic","age":10},"history":[],"conversationId":"diagnostic-conversation"}'
echo
