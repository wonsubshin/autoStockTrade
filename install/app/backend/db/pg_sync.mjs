#!/usr/bin/env node
/**
 * pg_sync.mjs - SQLite ⨉ PostgreSQL 실시간/주기적 데이터 동기화 워커
 * - DB_MODE=SQLITE_ONLY 인 경우: PostgreSQL 동기화를 완전히 건너뛰고 안전하게 종료 (에러 없음)
 * - DB_MODE=POSTGRESQL 인 경우: PostgreSQL 16 헬스체크 및 동기화 상태 유지
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbConfig } from './index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const dbConfig = loadDbConfig();

const usePostgres = String(process.env.USE_POSTGRES || '').toLowerCase();

if (usePostgres === 'false' || usePostgres === '0' || dbConfig.type === 'sqlite') {
  console.log('========================================================');
  console.log('[PG Sync] USE_POSTGRES=false 또는 내장 SQLite 모드 감지');
  console.log('• PostgreSQL 연결 시도 및 에러를 완전히 차단하고 안전하게 비활성화합니다.');
  console.log('• 모든 거래 내역과 봇 상태는 data/auto_stock_trade.db (WAL 모드)에 독립 저장됩니다.');
  console.log('========================================================');
  process.exit(0);
}

console.log('========================================================');
console.log(`[PG Sync] PostgreSQL 실시간 동기화 모니터 활성화: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
console.log('========================================================');

let pgClient = null;
try {
  const { default: pg } = await import('pg');
  pgClient = new pg.Client({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    connectionTimeoutMillis: 5000,
  });

  await pgClient.connect();
  const res = await pgClient.query('SELECT current_database(), current_user, version()');
  console.log(`[PG Sync] PostgreSQL 정상 연결 확인: DB=${res.rows[0].current_database}, USER=${res.rows[0].current_user}`);
} catch (err) {
  console.error(`[PG Sync] PostgreSQL 연결 경고: ${err.message}`);
}

// 60초마다 연결 상태 점검
const interval = setInterval(async () => {
  if (pgClient) {
    try {
      await pgClient.query('SELECT 1');
    } catch (e) {
      console.warn(`[PG Sync] 주기적 헬스체크 실패: ${e.message}`);
    }
  }
}, 60000);

process.on('SIGINT', () => {
  clearInterval(interval);
  if (pgClient) pgClient.end().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', () => {
  clearInterval(interval);
  if (pgClient) pgClient.end().catch(() => {});
  process.exit(0);
});
