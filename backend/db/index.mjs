import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config/env.mjs';

let db = null;

export function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

export function initDatabase() {
  if (db) return db;

  console.log(`[DB] SQLite 데이터베이스 연결 중: ${DB_PATH}`);
  db = new DatabaseSync(DB_PATH);

  // WAL 모드 활성화 (고성능 동시성 및 내구성)
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // 스키마 생성
  db.exec(`
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
      allocated_capital INTEGER,
      virtual_krw INTEGER,
      is_running INTEGER,
      min_volume_krw INTEGER,
      stop_loss_pct REAL,
      take_profit_pct REAL,
      config_json TEXT,
      last_status_msg TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      trade_mode TEXT DEFAULT 'VIRTUAL',
      stock_code TEXT,
      stock_name TEXT,
      buy_order_no TEXT,
      sell_order_no TEXT,
      buy_price INTEGER,
      buy_qty INTEGER,
      buy_amount INTEGER,
      buy_date TEXT,
      sell_price INTEGER,
      sell_qty INTEGER,
      sell_amount INTEGER,
      sell_date TEXT,
      fee_and_tax INTEGER,
      profit_krw INTEGER,
      profit_pct REAL,
      status TEXT DEFAULT 'HOLDING'
    );

    CREATE TABLE IF NOT EXISTS bot_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      trade_mode TEXT DEFAULT 'VIRTUAL',
      stock_code TEXT,
      stock_name TEXT,
      order_no TEXT UNIQUE,
      qty REAL,
      avg_buy_price INTEGER,
      buy_amount INTEGER,
      buy_fee INTEGER,
      trade_id INTEGER,
      status TEXT DEFAULT 'OPEN',
      created_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS virtual_performance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      eval_date TEXT,
      initial_capital INTEGER,
      eval_assets INTEGER,
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
      provider TEXT,
      model TEXT,
      kospi_index REAL,
      kosdaq_index REAL,
      kospi_20ma REAL,
      kosdaq_60ma REAL,
      regime_status TEXT,
      briefing_text TEXT,
      created_at TEXT
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
      suggested_order_type TEXT,
      executed_by TEXT,
      execution_status TEXT,
      order_no TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_id ON ai_trade_decisions (id DESC);
  `);

  seedInitialData();
  console.log('[DB] SQLite 스키마 및 초기 데이터 설정 완료');
  return db;
}

export function seedInitialData() {
  const nowIso = new Date().toISOString();

  // Settings
  const initSettings = [
    { key: 'gate_passcode', value: 'sws@2129' },
    { key: 'total_capital', value: '30000000' },
    { key: 'virtual_seed_money', value: '10000000' },
    { key: 'virtual_total_budget', value: '30000000' },
    { key: 'real_total_budget', value: '10000000' },
    { key: 'stats_start_date', value: '2026-10-01' },
    { key: 'market_regime', value: 'NORMAL' },
  ];

  const stmtSetting = db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO NOTHING
  `);
  for (const s of initSettings) {
    stmtSetting.run(s.key, s.value, nowIso);
  }

  // 3대 매매 봇 초기 등록
  const initBots = [
    {
      bot_id: 'bot_kr_volatility_breakout',
      name: '래리 윌리엄스 변동성 돌파 봇',
      nickname: '변동성 돌파봇',
      strategy_type: 'VOLATILITY_BREAKOUT',
      trade_mode: 'VIRTUAL',
      description: '당일 거래대금 상위 30위 중 전일 변동폭(고가-저가)*0.5+시가 돌파 & 5분봉 거래량 200% 급증 시 매수, 15:15 시간청산 또는 +4% 익절/-2% 손절',
      allocation_ratio: 0.33,
      allocated_capital: 10000000,
      virtual_krw: 10000000,
      is_running: 1,
      min_volume_krw: 10000000000,
      stop_loss_pct: 2.0,
      take_profit_pct: 4.0,
      config_json: JSON.stringify({ k: 0.5, volume_surge_pct: 200, close_time: '15:15' }),
      last_status_msg: '대기 중 (장 개장 및 거래대금 상위 종목 감시)',
    },
    {
      bot_id: 'bot_kr_inst_dual_momentum',
      name: '외인·기관 양매수 듀얼 모멘텀 봇',
      nickname: '수급 모멘텀봇',
      strategy_type: 'INST_DUAL_MOMENTUM',
      trade_mode: 'VIRTUAL',
      description: '20거래일 수익률 상위 섹터 중 3거래일 연속 외인·기관 합산 순매수 유입 & 20일선 정배열 매수, 5일선 이탈 또는 +7% 익절/트레일링 -3% 청산',
      allocation_ratio: 0.33,
      allocated_capital: 10000000,
      virtual_krw: 10000000,
      is_running: 1,
      min_volume_krw: 10000000000,
      stop_loss_pct: 3.0,
      take_profit_pct: 7.0,
      config_json: JSON.stringify({ consecutive_days: 3, ma_period: 20, trailing_stop_pct: 3.0 }),
      last_status_msg: '대기 중 (외인/기관 수급 연속 유입 종목 감시)',
    },
    {
      bot_id: 'bot_kr_bb_rsi_reversion',
      name: '볼린저 밴드 하단 + RSI 평균회귀 봇',
      nickname: 'RSI 평균회귀봇',
      strategy_type: 'BB_RSI_REVERSION',
      trade_mode: 'VIRTUAL',
      description: '우량 대형주 중 20일 볼린저밴드 하단(-2σ) 이탈 후 재진입 양봉 & RSI<=30 탈출 시 매수, 20일선/상단선 도달 시 +3.5% 익절/-2.5% 손절',
      allocation_ratio: 0.34,
      allocated_capital: 10000000,
      virtual_krw: 10000000,
      is_running: 1,
      min_volume_krw: 10000000000,
      stop_loss_pct: 2.5,
      take_profit_pct: 3.5,
      config_json: JSON.stringify({ bb_period: 20, bb_std: 2, rsi_period: 14, rsi_oversold: 30 }),
      last_status_msg: '대기 중 (과매도 지표 반등 종목 감시)',
    },
  ];

  const stmtBot = db.prepare(`
    INSERT INTO bots (
      bot_id, name, nickname, strategy_type, trade_mode, description,
      allocation_ratio, allocated_capital, virtual_krw, is_running,
      min_volume_krw, stop_loss_pct, take_profit_pct, config_json, last_status_msg, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (bot_id) DO NOTHING
  `);

  for (const b of initBots) {
    stmtBot.run(
      b.bot_id, b.name, b.nickname, b.strategy_type, b.trade_mode, b.description,
      b.allocation_ratio, b.allocated_capital, b.virtual_krw, b.is_running,
      b.min_volume_krw, b.stop_loss_pct, b.take_profit_pct, b.config_json, b.last_status_msg, nowIso
    );
  }
}
