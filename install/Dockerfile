FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY app/package*.json ./
RUN npm install --omit=dev
COPY app/backend ./backend
COPY app/config ./config
COPY app/frontend_server.mjs ./frontend_server.mjs
COPY app/frontend_dist ./frontend_dist
RUN mkdir -p data logs

FROM base AS backend
ENV PORT=8100
ENV USE_POSTGRES=false
ENV DB_MODE=SQLITE_ONLY
EXPOSE 8100
CMD ["node", "backend/node_server.mjs"]

FROM base AS frontend
ENV FRONTEND_PORT=9900
ENV BACKEND_HOST=backend
ENV PORT=8100
EXPOSE 9900
CMD ["node", "frontend_server.mjs"]
