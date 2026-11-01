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
      is_virtual_running INTEGER DEFAULT 1,
      virtual_initial_capital INTEGER DEFAULT 10000000,
      virtual_status_msg TEXT DEFAULT '가상 아레나 상시 경쟁 가동 중',
      is_real_selected INTEGER DEFAULT 0,
      is_real_running INTEGER DEFAULT 0,
      real_allocation_ratio REAL DEFAULT 0,
      real_allocated_capital INTEGER DEFAULT 0,
      real_available_krw INTEGER DEFAULT 0,
      real_status_msg TEXT DEFAULT '실전 대기 중',
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
  migrateAndSeedTenBots(db);
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
    { key: 'purchase_priority', value: JSON.stringify(['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']) },
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
}

export function migrateAndSeedTenBots(database = db) {
  const alterColumns = [
    `ALTER TABLE bots ADD COLUMN is_virtual_running INTEGER DEFAULT 1`,
    `ALTER TABLE bots ADD COLUMN virtual_initial_capital INTEGER DEFAULT 10000000`,
    `ALTER TABLE bots ADD COLUMN virtual_status_msg TEXT DEFAULT '가상 아레나 상시 경쟁 가동 중'`,
    `ALTER TABLE bots ADD COLUMN is_real_selected INTEGER DEFAULT 0`,
    `ALTER TABLE bots ADD COLUMN is_real_running INTEGER DEFAULT 0`,
    `ALTER TABLE bots ADD COLUMN real_allocation_ratio REAL DEFAULT 0`,
    `ALTER TABLE bots ADD COLUMN real_allocated_capital INTEGER DEFAULT 0`,
    `ALTER TABLE bots ADD COLUMN real_available_krw INTEGER DEFAULT 0`,
    `ALTER TABLE bots ADD COLUMN real_status_msg TEXT DEFAULT '실전 대기 중'`
  ];
  for (const sql of alterColumns) {
    try { database.exec(sql); } catch (_) {}
  }

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
      name = excluded.name,
      nickname = excluded.nickname,
      strategy_type = excluded.strategy_type,
      description = excluded.description,
      is_virtual_running = 1,
      stop_loss_pct = excluded.stop_loss_pct,
      take_profit_pct = excluded.take_profit_pct,
      config_json = excluded.config_json
  `);

  for (const b of TEN_QUANT_BOTS) {
    upsertBot.run(
      b.bot_id, b.name, b.nickname, b.strategy_type, b.description,
      b.is_real_selected, b.is_real_running, b.real_allocation_ratio, b.real_allocated_capital, b.real_available_krw,
      b.stop_loss_pct, b.take_profit_pct, b.config_json
    );
  }
}

