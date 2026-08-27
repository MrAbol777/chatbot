#!/usr/bin/env bash
# Production application deploy for danoa.ir.
# TLS/Nginx bootstrap is documented in docs/danoa-vps-video-deployment.md.

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/chatbot}"
APP_PORT="${APP_PORT:-3000}"
ENV_FILE="$PROJECT_DIR/.env"

log() { printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "$1"; }
fail() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Follow the VPS runbook first."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed."
[ -d "$PROJECT_DIR" ] || fail "Project directory not found: $PROJECT_DIR"
[ -f "$ENV_FILE" ] || fail "Create $ENV_FILE from deploy/env.production.example first."

if grep -q 'CHANGE_ME' "$ENV_FILE"; then
  fail "$ENV_FILE still contains CHANGE_ME placeholders."
fi

for name in DATABASE_URL MYSQL_PASSWORD MYSQL_ROOT_PASSWORD AUTH_JWT_SECRET ADMIN_JWT_SECRET BANANAAI_API_KEY VIDEO_PROVIDER_INPUT_SIGNING_SECRET; do
  grep -Eq "^${name}=.+" "$ENV_FILE" || fail "$name is missing from $ENV_FILE"
done

cd "$PROJECT_DIR"
install -d -m 700 data/generated-images data/conversation-memory

log "Validating Docker Compose configuration"
docker compose config --quiet

log "Building the application image"
docker compose build app

log "Starting MariaDB"
docker compose up -d mysql
for _ in $(seq 1 30); do
  if docker compose exec -T mysql healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then break; fi
  sleep 2
done
docker compose exec -T mysql healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 || fail "MariaDB did not become ready."

log "Replacing unavailable AI preview model settings"
docker compose run --rm --no-deps --entrypoint npm app --prefix backend run db:migrate-ai-runtime

log "Applying additive video migrations"
docker compose run --rm --no-deps --entrypoint npm app --prefix backend run db:migrate-video-generation

log "Archiving legacy billing and migrating active subscriptions to Noa"
docker compose run --rm --no-deps --entrypoint npm app --prefix backend run db:migrate-noa

log "Applying image-to-image migration"
docker compose run --rm --no-deps --entrypoint npm app --prefix backend run db:migrate-image-to-image

log "Activating the BananaAI Grok image-to-video route"
docker compose run --rm --no-deps --entrypoint npm app --prefix backend run admin:activate-bananaai-video

log "Starting the application and embedded workers"
docker compose up -d app

log "Waiting for the local health endpoint"
for _ in $(seq 1 30); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/healthz" || true)"
  [ "$code" = "200" ] && break
  sleep 2
done
[ "${code:-000}" = "200" ] || fail "Local health check failed with HTTP ${code:-000}."

log "Running zero-network video readiness checks"
docker compose exec -T app npm --prefix backend run check:video-generation-readiness

log "Deployment completed"
docker compose ps
printf '\nLocal health: http://127.0.0.1:%s/healthz\n' "$APP_PORT"
printf 'Public health: https://danoa.ir/healthz\n'
