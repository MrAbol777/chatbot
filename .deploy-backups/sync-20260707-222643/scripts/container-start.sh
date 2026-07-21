#!/bin/sh
set -eu

FRONTEND_DIST_DIR="${FRONTEND_DIST_DIR:-/app/frontend/dist}"

if [ ! -f "${FRONTEND_DIST_DIR}/index.html" ]; then
  echo "[BOOT] frontend build output not found at ${FRONTEND_DIST_DIR}/index.html"
  exit 1
fi

echo "[BOOT] frontend static files found at ${FRONTEND_DIST_DIR}"
echo "[BOOT] starting backend (serves frontend + api) on 0.0.0.0:${PORT:-3000}"
exec node /app/backend/src/server.js
