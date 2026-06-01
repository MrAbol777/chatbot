ARG BASE_REGISTRY=hub.hamdocker.ir
ARG NODE_IMAGE=${BASE_REGISTRY}/library/node:20-alpine
ARG NPM_REGISTRY=https://repo.hmirror.ir/npm/
ARG APK_MIRROR=https://repo.hmirror.ir/apk/

FROM ${NODE_IMAGE} AS base-node
ARG NPM_REGISTRY
ARG APK_MIRROR

ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
ENV npm_config_registry=${NPM_REGISTRY}
ENV npm_config_replace_registry_host=always
ENV npm_config_audit=false
ENV npm_config_fund=false
ENV npm_config_update_notifier=false
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000

RUN set -eux; \
  ALPINE_VERSION="$(cut -d. -f1,2 /etc/alpine-release)"; \
  printf '%s\n%s\n' \
    "${APK_MIRROR}v${ALPINE_VERSION}/main" \
    "${APK_MIRROR}v${ALPINE_VERSION}/community" > /etc/apk/repositories; \
  apk add --no-cache ca-certificates wget; \
  npm config set registry "${NPM_REGISTRY}"; \
  npm config set replace-registry-host always; \
  npm config set fund false; \
    npm config set audit false; \
    npm config set fetch-retries 5; \
    npm config set fetch-retry-mintimeout 20000; \
    npm config set fetch-retry-maxtimeout 120000; \
    npm config set update-notifier false

FROM base-node AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM base-node AS backend-runtime
WORKDIR /app

ARG ENABLE_SYSTEM_PROMPT_EDIT=true

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund
RUN cd backend && npm install --no-save --no-audit --no-fund multer@1.4.5-lts.2 uuid@11.0.5

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY scripts/container-start.sh /app/container-start.sh
RUN chmod +x /app/container-start.sh
RUN test -s /app/backend/system-prompt.txt

ENV NODE_ENV=production
ENV PORT=3000
ENV FRONTEND_DIST_DIR=/app/frontend/dist
ENV DB_FILE_PATH=/tmp/hemraz-data.json
ENV ENABLE_SYSTEM_PROMPT_EDIT=${ENABLE_SYSTEM_PROMPT_EDIT}

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/app/container-start.sh"]
