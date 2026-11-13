import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { PROJECT_ROOT } from '../config/env.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

// Tables with SERIAL id that should return id on INSERT
const TABLES_WITH_SERIAL_ID = new Set([
  'trades',
  'bot_positions',
  'virtual_performance_logs',
  'ai_market_briefings',
  'stock_news',
  'ai_news_briefings',
  'ai_trade_decisions'
]);

export function loadDbConfig() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        env[k] = v;
      }
    }
  }

  const dbMode = (process.env.DB_MODE || env.DB_MODE || '').toUpperCase();
  const usePostgresEnv = String(process.env.USE_POSTGRES || env.USE_POSTGRES || '').toLowerCase();

  // 4.2 USE_POSTGRES=false 또는 DB_MODE=SQLITE_ONLY 시 SQLite 단독 모드로 완전 격리
  if (usePostgresEnv === 'false' || usePostgresEnv === '0' || dbMode === 'SQLITE_ONLY' || dbMode === 'SQLITE') {
    return {
      type: 'sqlite',
      filePath: path.join(PROJECT_ROOT, 'data', 'auto_stock_trade.db')
    };
  }

  const location = (env.LOCATION || 'local').toLowerCase();
  if (location === 'outer') {
    return {
      type: 'postgres',
      location: 'outer',
      host: env.OUTER_PG_HOST || '',
      port: parseInt(env.OUTER_PG_PORT || env.PGPORT || '5432', 10),
      database: env.OUTER_PG_DATABASE || 'stock',
      user: env.OUTER_PG_USER || 'stock_trader',
      password: env.OUTER_PG_PASSWORD || '',
    };
  }

  // If DB_MODE is POSTGRESQL or explicit PG config
  if (dbMode === 'POSTGRESQL' || dbMode === 'POSTGRES' || env.LOCAL_PG_PASSWORD) {
    return {
      type: 'postgres',
      location: 'local',
      host: env.LOCAL_PG_HOST || '127.0.0.1',
      port: parseInt(env.LOCAL_PG_PORT || env.PGPORT || '5432', 10),
      database: env.LOCAL_PG_DATABASE || 'stock',
      user: env.LOCAL_PG_USER || 'stock_trader',
      password: env.LOCAL_PG_PASSWORD || '',
    };
  }

  // Default to SQLite
  return {
    type: 'sqlite',
    filePath: path.join(PROJECT_ROOT, 'data', 'auto_stock_trade.db')
  };
}

/**
 * SQL 변환기:
 * 1) ? 플레이스홀더를 $1, $2, $3... 로 변환 (문자열 리터럴 내부 제외)
 * 2) INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING 변환
 */
function translateSql(sql) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let out = '';
  let paramIdx = 1;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" && (i === 0 || sql[i - 1] !== '\\')) {
      inSingleQuote = !inSingleQuote;
      out += char;
    } else if (char === '"' && (i === 0 || sql[i - 1] !== '\\')) {
      inDoubleQuote = !inDoubleQuote;
      out += char;
    } else if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      out += `$${paramIdx++}`;
    } else {
      out += char;
    }
  }

  // INSERT OR IGNORE INTO tbl (cols) VALUES (...) -> INSERT INTO tbl (cols) VALUES (...) ON CONFLICT DO NOTHING
  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+/gi, 'INSERT INTO ');
  return out;
}

/**
 * INSERT 문에서 대상 테이블을 추출하여 RETURNING id 지원 여부 확인
 */
function shouldAppendReturningId(sql) {
  const match = sql.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i);
  if (!match) return false;
  const tbl = match[1].toLowerCase();
  return TABLES_WITH_SERIAL_ID.has(tbl) && !/RETURNING\s+/i.test(sql);
}

class PostgresSyncAdapter {
  constructor(dbConfig) {
    this.dbConfig = dbConfig;
    this.sab = new SharedArrayBuffer(4);
    this.int32 = new Int32Array(this.sab);
    const { port1, port2 } = new MessageChannel();
    this.port1 = port1;

    const workerPath = path.join(__dirname, 'pg_worker.mjs');
    this.worker = new Worker(workerPath, {
      workerData: {
        sab: this.sab,
        port: port2,
        dbConfig: this.dbConfig,
      },
      transferList: [port2],
    });

    this.worker.on('error', (err) => {
      console.error('[DB] Worker error:', err);
    });

    // Test connection
    const testRes = this._sendSync({ type: 'query', sql: 'SELECT current_database(), current_user', params: [] });
    if (!testRes.ok) {
      throw new Error(`[DB] PostgreSQL 연결 실패: ${testRes.error}`);
    }
  }

  _sendSync(payload) {
    Atomics.store(this.int32, 0, 0);
    this.port1.postMessage(payload);
    Atomics.wait(this.int32, 0, 0);
    const res = receiveMessageOnPort(this.port1);
    if (!res || !res.message) {
      throw new Error('[DB] 워커로부터 응답을 받지 못했습니다.');
    }
    return res.message;
  }

  query(sql, params = []) {
    const res = this._sendSync({ type: 'query', sql, params });
    if (!res.ok) {
      throw new Error(`[DB Query Error] ${res.error} (SQL: ${sql})`);
    }
    return res;
  }

  exec(sql) {
    // PRAGMA 등 SQLite 전용 구문 필터링
    const lines = sql.split(';')
      .map(s => s.trim())
      .filter(s => s && !s.toUpperCase().startsWith('PRAGMA'));

    if (lines.length === 0) return;

    for (const stmt of lines) {
      const translated = translateSql(stmt);
      const res = this._sendSync({ type: 'exec', sql: translated });
      if (!res.ok) {
        // 이미 존재하는 인덱스/테이블 오류 등은 무시 가능하게 처리
        if (res.error.includes('already exists')) continue;
        throw new Error(`[DB Exec Error] ${res.error} (SQL: ${stmt})`);
      }
    }
  }

  prepare(rawSql) {
    const adapter = this;
    const isInsert = /^\s*INSERT\s+INTO\s+/i.test(rawSql);
    const needsReturning = isInsert && shouldAppendReturningId(rawSql);

    let finalSql = translateSql(rawSql);
    if (needsReturning) {
      finalSql = finalSql.trim();
      if (finalSql.endsWith(';')) finalSql = finalSql.slice(0, -1);
      finalSql += ' RETURNING id';
    }

    return {
      all(...args) {
        const flatArgs = args.flat();
        const res = adapter.query(finalSql, flatArgs);
        return res.rows;
      },
      get(...args) {
        const flatArgs = args.flat();
        const res = adapter.query(finalSql, flatArgs);
        return res.rows[0] || undefined;
      },
      run(...args) {
        const flatArgs = args.flat();
        const res = adapter.query(finalSql, flatArgs);
        let lastInsertRowid = undefined;
        if (res.rows && res.rows[0] && res.rows[0].id !== undefined) {
          lastInsertRowid = Number(res.rows[0].id);
        }
        return {
          changes: res.rowCount,
          lastInsertRowid,
        };
      },
    };
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        try { this.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }

  close() {
    this._sendSync({ type: 'close' });
    this.worker.terminate();
  }
}

export class SqliteAdapter {
  constructor(filePath) {
    this.dbPath = filePath;
    this.dbConfig = { type: 'sqlite', file: filePath };
    this._txDepth = 0;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(filePath);
      this.engine = 'node:sqlite';
    } catch (e1) {
      try {
        const BetterSqlite3 = require('better-sqlite3');
        this.db = new BetterSqlite3(filePath);
        this.engine = 'better-sqlite3';
      } catch (e2) {
        throw new Error(`[DB] SQLite 엔진 로드 실패: Node v22+ 내장 node:sqlite 또는 better-sqlite3가 필요합니다. (${e1.message})`);
      }
    }

    // Enable WAL mode
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  prepare(rawSql) {
    const translated = rawSql.replace(/\bILIKE\b/gi, 'LIKE');
    const stmt = this.db.prepare(translated);
    return {
      all(...args) {
        const flatArgs = args.flat();
        return stmt.all(...flatArgs);
      },
      get(...args) {
        const flatArgs = args.flat();
        return stmt.get(...flatArgs);
      },
      run(...args) {
        const flatArgs = args.flat();
        const res = stmt.run(...flatArgs);
        return {
          changes: res ? res.changes : 0,
          lastInsertRowid: res && res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
        };
      },
    };
  }

  exec(sql) {
    const lines = sql.split(';')
      .map(s => s.trim())
      .filter(s => s);
    for (const stmt of lines) {
      const upper = stmt.toUpperCase();
      try {
        if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION') {
          this._txDepth++;
          if (this._txDepth > 1) {
            this.db.exec(`SAVEPOINT sp_${this._txDepth};`);
            continue;
          }
        } else if (upper === 'COMMIT') {
          if (this._txDepth > 1) {
            this.db.exec(`RELEASE SAVEPOINT sp_${this._txDepth};`);
            this._txDepth = Math.max(0, this._txDepth - 1);
            continue;
          }
          this._txDepth = 0;
        } else if (upper === 'ROLLBACK') {
          if (this._txDepth > 1) {
            this.db.exec(`ROLLBACK TO SAVEPOINT sp_${this._txDepth};`);
            this._txDepth = Math.max(0, this._txDepth - 1);
            continue;
          }
          this._txDepth = 0;
        }
        this.db.exec(stmt + ';');
      } catch (e) {
        if (e.message && (
          e.message.includes('already exists') ||
          e.message.includes('duplicate column') ||
          e.message.includes('cannot start a transaction within a transaction') ||
          e.message.includes('no transaction is active')
        )) {
          continue;
        }
        throw e;
      }
    }
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        try { this.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }

  query(sql, params = []) {
    const flatArgs = params.flat();
    const cleanSql = sql.replace(/\bILIKE\b/gi, 'LIKE');
    if (/^\s*SELECT/i.test(cleanSql)) {
      const rows = this.db.prepare(cleanSql).all(...flatArgs);
      return { rows, rowCount: rows.length };
    }
    const info = this.db.prepare(cleanSql).run(...flatArgs);
    return { rows: [], rowCount: info.changes || 0 };
  }

  close() {
    if (this.db && typeof this.db.close === 'function') {
      this.db.close();
      this.db = null;
    }
  }
}

export const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bots (
  bot_id TEXT PRIMARY KEY,
  name TEXT,
  nickname TEXT,
  strategy_type TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  description TEXT,
  allocation_ratio REAL,
  allocated_capital NUMERIC,
  virtual_krw NUMERIC,
  is_running INTEGER,
  min_volume_krw NUMERIC,
  stop_loss_pct REAL,
  take_profit_pct REAL,
  config_json TEXT,
  last_status_msg TEXT,
  updated_at TEXT,
  is_virtual_running INTEGER DEFAULT 1,
  virtual_initial_capital NUMERIC DEFAULT 10000000,
  virtual_status_msg TEXT DEFAULT '가상 아레나 상시 경쟁 가동 중',
  is_real_selected INTEGER DEFAULT 0,
  is_real_running INTEGER DEFAULT 0,
  real_allocation_ratio REAL DEFAULT 0,
  real_allocated_capital NUMERIC DEFAULT 0,
  real_available_krw NUMERIC DEFAULT 0,
  real_status_msg TEXT DEFAULT '실전 대기 중'
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  stock_code TEXT,
  stock_name TEXT,
  buy_order_no TEXT,
  sell_order_no TEXT,
  buy_price NUMERIC,
  buy_qty NUMERIC,
  buy_amount NUMERIC,
  buy_date TEXT,
  sell_price NUMERIC,
  sell_qty NUMERIC,
  sell_amount NUMERIC,
  sell_date TEXT,
  fee_and_tax NUMERIC,
  profit_krw NUMERIC,
  profit_pct REAL,
  status TEXT DEFAULT 'HOLDING',
  origin_bot_id TEXT
);

CREATE TABLE IF NOT EXISTS bot_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  stock_code TEXT,
  stock_name TEXT,
  order_no TEXT UNIQUE,
  qty NUMERIC,
  avg_buy_price NUMERIC,
  buy_amount NUMERIC,
  buy_fee NUMERIC,
  trade_id INTEGER,
  status TEXT DEFAULT 'OPEN',
  created_at TEXT,
  closed_at TEXT,
  origin_bot_id TEXT
);

CREATE TABLE IF NOT EXISTS virtual_performance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT,
  eval_date TEXT,
  initial_capital NUMERIC,
  eval_assets NUMERIC,
  cumulative_return_pct REAL,
  win_rate REAL,
  profit_factor REAL,
  mdd_pct REAL,
  sharpe_ratio REAL,
  total_trades INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_market_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
  kr_index_price REAL,
  kr_daily_20ma REAL,
  kr_intraday_60ma REAL,
  kr_regime_status TEXT DEFAULT 'NORMAL',
  us_index_price REAL,
  us_daily_20ma REAL,
  us_intraday_60ma REAL,
  us_regime_status TEXT DEFAULT 'NORMAL',
  usd_krw_rate REAL,
  kospi_index REAL,
  kosdaq_index REAL,
  kospi_20ma REAL,
  kosdaq_60ma REAL,
  regime_status TEXT DEFAULT 'NORMAL',
  trigger_type TEXT DEFAULT 'MANUAL',
  briefing_text TEXT NOT NULL,
  analysis_type TEXT DEFAULT 'MARKET_BRIEFING',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  link TEXT UNIQUE,
  source TEXT,
  published_at TEXT,
  summary TEXT,
  sentiment TEXT DEFAULT 'NEUTRAL',
  keywords TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_news_pubdate ON stock_news (published_at DESC);

CREATE TABLE IF NOT EXISTS ai_news_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT,
  model TEXT,
  news_count INTEGER,
  bullish_count INTEGER,
  bearish_count INTEGER,
  neutral_count INTEGER,
  briefing_text TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_trade_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  market TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  sentiment_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  related_news TEXT,
  suggested_order_type TEXT,
  executed_by TEXT,
  execution_status TEXT,
  order_no TEXT,
  model_type TEXT DEFAULT 'FLASH',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_id ON ai_trade_decisions (id DESC);

CREATE TABLE IF NOT EXISTS market_regime_filter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sentiment_score REAL DEFAULT 0.0,
  market_regime TEXT DEFAULT 'SIDEWAYS',
  risk_alert INTEGER DEFAULT 0,
  recommended_action TEXT DEFAULT 'NORMAL',
  position_size_multiplier REAL DEFAULT 1.0,
  blacklist_tickers_json TEXT DEFAULT '[]',
  reason TEXT DEFAULT '초기 정상 가동 상태',
  kr_market_regime VARCHAR(32) DEFAULT 'SIDEWAYS',
  kr_recommended_action VARCHAR(32) DEFAULT 'NORMAL',
  kr_position_size_multiplier NUMERIC DEFAULT 1.0,
  kr_risk_alert INTEGER DEFAULT 0,
  kr_reason TEXT DEFAULT '한국 초기 정상 상태',
  kr_blacklist_tickers_json TEXT DEFAULT '[]',
  us_market_regime VARCHAR(32) DEFAULT 'SIDEWAYS',
  us_recommended_action VARCHAR(32) DEFAULT 'NORMAL',
  us_position_size_multiplier NUMERIC DEFAULT 1.0,
  us_risk_alert INTEGER DEFAULT 0,
  us_reason TEXT DEFAULT '미국 초기 정상 상태',
  us_blacklist_tickers_json TEXT DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monthly_asset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL UNIQUE,
  month_start_date TEXT NOT NULL,
  month_start_asset REAL NOT NULL,
  current_asset REAL NOT NULL,
  cash_krw REAL DEFAULT 0,
  stock_eval_krw REAL DEFAULT 0,
  change_krw REAL DEFAULT 0,
  change_pct REAL DEFAULT 0,
  snapshot_date TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export const PG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bots (
  bot_id TEXT PRIMARY KEY,
  name TEXT,
  nickname TEXT,
  strategy_type TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  description TEXT,
  allocation_ratio REAL,
  allocated_capital NUMERIC,
  virtual_krw NUMERIC,
  is_running INTEGER,
  min_volume_krw NUMERIC,
  stop_loss_pct REAL,
  take_profit_pct REAL,
  config_json TEXT,
  last_status_msg TEXT,
  updated_at TEXT,
  is_virtual_running INTEGER DEFAULT 1,
  virtual_initial_capital NUMERIC DEFAULT 10000000,
  virtual_status_msg TEXT DEFAULT '가상 아레나 상시 경쟁 가동 중',
  is_real_selected INTEGER DEFAULT 0,
  is_real_running INTEGER DEFAULT 0,
  real_allocation_ratio REAL DEFAULT 0,
  real_allocated_capital NUMERIC DEFAULT 0,
  real_available_krw NUMERIC DEFAULT 0,
  real_status_msg TEXT DEFAULT '실전 대기 중'
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  bot_id TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  stock_code TEXT,
  stock_name TEXT,
  buy_order_no TEXT,
  sell_order_no TEXT,
  buy_price NUMERIC,
  buy_qty NUMERIC,
  buy_amount NUMERIC,
  buy_date TEXT,
  sell_price NUMERIC,
  sell_qty NUMERIC,
  sell_amount NUMERIC,
  sell_date TEXT,
  fee_and_tax NUMERIC,
  profit_krw NUMERIC,
  profit_pct REAL,
  status TEXT DEFAULT 'HOLDING',
  origin_bot_id TEXT
);

CREATE TABLE IF NOT EXISTS bot_positions (
  id SERIAL PRIMARY KEY,
  bot_id TEXT,
  trade_mode TEXT DEFAULT 'VIRTUAL',
  stock_code TEXT,
  stock_name TEXT,
  order_no TEXT UNIQUE,
  qty NUMERIC,
  avg_buy_price NUMERIC,
  buy_amount NUMERIC,
  buy_fee NUMERIC,
  trade_id INTEGER,
  status TEXT DEFAULT 'OPEN',
  created_at TEXT,
  closed_at TEXT,
  origin_bot_id TEXT
);

CREATE TABLE IF NOT EXISTS virtual_performance_logs (
  id SERIAL PRIMARY KEY,
  bot_id TEXT,
  eval_date TEXT,
  initial_capital NUMERIC,
  eval_assets NUMERIC,
  cumulative_return_pct REAL,
  win_rate REAL,
  profit_factor REAL,
  mdd_pct REAL,
  sharpe_ratio REAL,
  total_trades INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_market_briefings (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
  kr_index_price REAL,
  kr_daily_20ma REAL,
  kr_intraday_60ma REAL,
  kr_regime_status TEXT DEFAULT 'NORMAL',
  us_index_price REAL,
  us_daily_20ma REAL,
  us_intraday_60ma REAL,
  us_regime_status TEXT DEFAULT 'NORMAL',
  usd_krw_rate REAL,
  kospi_index REAL,
  kosdaq_index REAL,
  kospi_20ma REAL,
  kosdaq_60ma REAL,
  regime_status TEXT DEFAULT 'NORMAL',
  trigger_type TEXT DEFAULT 'MANUAL',
  briefing_text TEXT NOT NULL,
  analysis_type TEXT DEFAULT 'MARKET_BRIEFING',
  created_at TEXT NOT NULL
);
ALTER TABLE ai_market_briefings ADD COLUMN IF NOT EXISTS analysis_type TEXT DEFAULT 'MARKET_BRIEFING';

CREATE TABLE IF NOT EXISTS stock_news (
  id SERIAL PRIMARY KEY,
  title TEXT,
  link TEXT UNIQUE,
  source TEXT,
  published_at TEXT,
  summary TEXT,
  sentiment TEXT DEFAULT 'NEUTRAL',
  keywords TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_news_pubdate ON stock_news (published_at DESC);

CREATE TABLE IF NOT EXISTS ai_news_briefings (
  id SERIAL PRIMARY KEY,
  provider TEXT,
  model TEXT,
  news_count INTEGER,
  bullish_count INTEGER,
  bearish_count INTEGER,
  neutral_count INTEGER,
  briefing_text TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_trade_decisions (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  market TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  sentiment_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  related_news TEXT,
  suggested_order_type TEXT,
  executed_by TEXT,
  execution_status TEXT,
  order_no TEXT,
  model_type TEXT DEFAULT 'FLASH',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_id ON ai_trade_decisions (id DESC);
ALTER TABLE ai_trade_decisions ADD COLUMN IF NOT EXISTS related_news TEXT;
ALTER TABLE ai_trade_decisions ADD COLUMN IF NOT EXISTS model_type TEXT DEFAULT 'FLASH';

CREATE TABLE IF NOT EXISTS market_regime_filter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sentiment_score REAL DEFAULT 0.0,
  market_regime TEXT DEFAULT 'SIDEWAYS',
  risk_alert INTEGER DEFAULT 0,
  recommended_action TEXT DEFAULT 'NORMAL',
  position_size_multiplier REAL DEFAULT 1.0,
  blacklist_tickers_json TEXT DEFAULT '[]',
  reason TEXT DEFAULT '초기 정상 가동 상태',
  kr_market_regime VARCHAR(32) DEFAULT 'SIDEWAYS',
  kr_recommended_action VARCHAR(32) DEFAULT 'NORMAL',
  kr_position_size_multiplier NUMERIC DEFAULT 1.0,
  kr_risk_alert INTEGER DEFAULT 0,
  kr_reason TEXT DEFAULT '한국 초기 정상 상태',
  kr_blacklist_tickers_json TEXT DEFAULT '[]',
  us_market_regime VARCHAR(32) DEFAULT 'SIDEWAYS',
  us_recommended_action VARCHAR(32) DEFAULT 'NORMAL',
  us_position_size_multiplier NUMERIC DEFAULT 1.0,
  us_risk_alert INTEGER DEFAULT 0,
  us_reason TEXT DEFAULT '미국 초기 정상 상태',
  us_blacklist_tickers_json TEXT DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monthly_asset_snapshots (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL UNIQUE,
  month_start_date VARCHAR(10) NOT NULL,
  month_start_asset NUMERIC NOT NULL,
  current_asset NUMERIC NOT NULL,
  cash_krw NUMERIC DEFAULT 0,
  stock_eval_krw NUMERIC DEFAULT 0,
  change_krw NUMERIC DEFAULT 0,
  change_pct NUMERIC DEFAULT 0,
  snapshot_date VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export function getDb() {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance;
}

export function initDatabase() {
  if (dbInstance) return dbInstance;

  const dbConfig = loadDbConfig();

  if (dbConfig.type === 'sqlite') {
    console.log(`[DB] 내장 SQLite 데이터베이스 연결 중 (WAL 모드): ${dbConfig.filePath}`);
    dbInstance = new SqliteAdapter(dbConfig.filePath);
    dbInstance.exec(SQLITE_SCHEMA_SQL);
    seedInitialData();
    migrateAndSeedTenBots(dbInstance);
    console.log('[DB] SQLite 스키마 및 11대 퀀트 봇 초기 데이터 설정 완료');
    return dbInstance;
  }

  console.log(`[DB] PostgreSQL 데이터베이스 연결 중: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  try {
    dbInstance = new PostgresSyncAdapter(dbConfig);
    dbInstance.exec(PG_SCHEMA_SQL);
    seedInitialData();
    migrateAndSeedTenBots(dbInstance);
    console.log('[DB] PostgreSQL 스키마 및 초기 데이터 설정 완료');
    return dbInstance;
  } catch (err) {
    console.error(`[DB] PostgreSQL 연결 실패: ${err.message}`);
    const envMode = (process.env.DB_MODE || '').toUpperCase();
    if (envMode !== 'POSTGRESQL' && envMode !== 'POSTGRES') {
      console.warn('[DB] PostgreSQL 대신 내장 SQLite(WAL 모드)로 자동 안전 폴백을 수행합니다.');
      const sqlitePath = path.join(PROJECT_ROOT, 'data', 'auto_stock_trade.db');
      dbInstance = new SqliteAdapter(sqlitePath);
      dbInstance.exec(SQLITE_SCHEMA_SQL);
      seedInitialData();
      migrateAndSeedTenBots(dbInstance);
      return dbInstance;
    }
    throw err;
  }
}

export function seedInitialData() {
  const nowIso = new Date().toISOString();
  const todayKst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const configuredPasscode = process.env.GATE_PASSCODE || 'sws@2129';
  const initSettings = [
    { key: 'gate_passcode', value: configuredPasscode },
    { key: 'virtual_fast_cycle_mode', value: '0' },
    { key: 'total_capital', value: '30000000' },
    { key: 'virtual_seed_money', value: '1000000' },
    { key: 'virtual_total_budget', value: '10000000' },
    { key: 'real_total_budget', value: '10000000' },
    { key: 'purchase_priority', value: JSON.stringify(['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']) },
    { key: 'stats_start_date', value: '2026-10-01' },
    { key: 'market_regime', value: 'NORMAL' },
    { key: 'gemini_usage_date', value: todayKst },
    { key: 'gemini_manual_used', value: '0' },
    { key: 'gemini_auto_used', value: '0' },
    { key: 'ai_briefing_last_auto_slot', value: '' },
    { key: 'ai_briefing_last_trigger_type', value: 'AUTO' },
  ];

  const stmtSetting = dbInstance.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO NOTHING
  `);
  for (const s of initSettings) {
    stmtSetting.run(s.key, s.value, nowIso);
  }

  // GATE_PASSCODE 환경변수가 명시된 경우 기존 'coin' 기본값을 덮어써서 최신화
  if (process.env.GATE_PASSCODE) {
    dbInstance.prepare(`
      UPDATE system_settings
      SET value = ?, updated_at = ?
      WHERE key = 'gate_passcode' AND value IN ('coin', 'sws@2129')
    `).run(process.env.GATE_PASSCODE, nowIso);
  }

  // Ensure default market_regime_filter row exists
  dbInstance.prepare(`
    INSERT INTO market_regime_filter (id, sentiment_score, market_regime, risk_alert, recommended_action, position_size_multiplier, blacklist_tickers_json, reason, updated_at)
    VALUES (1, 0.0, 'SIDEWAYS', 0, 'NORMAL', 1.0, '[]', '초기 정상 가동 상태', CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING
  `).run();
}

export function migrateAndSeedTenBots(database = dbInstance) {
  const TEN_QUANT_BOTS = [
    {
      bot_id: 'bot_01_volatility_breakout',
      name: '래리 윌리엄스 변동성 돌파',
      nickname: 'VOL-BREAK #1',
      strategy_type: 'VOLATILITY_BREAKOUT',
      description: '전일 변동폭(K=0.5) 돌파 및 거래량 200% 급증 시 추격 매수, 당일 종가 청산',
      stop_loss_pct: 2.0, take_profit_pct: 4.0,
      is_real_selected: 1, is_real_running: 1, real_allocation_ratio: 33.3, real_allocated_capital: 3330000, real_available_krw: 3330000,
      config_json: JSON.stringify({ k_factor: 0.5, vol_surge_ratio: 2.0 })
    },
    {
      bot_id: 'bot_02_inst_dual_momentum',
      name: '외인·기관 양매수 듀얼 모멘텀',
      nickname: 'INST-DUAL #2',
      strategy_type: 'DUAL_MOMENTUM',
      description: '20일 수익률 상위 + 외인/기관 동반 순매수 + 20일선 정배열 추세 매매',
      stop_loss_pct: 3.0, take_profit_pct: 7.0,
      is_real_selected: 1, is_real_running: 1, real_allocation_ratio: 33.3, real_allocated_capital: 3330000, real_available_krw: 3330000,
      config_json: JSON.stringify({ lookback_days: 20, min_inst_streak: 3 })
    },
    {
      bot_id: 'bot_03_bb_rsi_reversion',
      name: '볼린저 밴드 + RSI 평균회귀',
      nickname: 'BB-RSI #3',
      strategy_type: 'MEAN_REVERSION',
      description: '볼린저 하단(-2σ) 이탈 후 양봉 복귀 및 RSI(14) 30 이하 과매도 탈출 매수',
      stop_loss_pct: 2.5, take_profit_pct: 3.5,
      is_real_selected: 1, is_real_running: 1, real_allocation_ratio: 33.4, real_allocated_capital: 3340000, real_available_krw: 3340000,
      config_json: JSON.stringify({ bb_period: 20, bb_std: 2.0, rsi_low: 30 })
    },
    {
      bot_id: 'bot_04_macd_volume_surge',
      name: 'MACD 골든크로스 거래량 폭발',
      nickname: 'MACD-SURGE #4',
      strategy_type: 'MACD_VOLUME',
      description: 'MACD(12,26,9) 시그널 상향 돌파 및 평균 거래량 300% 폭발 시 진입',
      stop_loss_pct: 2.5, take_profit_pct: 5.5,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ fast: 12, slow: 26, signal: 9, vol_mult: 3.0 })
    },
    {
      bot_id: 'bot_05_supertrend_atr',
      name: '슈퍼트렌드 ATR 추세추종',
      nickname: 'SUPER-ATR #5',
      strategy_type: 'SUPERTREND',
      description: 'ATR(10)*3 변동성 채널 상향 돌파 및 ADX 강세 추세 확인 시 진입',
      stop_loss_pct: 3.0, take_profit_pct: 8.0,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ atr_period: 10, multiplier: 3.0, min_adx: 25 })
    },
    {
      bot_id: 'bot_06_envelope_sniper',
      name: '엔벨로프 낙폭과대 스나이퍼',
      nickname: 'ENV-SNIPER #6',
      strategy_type: 'ENVELOPE_REVERSAL',
      description: '20일 이평선 대비 -7% 엔벨로프 하단선 터치 후 즉각 기술적 반등 노림',
      stop_loss_pct: 2.0, take_profit_pct: 3.0,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ ma_period: 20, envelope_pct: -7.0 })
    },
    {
      bot_id: 'bot_07_ichimoku_cloud',
      name: '일목균형표 구름대 돌파',
      nickname: 'ICHIMOKU #7',
      strategy_type: 'ICHIMOKU_BREAKOUT',
      description: '전환선/기준선 호전 및 선행스팬 양운(Cloud) 상향 돌파 시 중기 추세 진입',
      stop_loss_pct: 2.8, take_profit_pct: 6.5,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ tenkan: 9, kijun: 26, senkou: 52 })
    },
    {
      bot_id: 'bot_08_stoch_vwap_scalp',
      name: '스토캐스틱 RSI + VWAP 초단타',
      nickname: 'VWAP-SCALP #8',
      strategy_type: 'VWAP_STOCH_SCALP',
      description: '당일 VWAP 상단 지지 + Stoch RSI 과매도 골든크로스 결합 고속 스캘핑',
      stop_loss_pct: 1.2, take_profit_pct: 2.5,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ stoch_k: 14, stoch_d: 3, vwap_margin: 0.002 })
    },
    {
      bot_id: 'bot_09_keltner_squeeze',
      name: '켈트너 채널 스퀴즈 폭발',
      nickname: 'KELTNER #9',
      strategy_type: 'KELTNER_SQUEEZE',
      description: '볼린저밴드가 켈트너 채널 내 수축 후 에너지 응축 상단 돌파 시 매수',
      stop_loss_pct: 2.5, take_profit_pct: 6.0,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ ema_period: 20, atr_mult: 1.5 })
    },
    {
      bot_id: 'bot_10_ma_pullback_swing',
      name: '20/60일 정배열 눌림목 스윙',
      nickname: 'PULLBACK #10',
      strategy_type: 'MA_PULLBACK',
      description: '20일/60일선 정배열 상승 추세 중 20일선 지지선 눌림목 반등 매수',
      stop_loss_pct: 2.2, take_profit_pct: 5.0,
      is_real_selected: 0, is_real_running: 0, real_allocation_ratio: 0, real_allocated_capital: 0, real_available_krw: 0,
      config_json: JSON.stringify({ fast_ma: 20, slow_ma: 60, pullback_tolerance: 0.8 })
    },
    {
      bot_id: 'bot_11_jack_kellogg_vwap',
      name: '잭 켈로그 VWAP 핵심레벨 돌파',
      nickname: 'KELLOGG-VWAP #11',
      strategy_type: 'JACK_KELLOGG_VWAP',
      description: '거래량 200% 폭발 대장주 중 VWAP·시가·전일종가 지지 및 전고점 돌파 매수, VWAP·시가 이탈 시 칼손절',
      stop_loss_pct: -2.0,
      take_profit_pct: 6.0,
      is_real_selected: 0,
      is_real_running: 0,
      real_allocation_ratio: 0,
      real_allocated_capital: 0,
      real_available_krw: 0,
      config_json: JSON.stringify({
        min_vol_ratio: 2.0,
        max_dist_from_high_pct: 3.5,
        vwap_stop_buffer: 0.995,
        max_rsi: 78
      })
    }
  ];

  const upsertBot = database.prepare(`
    INSERT INTO bots (
      bot_id, name, nickname, strategy_type, description,
      is_virtual_running, virtual_initial_capital, virtual_krw,
      is_real_selected, is_real_running, real_allocation_ratio, real_allocated_capital, real_available_krw,
      stop_loss_pct, take_profit_pct, config_json, trade_mode, is_running
    ) VALUES (?, ?, ?, ?, ?, 1, 10000000, 10000000, ?, ?, ?, ?, ?, ?, ?, ?, 'VIRTUAL', 1)
    ON CONFLICT(bot_id) DO UPDATE SET
      name = EXCLUDED.name,
      nickname = EXCLUDED.nickname,
      strategy_type = EXCLUDED.strategy_type,
      description = EXCLUDED.description,
      is_virtual_running = 1,
      stop_loss_pct = EXCLUDED.stop_loss_pct,
      take_profit_pct = EXCLUDED.take_profit_pct,
      config_json = EXCLUDED.config_json
  `);

  for (const b of TEN_QUANT_BOTS) {
    upsertBot.run(
      b.bot_id, b.name, b.nickname, b.strategy_type, b.description,
      b.is_real_selected, b.is_real_running, b.real_allocation_ratio, b.real_allocated_capital, b.real_available_krw,
      b.stop_loss_pct, b.take_profit_pct, b.config_json
    );
  }
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * 3.2 안전한 동기 트랜잭션 헬퍼 함수
 * 중첩 호출 시 자동으로 SQLite SAVEPOINT를 적용하여 DB 락/크래시 방지
 */
export function runTransaction(fn) {
  const db = getDb();
  if (!db) throw new Error('DB 인스턴스가 초기화되지 않았습니다.');
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  db.exec('BEGIN');
  try {
    const res = fn(db);
    db.exec('COMMIT');
    return res;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

/**
 * 3.2 수치 연산 방어 헬퍼 함수 (NULL, NaN, Infinity 방어)
 */
export function safeNum(val, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}
