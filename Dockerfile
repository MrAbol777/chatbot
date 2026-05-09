FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-runtime
WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY scripts/container-start.sh /app/container-start.sh
RUN chmod +x /app/container-start.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV FRONTEND_DIST_DIR=/app/frontend/dist

EXPOSE 3000

ENTRYPOINT ["/app/container-start.sh"]
