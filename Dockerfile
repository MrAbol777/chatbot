# syntax=docker/dockerfile:1

FROM hub.hamdocker.ir/library/node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Use internal mirrors for Alpine and npm to keep builds stable in restricted networks.
RUN sed -i 's|https\?://dl-cdn.alpinelinux.org/alpine|https://repo.hmirror.ir/apk|g' /etc/apk/repositories \
  && npm config set registry https://repo.hmirror.ir/npm/

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM hub.hamdocker.ir/library/node:20-alpine AS backend-runtime
WORKDIR /app

RUN sed -i 's|https\?://dl-cdn.alpinelinux.org/alpine|https://repo.hmirror.ir/apk|g' /etc/apk/repositories \
  && npm config set registry https://repo.hmirror.ir/npm/

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY scripts/container-start.sh /app/container-start.sh
RUN chmod +x /app/container-start.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["/app/container-start.sh"]
