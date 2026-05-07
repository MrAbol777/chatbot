#!/bin/sh
set -eu

echo "[BOOT] starting backend on 0.0.0.0:${PORT:-3000}"
exec node /app/backend/src/server.js
