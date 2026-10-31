import http from 'node:http';
import { PORT, DB_PATH, PROJECT_ROOT } from './config/env.mjs';
import { initDatabase, getDb } from './db/index.mjs';
import { NewsService } from './common/news_service.mjs';
import { PgSyncManager } from './common/pg_sync.mjs';
import { schedulerService } from './services/scheduler_service.mjs';
import { Router } from './routes/router.mjs';

// 1. Initialize SQLite Database
initDatabase();

// 2. Initialize Services
const newsService = new NewsService(getDb);
const pgSyncManager = new PgSyncManager(PROJECT_ROOT, getDb);

newsService.start();
pgSyncManager.start();
schedulerService.start();

// 3. Initialize Router & HTTP Server
const router = new Router({ pgSyncManager, newsService });

const server = http.createServer(async (req, res) => {
  await router.handleRequest(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`[Backend] 키움증권(시세조회) ⨉ 토스증권(주문체결) AI 퀀트 시스템 가동`);
  console.log(`• Listening: http://0.0.0.0:${PORT}`);
  console.log(`• Node Version: ${process.version}`);
  console.log(`• SQLite Database: ${DB_PATH} (WAL Mode)`);
  console.log(`• Dual DB Sync: PostgreSQL ${pgSyncManager.config.location.toUpperCase()} (${pgSyncManager.config.host}:${pgSyncManager.config.port})`);
  console.log(`========================================================`);
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`[Backend] ${signal} 수신, 안전하게 종료 중...`);
  schedulerService.stop();
  newsService.stop();
  pgSyncManager.stop();
  server.close(() => {
    console.log('[Backend] 서버 정상 종료 완료');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
