ARG NODE_IMAGE=registry.hamdocker.ir/library/node:20-alpine
FROM ${NODE_IMAGE} AS frontend-builder
WORKDIR /app/frontend

ARG NPM_REGISTRY=https://repo.hmirror.ir/npm/
ARG APK_MIRROR=https://repo.hmirror.ir/apk/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
ENV npm_config_audit=false
ENV npm_config_fund=false
ENV npm_config_update_notifier=false

RUN sed -i "s|dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g" /etc/apk/repositories
RUN npm config set registry ${NPM_REGISTRY} \
  && npm config set replace-registry-host always \
  && npm config set fund false \
  && npm config set audit false

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund --registry=${NPM_REGISTRY}

COPY frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS backend-runtime
WORKDIR /app

ARG NPM_REGISTRY=https://repo.hmirror.ir/npm/
ARG APK_MIRROR=https://repo.hmirror.ir/apk/
ARG ENABLE_SYSTEM_PROMPT_EDIT=true
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
ENV npm_config_audit=false
ENV npm_config_fund=false
ENV npm_config_update_notifier=false

RUN sed -i "s|dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g" /etc/apk/repositories
RUN npm config set registry ${NPM_REGISTRY} \
  && npm config set replace-registry-host always \
  && npm config set fund false \
  && npm config set audit false

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund --registry=${NPM_REGISTRY}

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
