# Multi-stage Dockerfile for autoStockTrader

# 1. Base Node & Python environment
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Frontend Builder
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# 3. Backend service
FROM base AS backend
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY backend ./backend
COPY config ./config
RUN mkdir -p data logs
ENV PORT=8100
ENV USE_POSTGRES=false
ENV DB_MODE=SQLITE_ONLY
EXPOSE 8100
CMD ["node", "backend/node_server.mjs"]

# 4. Frontend service (using embedded lightweight reverse-proxy server)
FROM base AS frontend
WORKDIR /app
COPY install/app/frontend_server.mjs ./frontend_server.mjs
COPY --from=frontend-builder /app/frontend/dist ./frontend_dist
ENV FRONTEND_PORT=9900
ENV BACKEND_HOST=backend
ENV PORT=8100
EXPOSE 9900
CMD ["node", "frontend_server.mjs"]
