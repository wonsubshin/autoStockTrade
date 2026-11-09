import http from 'node:http';
import { PORT } from './config/env.mjs';
import { initDatabase, getDb, closeDatabase } from './db/index.mjs';
import { NewsService } from './common/news_service.mjs';
import { schedulerService } from './services/scheduler_service.mjs';
import { Router } from './routes/router.mjs';

// 1. Initialize PostgreSQL Database
initDatabase();

// 2. Initialize Services
const newsService = new NewsService(getDb);

newsService.start();
schedulerService.start();

// 3. Initialize Router & HTTP Server
const router = new Router({ newsService });

const server = http.createServer(async (req, res) => {
  await router.handleRequest(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const db = getDb();
  console.log(`========================================================`);
  console.log(`[Backend] 키움증권(시세조회) ⨉ 토스증권(주문체결) AI 퀀트 시스템 가동`);
  console.log(`• Listening: http://0.0.0.0:${PORT}`);
  console.log(`• Node Version: ${process.version}`);
  console.log(`• Database: PostgreSQL 16 (${db.dbConfig.user}@${db.dbConfig.host}:${db.dbConfig.port}/${db.dbConfig.database})`);
  console.log(`========================================================`);
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`[Backend] ${signal} 수신, 안전하게 종료 중...`);
  schedulerService.stop();
  newsService.stop();
  closeDatabase();
  server.close(() => {
    console.log('[Backend] 서버 정상 종료 완료');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
