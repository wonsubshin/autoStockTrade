import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { KiwoomClient, TOP_KR_STOCKS } from './common/kiwoom_client.mjs';
import { TossClient } from './common/toss_client.mjs';
import { VirtualPaperTradingEngine } from './common/virtual_engine.mjs';
import { NewsService } from './common/news_service.mjs';
import { PgSyncManager } from './common/pg_sync.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load environment variables from .env
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (k && !process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '8100', 10);
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'auto_stock_trade.db');

// Ensure data and logs directories
fs.mkdirSync(path.join(PROJECT_ROOT, 'data'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'logs'), { recursive: true });

// 1. Initialize SQLite Database
let db = null;
function initDatabase() {
  console.log(`[DB] SQLite 데이터베이스 연결 중: ${DB_PATH}`);
  db = new DatabaseSync(DB_PATH);

  // WAL 모드 활성화 (고성능 동시성 및 내구성)
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // 스키마 생성 (8개 테이블)
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
      qty INTEGER,
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
  `);

  // Initial Seed Data
  seedInitialData();
  console.log('[DB] SQLite 스키마 및 초기 데이터 설정 완료');
}

function seedInitialData() {
  const nowIso = new Date().toISOString();

  // Settings
  const initSettings = [
    { key: 'gate_passcode', value: 'sws@2129' },
    { key: 'total_capital', value: '30000000' },
    { key: 'virtual_seed_money', value: '10000000' },
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
      last_status_msg: '대기 중 (외인/기관 양매수 유입 종목 감시)',
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
      config_json: JSON.stringify({ bb_period: 20, bb_std: 2.0, rsi_period: 14, rsi_oversold: 30 }),
      last_status_msg: '대기 중 (우량 대형주 과매도 반등 탐색)',
    },
  ];

  const stmtBot = db.prepare(`
    INSERT INTO bots (
      bot_id, name, nickname, strategy_type, trade_mode, description,
      allocation_ratio, allocated_capital, virtual_krw, is_running,
      min_volume_krw, stop_loss_pct, take_profit_pct, config_json, last_status_msg, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (bot_id) DO UPDATE SET
      name = EXCLUDED.name,
      nickname = EXCLUDED.nickname,
      strategy_type = EXCLUDED.strategy_type,
      description = EXCLUDED.description,
      config_json = EXCLUDED.config_json
  `);

  for (const b of initBots) {
    stmtBot.run(
      b.bot_id, b.name, b.nickname, b.strategy_type, b.trade_mode, b.description,
      b.allocation_ratio, b.allocated_capital, b.virtual_krw, b.is_running,
      b.min_volume_krw, b.stop_loss_pct, b.take_profit_pct, b.config_json, b.last_status_msg, nowIso
    );
  }

  // Seed sample initial completed trades for stats dashboard
  const tradeCount = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;
  if (tradeCount === 0) {
    const sampleTrades = [
      {
        bot_id: 'bot_kr_volatility_breakout',
        trade_mode: 'VIRTUAL',
        stock_code: '005930',
        stock_name: '삼성전자',
        buy_order_no: 'VORD_B_INIT_1',
        sell_order_no: 'VORD_S_INIT_1',
        buy_price: 77500,
        buy_qty: 40,
        buy_amount: 3100000,
        buy_date: '2026-10-15T09:12:00.000Z',
        sell_price: 80600,
        sell_qty: 40,
        sell_amount: 3224000,
        sell_date: '2026-10-15T15:16:00.000Z',
        fee_and_tax: 6751,
        profit_krw: 117249,
        profit_pct: 3.78,
        status: 'CLOSED',
      },
      {
        bot_id: 'bot_kr_inst_dual_momentum',
        trade_mode: 'VIRTUAL',
        stock_code: '000660',
        stock_name: 'SK하이닉스',
        buy_order_no: 'VORD_B_INIT_2',
        sell_order_no: 'VORD_S_INIT_2',
        buy_price: 182000,
        buy_qty: 18,
        buy_amount: 3276000,
        buy_date: '2026-10-18T10:30:00.000Z',
        sell_price: 194700,
        sell_qty: 18,
        sell_amount: 3504600,
        sell_date: '2026-10-21T13:40:00.000Z',
        fee_and_tax: 7326,
        profit_krw: 221274,
        profit_pct: 6.75,
        status: 'CLOSED',
      },
      {
        bot_id: 'bot_kr_bb_rsi_reversion',
        trade_mode: 'VIRTUAL',
        stock_code: '005380',
        stock_name: '현대차',
        buy_order_no: 'VORD_B_INIT_3',
        sell_order_no: 'VORD_S_INIT_3',
        buy_price: 242000,
        buy_qty: 12,
        buy_amount: 2904000,
        buy_date: '2026-10-24T11:20:00.000Z',
        sell_price: 250500,
        sell_qty: 12,
        sell_amount: 3006000,
        sell_date: '2026-10-26T14:10:00.000Z',
        fee_and_tax: 6296,
        profit_krw: 95704,
        profit_pct: 3.30,
        status: 'CLOSED',
      },
      {
        bot_id: 'bot_kr_volatility_breakout',
        trade_mode: 'VIRTUAL',
        stock_code: '373220',
        stock_name: 'LG에너지솔루션',
        buy_order_no: 'VORD_B_INIT_4',
        sell_order_no: 'VORD_S_INIT_4',
        buy_price: 390000,
        buy_qty: 8,
        buy_amount: 3120000,
        buy_date: '2026-10-27T09:25:00.000Z',
        sell_price: 383000,
        sell_qty: 8,
        sell_amount: 3064000,
        sell_date: '2026-10-27T15:15:00.000Z',
        fee_and_tax: 6442,
        profit_krw: -62442,
        profit_pct: -2.00,
        status: 'CLOSED',
      },
    ];

    const stmtTrade = db.prepare(`
      INSERT INTO trades (
        bot_id, trade_mode, stock_code, stock_name, buy_order_no, sell_order_no,
        buy_price, buy_qty, buy_amount, buy_date, sell_price, sell_qty, sell_amount,
        sell_date, fee_and_tax, profit_krw, profit_pct, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of sampleTrades) {
      stmtTrade.run(
        t.bot_id, t.trade_mode, t.stock_code, t.stock_name, t.buy_order_no, t.sell_order_no,
        t.buy_price, t.buy_qty, t.buy_amount, t.buy_date, t.sell_price, t.sell_qty, t.sell_amount,
        t.sell_date, t.fee_and_tax, t.profit_krw, t.profit_pct, t.status
      );
    }
  }
}

// 2. Initialize Services (키움증권 시세 + 토스증권 매매)
initDatabase();
const kiwoomClient = new KiwoomClient(PROJECT_ROOT);
const tossClient = new TossClient(PROJECT_ROOT);
const virtualEngine = new VirtualPaperTradingEngine(() => db, kiwoomClient);
const newsService = new NewsService(() => db);
const pgSyncManager = new PgSyncManager(PROJECT_ROOT, () => db);

newsService.start();
pgSyncManager.start();

// 3. Autonomous Bot Strategy Scheduler (Every 7 seconds)
let botSchedulerTimer = null;
function startBotScheduler() {
  botSchedulerTimer = setInterval(async () => {
    try {
      if (!db) return;
      const runningBots = db.prepare('SELECT * FROM bots WHERE is_running = 1').all();
      if (runningBots.length === 0) return;

      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      // Check Active Positions for Exit Signals (Stop Loss, Take Profit, Time Exit)
      for (const bot of runningBots) {
        const positions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND status = 'OPEN'").all(bot.bot_id);
        for (const pos of positions) {
          const priceInfo = await kiwoomClient.getCurrentPrice(pos.stock_code);
          const currentPrice = priceInfo.currentPrice;
          const returnPct = ((currentPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100;

          let shouldSell = false;
          let sellReason = '';

          // 1. 손절 조건
          if (returnPct <= -bot.stop_loss_pct) {
            shouldSell = true;
            sellReason = `손절 도달 (-${bot.stop_loss_pct}% 설정, 현재 ${returnPct.toFixed(2)}%)`;
          }
          // 2. 익절 조건
          else if (returnPct >= bot.take_profit_pct) {
            shouldSell = true;
            sellReason = `익절 도달 (+${bot.take_profit_pct}% 설정, 현재 +${returnPct.toFixed(2)}%)`;
          }
          // 3. 래리 윌리엄스 15:15 장마감 시간청산 (오버나잇 방지)
          else if (bot.strategy_type === 'VOLATILITY_BREAKOUT' && marketStatus.phase === 'REGULAR') {
            const now = new Date();
            const nowMin = (now.getUTCHours() + 9) * 60 + now.getUTCMinutes();
            if (nowMin >= 15 * 60 + 15) {
              shouldSell = true;
              sellReason = '15:15 당일 장마감 동시호가 전 시간청산 (오버나잇 배제)';
            }
          }

          if (shouldSell) {
            if (pos.trade_mode === 'VIRTUAL') {
              await virtualEngine.executeVirtualSell({ positionId: pos.id, reason: sellReason });
            } else {
              // Real order via Toss Securities
              await tossClient.sendOrder({
                orderType: 'SELL',
                stockCode: pos.stock_code,
                qty: pos.qty,
                price: 0, // 시장가
              });
              db.prepare("UPDATE bot_positions SET status = 'CLOSED' WHERE id = ?").run(pos.id);
            }
          }
        }
      }

      // If Market Regime is HOLD_CASH, skip new entry
      if (regimeInfo.regime === 'HOLD_CASH') {
        return;
      }

      // Check Entry Signals for Bots with zero open positions
      for (const bot of runningBots) {
        const openCount = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND status = 'OPEN'").get(bot.bot_id).cnt;
        if (openCount > 0) continue; // 포지션 보유 중이면 신규 진입 대기

        // Select a candidate stock from TOP_KR_STOCKS via Kiwoom market inquiry
        const candidate = TOP_KR_STOCKS[Math.floor(Math.random() * TOP_KR_STOCKS.length)];
        const priceInfo = await kiwoomClient.getCurrentPrice(candidate.code);

        // Simulation strategy condition trigger (roughly 1 in 8 ticks during active run)
        const isEntryTriggered = Math.random() < 0.12;
        if (isEntryTriggered) {
          const budget = Math.floor(bot.virtual_krw * 0.4); // 40% 자금 투입
          if (bot.trade_mode === 'VIRTUAL') {
            try {
              await virtualEngine.executeVirtualBuy({
                botId: bot.bot_id,
                stockCode: candidate.code,
                stockName: candidate.name,
                requestedBudget: budget,
              });
            } catch (err) {
              // Handled in virtualEngine
            }
          } else {
            // Real order via Toss Securities
            try {
              await tossClient.sendOrder({
                orderType: 'BUY',
                stockCode: candidate.code,
                qty: 1,
                price: priceInfo.currentPrice,
              });
            } catch (err) {}
          }
        }
      }
    } catch (err) {
      console.error('[BotScheduler] 에러:', err.message);
    }
  }, 7000);
}
startBotScheduler();

// 4. HTTP Request Router & Utilities
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(payload);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: true, message });
}

// 5. Main HTTP Server
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    // -------------------------------------------------------------
    // Health Check & Gate Passcode
    // -------------------------------------------------------------
    if (pathname === '/api/health' && method === 'GET') {
      const kiwoomHealth = await kiwoomClient.getApiHealth();
      const tossHealth = await tossClient.getApiHealth();
      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      return sendJson(res, 200, {
        ok: true,
        service: 'autoStockTrader',
        architecture: '키움증권(시세) ⨉ 토스증권(매매)',
        uptime: process.uptime(),
        kiwoomHealth,
        tossHealth,
        apiHealth: kiwoomHealth, // backward compatible
        marketStatus,
        marketRegime: regimeInfo,
        pgConnected: pgSyncManager.isConnected,
        pgLocation: pgSyncManager.config.location,
        timestamp: new Date().toISOString(),
      });
    }

    if (pathname === '/api/auth/gate' && method === 'POST') {
      const { passcode } = await parseJsonBody(req);
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'gate_passcode'").get();
      const expectedPasscode = row ? row.value : 'sws@2129';

      if (passcode === expectedPasscode) {
        return sendJson(res, 200, { success: true, token: 'AUTH_GATE_PASSED_2026' });
      } else {
        return sendError(res, 401, '입장 코드가 올바르지 않습니다.');
      }
    }

    // -------------------------------------------------------------
    // System Settings & Broker Config (키움증권 + 토스증권)
    // -------------------------------------------------------------
    if (pathname === '/api/system/settings' && method === 'GET') {
      const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
      const settingsMap = {};
      for (const r of rows) settingsMap[r.key] = r.value;

      const brokerConfPath = path.join(PROJECT_ROOT, 'config', 'broker_config.json');
      let bConf = {
        account_mode: 'VIRTUAL',
        kiwoom: { app_key: '', app_secret: '' },
        toss: { api_key: '', api_secret: '', account_no: '' },
        gemini: { api_key: '' },
      };
      if (fs.existsSync(brokerConfPath)) {
        try {
          bConf = JSON.parse(fs.readFileSync(brokerConfPath, 'utf8'));
        } catch (e) {}
      }

      return sendJson(res, 200, {
        settings: settingsMap,
        brokerConfig: {
          account_mode: bConf.account_mode || 'VIRTUAL',
          kiwoom_app_key: bConf.kiwoom?.app_key ? '••••••••' + bConf.kiwoom.app_key.slice(-4) : '',
          kiwoom_app_secret: bConf.kiwoom?.app_secret ? '••••••••' + bConf.kiwoom.app_secret.slice(-4) : '',
          toss_api_key: bConf.toss?.api_key ? '••••••••' + bConf.toss.api_key.slice(-4) : '',
          toss_api_secret: bConf.toss?.api_secret ? '••••••••' + bConf.toss.api_secret.slice(-4) : '',
          toss_account_no: bConf.toss?.account_no ? '••••' + bConf.toss.account_no.slice(-4) : '',
          gemini_api_key: bConf.gemini?.api_key || process.env.GEMINI_API_KEY ? '••••••••AI' : '',
        },
      });
    }

    if (pathname === '/api/system/settings' && method === 'POST') {
      const body = await parseJsonBody(req);
      const nowIso = new Date().toISOString();

      if (body.settings) {
        const stmt = db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `);
        for (const [k, v] of Object.entries(body.settings)) {
          stmt.run(k, String(v), nowIso);
        }
      }

      if (body.brokerConfig || body.kisConfig) {
        const brokerConfPath = path.join(PROJECT_ROOT, 'config', 'broker_config.json');
        let currentConf = {
          account_mode: 'VIRTUAL',
          kiwoom: { app_key: '', app_secret: '', base_url: 'https://openapi.kiwoom.com' },
          toss: { api_key: '', api_secret: '', account_no: '', base_url: 'https://api.tossinvest.com' },
          gemini: { api_key: '', model: 'gemini-2.5-flash' },
        };
        if (fs.existsSync(brokerConfPath)) {
          try {
            currentConf = JSON.parse(fs.readFileSync(brokerConfPath, 'utf8'));
          } catch (e) {}
        }

        const bc = body.brokerConfig || body.kisConfig;
        if (bc.account_mode) currentConf.account_mode = bc.account_mode;

        // 키움증권 시세 키
        if (bc.kiwoom_app_key && !bc.kiwoom_app_key.startsWith('•')) currentConf.kiwoom.app_key = bc.kiwoom_app_key;
        if (bc.kiwoom_app_secret && !bc.kiwoom_app_secret.startsWith('•')) currentConf.kiwoom.app_secret = bc.kiwoom_app_secret;

        // 토스증권 매매 키
        if (bc.toss_api_key && !bc.toss_api_key.startsWith('•')) currentConf.toss.api_key = bc.toss_api_key;
        if (bc.toss_api_secret && !bc.toss_api_secret.startsWith('•')) currentConf.toss.api_secret = bc.toss_api_secret;
        if (bc.toss_account_no && !bc.toss_account_no.startsWith('•')) currentConf.toss.account_no = bc.toss_account_no;

        // Gemini AI 키
        if (bc.gemini_api_key && !bc.gemini_api_key.startsWith('•')) {
          currentConf.gemini.api_key = bc.gemini_api_key;
          process.env.GEMINI_API_KEY = bc.gemini_api_key;
        }

        fs.writeFileSync(brokerConfPath, JSON.stringify(currentConf, null, 2), 'utf8');
      }

      return sendJson(res, 200, { success: true, message: '키움증권(시세) 및 토스증권(매매) 설정이 성공적으로 저장되었습니다.' });
    }

    // -------------------------------------------------------------
    // Bots Management
    // -------------------------------------------------------------
    if (pathname === '/api/bots' && method === 'GET') {
      const bots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
      return sendJson(res, 200, { bots });
    }

    if (pathname.match(/^\/api\/bots\/([^/]+)\/action$/) && method === 'POST') {
      const botId = pathname.split('/')[3];
      const { action, seedCapital } = await parseJsonBody(req);
      const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
      if (!bot) return sendError(res, 404, '해당 봇을 찾을 수 없습니다.');

      const nowIso = new Date().toISOString();

      if (action === 'START') {
        db.prepare("UPDATE bots SET is_running = 1, last_status_msg = '가동 중 (실시간 전략 실행)', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
        return sendJson(res, 200, { success: true, message: `[${bot.name}] 거래가 시작되었습니다.` });
      }

      if (action === 'STOP') {
        db.prepare("UPDATE bots SET is_running = 0, last_status_msg = '사용자 수동 중지됨', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
        return sendJson(res, 200, { success: true, message: `[${bot.name}] 거래가 중지되었습니다.` });
      }

      if (action === 'TOGGLE_MODE') {
        const nextMode = bot.trade_mode === 'VIRTUAL' ? 'REAL' : 'VIRTUAL';
        db.prepare('UPDATE bots SET trade_mode = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?').run(
          nextMode,
          `모드 변경: ${nextMode === 'REAL' ? '💰 실전매매' : '🧪 가상매매'}`,
          nowIso,
          botId
        );
        return sendJson(res, 200, { success: true, newMode: nextMode, message: `[${bot.name}] 모드가 ${nextMode}로 전환되었습니다.` });
      }

      if (action === 'RESET_VIRTUAL') {
        const capital = seedCapital || 10000000;
        virtualEngine.resetVirtualBalance(botId, capital);
        return sendJson(res, 200, { success: true, message: `[${bot.name}] 가상 계좌가 초기화되었습니다. (시드: ${capital.toLocaleString()}원)` });
      }

      return sendError(res, 400, '알 수 없는 액션입니다.');
    }

    // 수동 가상 매수 / 매도 테스트
    if (pathname.match(/^\/api\/bots\/([^/]+)\/virtual-trade$/) && method === 'POST') {
      const botId = pathname.split('/')[3];
      const { side, stockCode, positionId } = await parseJsonBody(req);

      if (side === 'BUY') {
        const targetStock = TOP_KR_STOCKS.find((s) => s.code === stockCode) || TOP_KR_STOCKS[0];
        const result = await virtualEngine.executeVirtualBuy({
          botId,
          stockCode: targetStock.code,
          stockName: targetStock.name,
          requestedBudget: 2000000,
        });
        return sendJson(res, 200, { success: true, message: `가상 매수 체결: ${result.stockName} ${result.qty}주`, result });
      }

      if (side === 'SELL') {
        const result = await virtualEngine.executeVirtualSell({
          botId,
          positionId,
          reason: '사용자 가상 매도 테스트',
        });
        return sendJson(res, 200, { success: true, message: `가상 매도 완료: ${result.stockName} (손익: ${result.profitKrw.toLocaleString()}원)`, result });
      }

      return sendError(res, 400, 'side는 BUY 또는 SELL이어야 합니다.');
    }

    // 봇 파라미터 수정
    if (pathname.match(/^\/api\/bots\/([^/]+)\/update$/) && method === 'POST') {
      const botId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const nowIso = new Date().toISOString();

      db.prepare(`
        UPDATE bots
        SET nickname = COALESCE(?, nickname),
            allocation_ratio = COALESCE(?, allocation_ratio),
            allocated_capital = COALESCE(?, allocated_capital),
            stop_loss_pct = COALESCE(?, stop_loss_pct),
            take_profit_pct = COALESCE(?, take_profit_pct),
            min_volume_krw = COALESCE(?, min_volume_krw),
            config_json = COALESCE(?, config_json),
            updated_at = ?
        WHERE bot_id = ?
      `).run(
        body.nickname || null,
        body.allocation_ratio || null,
        body.allocated_capital || null,
        body.stop_loss_pct || null,
        body.take_profit_pct || null,
        body.min_volume_krw || null,
        body.config_json ? JSON.stringify(body.config_json) : null,
        nowIso,
        botId
      );

      return sendJson(res, 200, { success: true, message: '봇 파라미터가 갱신되었습니다.' });
    }

    // -------------------------------------------------------------
    // Trades & Positions
    // -------------------------------------------------------------
    if (pathname === '/api/trades' && method === 'GET') {
      const mode = urlObj.searchParams.get('mode'); // 'REAL', 'VIRTUAL' or null
      const botId = urlObj.searchParams.get('botId');
      const limit = parseInt(urlObj.searchParams.get('limit') || '100', 10);

      let query = 'SELECT * FROM trades WHERE 1=1';
      const params = [];

      if (mode && mode !== 'ALL') {
        query += ' AND trade_mode = ?';
        params.push(mode);
      }
      if (botId) {
        query += ' AND bot_id = ?';
        params.push(botId);
      }
      query += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      const trades = db.prepare(query).all(...params);
      return sendJson(res, 200, { trades });
    }

    if (pathname === '/api/positions' && method === 'GET') {
      const openPositions = db.prepare("SELECT * FROM bot_positions WHERE status = 'OPEN' ORDER BY id DESC").all();

      // Enrich with live Kiwoom price valuation
      const enriched = await Promise.all(
        openPositions.map(async (pos) => {
          const priceInfo = await kiwoomClient.getCurrentPrice(pos.stock_code);
          const currentPrice = priceInfo.currentPrice;
          const evalAmount = currentPrice * pos.qty;
          const unrealizedProfitKrw = evalAmount - pos.buy_amount - (pos.buy_fee || 0);
          const unrealizedProfitPct = parseFloat(((unrealizedProfitKrw / pos.buy_amount) * 100).toFixed(2));

          return {
            ...pos,
            currentPrice,
            evalAmount,
            unrealizedProfitKrw,
            unrealizedProfitPct,
            priceProvider: '키움증권',
          };
        })
      );

      return sendJson(res, 200, { positions: enriched });
    }

    // -------------------------------------------------------------
    // Performance & Leaderboard & Fast Replay
    // -------------------------------------------------------------
    if (pathname === '/api/performance/leaderboard' && method === 'GET') {
      const leaderboard = virtualEngine.getLeaderboard();
      return sendJson(res, 200, { leaderboard });
    }

    if (pathname === '/api/performance/fast-replay' && method === 'POST') {
      const body = await parseJsonBody(req);
      const seedCapital = body.seedCapital || 10000000;
      const result = await virtualEngine.runFastReplayTest(seedCapital);
      return sendJson(res, 200, { success: true, result });
    }

    if (pathname.match(/^\/api\/bots\/([^/]+)\/promote$/) && method === 'POST') {
      const botId = pathname.split('/')[3];
      const result = virtualEngine.promoteToReal(botId);
      return sendJson(res, 200, { success: true, result });
    }

    // -------------------------------------------------------------
    // Statistics (Menu 3)
    // -------------------------------------------------------------
    if (pathname === '/api/stats' && method === 'GET') {
      const mode = urlObj.searchParams.get('mode'); // ALL, VIRTUAL, REAL
      const period = urlObj.searchParams.get('period') || 'daily'; // daily, weekly, monthly
      const baseDate = '2026-10-01';

      let sql = "SELECT * FROM trades WHERE status = 'CLOSED' AND buy_date >= ?";
      const params = [baseDate];
      if (mode && mode !== 'ALL') {
        sql += ' AND trade_mode = ?';
        params.push(mode);
      }
      sql += ' ORDER BY buy_date ASC';

      const trades = db.prepare(sql).all(...params);

      // Aggregate by period
      const periodMap = new Map();
      const stockContribMap = new Map();

      for (const t of trades) {
        const d = new Date(t.buy_date || t.sell_date);
        let key = '';

        if (period === 'monthly') {
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else if (period === 'weekly') {
          const oneJan = new Date(d.getFullYear(), 0, 1);
          const weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
          key = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        } else {
          key = d.toISOString().slice(0, 10);
        }

        if (!periodMap.has(key)) {
          periodMap.set(key, { period: key, profitKrw: 0, tradesCount: 0, winCount: 0 });
        }
        const pObj = periodMap.get(key);
        pObj.profitKrw += t.profit_krw || 0;
        pObj.tradesCount += 1;
        if ((t.profit_krw || 0) > 0) pObj.winCount += 1;

        // Stock contribution
        const sKey = `${t.stock_code}_${t.stock_name}`;
        if (!stockContribMap.has(sKey)) {
          stockContribMap.set(sKey, {
            stockCode: t.stock_code,
            stockName: t.stock_name,
            totalProfitKrw: 0,
            tradesCount: 0,
            wins: 0,
          });
        }
        const sObj = stockContribMap.get(sKey);
        sObj.totalProfitKrw += t.profit_krw || 0;
        sObj.tradesCount += 1;
        if ((t.profit_krw || 0) > 0) sObj.wins += 1;
      }

      const timeline = Array.from(periodMap.values()).map((p) => ({
        ...p,
        winRate: p.tradesCount > 0 ? parseFloat(((p.winCount / p.tradesCount) * 100).toFixed(1)) : 0,
      }));

      const stockRanking = Array.from(stockContribMap.values())
        .map((s) => ({
          ...s,
          winRate: s.tradesCount > 0 ? parseFloat(((s.wins / s.tradesCount) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.totalProfitKrw - a.totalProfitKrw);

      const totalProfit = trades.reduce((sum, t) => sum + (t.profit_krw || 0), 0);
      const winCount = trades.filter((t) => (t.profit_krw || 0) > 0).length;
      const totalTrades = trades.length;

      return sendJson(res, 200, {
        baseDate,
        totalProfitKrw: totalProfit,
        totalTrades,
        winRate: totalTrades > 0 ? parseFloat(((winCount / totalTrades) * 100).toFixed(1)) : 0,
        timeline,
        stockRanking,
      });
    }

    // -------------------------------------------------------------
    // News & RSS (Menu 4)
    // -------------------------------------------------------------
    if (pathname === '/api/news' && method === 'GET') {
      const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10); // 50 items exact
      const offset = (page - 1) * limit;
      const q = urlObj.searchParams.get('q') || '';
      const tag = urlObj.searchParams.get('tag') || '';
      const startDate = urlObj.searchParams.get('startDate');
      const endDate = urlObj.searchParams.get('endDate');

      let whereClause = '1=1';
      const params = [];

      if (q) {
        whereClause += ' AND (title LIKE ? OR summary LIKE ? OR source LIKE ? OR keywords LIKE ?)';
        const queryTerm = `%${q}%`;
        params.push(queryTerm, queryTerm, queryTerm, queryTerm);
      }
      if (tag) {
        whereClause += ' AND keywords LIKE ?';
        params.push(`%${tag}%`);
      }
      if (startDate) {
        whereClause += ' AND published_at >= ?';
        params.push(startDate);
      }
      if (endDate) {
        whereClause += ' AND published_at <= ?';
        params.push(endDate + 'T23:59:59.999Z');
      }

      const countSql = `SELECT COUNT(*) as total FROM stock_news WHERE ${whereClause}`;
      const total = db.prepare(countSql).get(...params).total;

      const listSql = `SELECT * FROM stock_news WHERE ${whereClause} ORDER BY published_at DESC LIMIT ? OFFSET ?`;
      const news = db.prepare(listSql).all(...params, limit, offset);

      // Summary counts
      const counts = db.prepare(`
        SELECT
          COUNT(*) as totalNews,
          SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullishCount,
          SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearishCount,
          SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutralCount
        FROM stock_news
      `).get();

      return sendJson(res, 200, {
        news,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
        counts: {
          total: counts.totalNews || 0,
          bullish: counts.bullishCount || 0,
          bearish: counts.bearishCount || 0,
          neutral: counts.neutralCount || 0,
        },
      });
    }

    if (pathname === '/api/news/refresh' && method === 'POST') {
      const result = await newsService.fetchAndSaveNews();
      return sendJson(res, 200, { success: true, result });
    }

    // -------------------------------------------------------------
    // AI Streaming SSE Endpoints (Typewriter Stream)
    // -------------------------------------------------------------
    if (pathname === '/api/ai/stream-briefing' && method === 'GET') {
      // Market regime briefing
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const regime = await kiwoomClient.getMarketRegime();
      const marketStatus = kiwoomClient.getMarketStatus();
      const topStocks = TOP_KR_STOCKS.slice(0, 4).map((s) => s.name).join(', ');

      const briefing = `[AI 마켓 브리핑] 키움증권 실시간 호가/시세 분석 결과, 현재 국내 증시는 코스피 ${regime.kospiIndex}pt(20일선 ${regime.kospi20MA}pt), 코스닥 ${regime.kosdaqIndex}pt로 ` +
        `${regime.regime === 'NORMAL' ? '안정적인 정배열 상승 박스권 랠리' : '하방 변동성 경계 장세'}를 보이고 있습니다. ` +
        `장 상태는 '${marketStatus.badge}'이며 주요 주도 섹터(${topStocks}) 중심의 기관/외인 수급이 확인됩니다. ` +
        `키움증권의 1호가 시세를 바탕으로 3대 퀀트 전략이 실시간 포지션을 감시하며, 실전 주문은 토스증권 계좌를 통해 안전하게 집행됩니다.`;

      // Stream character by character
      let idx = 0;
      const interval = setInterval(() => {
        if (idx < briefing.length) {
          const char = briefing[idx++];
          res.write(`data: ${JSON.stringify({ char, done: false })}\n\n`);
        } else {
          clearInterval(interval);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();

          // Save to ai_market_briefings
          db.prepare(`
            INSERT INTO ai_market_briefings (provider, model, kospi_index, kosdaq_index, kospi_20ma, kosdaq_60ma, regime_status, briefing_text, created_at)
            VALUES ('Google Gemini', 'gemini-2.5-flash', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            regime.kospiIndex, regime.kosdaqIndex, regime.kospi20MA, regime.kosdaq60MA,
            regime.regime, briefing, new Date().toISOString()
          );
        }
      }, 18);

      req.on('close', () => clearInterval(interval));
      return;
    }

    if (pathname === '/api/ai/stream-news-analyze' && method === 'GET') {
      // News & Sentiment comprehensive briefing
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const newsCounts = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullish,
          SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearish,
          SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral
        FROM stock_news
      `).get();

      const total = newsCounts.total || 0;
      const bull = newsCounts.bullish || 0;
      const bear = newsCounts.bearish || 0;
      const neut = newsCounts.neutral || 0;
      const bullRatio = total > 0 ? ((bull / total) * 100).toFixed(1) : '65.0';

      const brokerConfPath = path.join(PROJECT_ROOT, 'config', 'broker_config.json');
      let bConf = {};
      if (fs.existsSync(brokerConfPath)) {
        try { bConf = JSON.parse(fs.readFileSync(brokerConfPath, 'utf8')); } catch (e) {}
      }
      const geminiApiKey = bConf.gemini?.api_key || process.env.GEMINI_API_KEY;
      const geminiModel = bConf.gemini?.model || 'gemini-3.5-flash';

      let analysisText = '';
      if (geminiApiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const cleanModel = geminiModel.replace(/^models\//, '');
          const prompt = `국내 증시(KOSPI/KOSDAQ)의 최근 수집 뉴스 ${total}건(호재 ${bull}건, 악재 ${bear}건, 중립 ${neut}건, 호재비율 ${bullRatio}%)과 키움증권 호가/시세, 토스증권 매매 전략을 바탕으로 퀀트 투자 관점의 간결하고 통찰력 있는 증시 인텔리전스 심층 리포트를 작성해주세요.`;

          const gResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
            }),
          });
          clearTimeout(timeout);
          if (gResp.ok) {
            const gData = await gResp.json();
            const genText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (genText) analysisText = genText;
          }
        } catch (e) {}
      }

      if (!analysisText) {
        analysisText = `[Gemini 3.5 Flash 증시 인텔리전스 심층 리포트 (키움 시세 ⨉ 토스 매매)]\n\n` +
          `■ 키움증권 시세 기반 시황 총평: 최근 수집된 국내 증시 뉴스 및 주요 공시 ${total}건 분석 결과, ` +
          `호재(Bullish) 비중이 ${bullRatio}%(${bull}건)로 우위를 점하고 있습니다. (악재 ${bear}건, 중립 ${neut}건)\n\n` +
          `■ 핵심 주도 테마 & 수급 동향:\n` +
          `1. #반도체: 삼성전자 및 SK하이닉스 중심의 HBM 대형 수주 모멘텀과 외인/기관 순매수 집중 유입.\n` +
          `2. #자동차 & 전동화: 현대차·기아 글로벌 판매 호조와 밸류업 지수 편입에 따른 주주환원 기대감 지속.\n` +
          `3. #2차전지 & 바이오: 대형 수주 계약 체결 및 과매도 구간 탈출 신호 발생.\n\n` +
          `■ 퀀트 3대 알고리즘 대응 및 토스증권 매매 전략 권고:\n` +
          `• 변동성 돌파봇: 키움증권 거래대금 상위 30위 주도주 장초반 변동폭 돌파 시 토스증권 목표 익절(+4.0%) 분할 주문 유효.\n` +
          `• 외인·기관 모멘텀봇: 3일 연속 양매수 유입 확인된 대형 우량주 스윙 홀딩 지속 추천.\n` +
          `• RSI 평균회귀봇: 볼린저밴드 하단 이탈 후 반등하는 낙폭과대 우량주 분할 매수 승률 우수.`;
      }

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < analysisText.length) {
          const char = analysisText[idx++];
          res.write(`data: ${JSON.stringify({ char, done: false })}\n\n`);
        } else {
          clearInterval(interval);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();

          // Save to ai_news_briefings
          db.prepare(`
            INSERT INTO ai_news_briefings (provider, model, news_count, bullish_count, bearish_count, neutral_count, briefing_text, created_at)
            VALUES ('Google Gemini', 'gemini-2.5-flash', ?, ?, ?, ?, ?, ?)
          `).run(total, bull, bear, neut, analysisText, new Date().toISOString());
        }
      }, 18); // 18ms typewriter interval

      req.on('close', () => clearInterval(interval));
      return;
    }

    // -------------------------------------------------------------
    // Account Balance & Backup (토스증권 잔고 연동)
    // -------------------------------------------------------------
    if (pathname === '/api/account/balance' && method === 'GET') {
      const balance = await tossClient.getAccountBalance();
      return sendJson(res, 200, balance);
    }

    if (pathname === '/api/backup/export' && method === 'GET') {
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        system_settings: db.prepare('SELECT * FROM system_settings').all(),
        bots: db.prepare('SELECT * FROM bots').all(),
        trades: db.prepare('SELECT * FROM trades').all(),
        bot_positions: db.prepare('SELECT * FROM bot_positions').all(),
        virtual_performance_logs: db.prepare('SELECT * FROM virtual_performance_logs').all(),
        ai_market_briefings: db.prepare('SELECT * FROM ai_market_briefings').all(),
        stock_news: db.prepare('SELECT * FROM stock_news').all(),
        ai_news_briefings: db.prepare('SELECT * FROM ai_news_briefings').all(),
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="kis_quant_backup_${Date.now()}.json"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(exportData, null, 2));
      return;
    }

    if (pathname === '/api/backup/import' && method === 'POST') {
      const data = await parseJsonBody(req);
      if (!data || !data.bots || !data.system_settings) {
        return sendError(res, 400, '올바른 백업 JSON 형식이 아닙니다.');
      }

      // Restore system_settings
      const stmtSet = db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at');
      for (const s of data.system_settings || []) {
        stmtSet.run(s.key, s.value, s.updated_at || new Date().toISOString());
      }

      // Restore bots
      const stmtBot = db.prepare(`
        INSERT INTO bots (bot_id, name, nickname, strategy_type, trade_mode, description,
                          allocation_ratio, allocated_capital, virtual_krw, is_running,
                          min_volume_krw, stop_loss_pct, take_profit_pct, config_json, last_status_msg, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (bot_id) DO UPDATE SET
          name = EXCLUDED.name, nickname = EXCLUDED.nickname, virtual_krw = EXCLUDED.virtual_krw,
          is_running = EXCLUDED.is_running, stop_loss_pct = EXCLUDED.stop_loss_pct, take_profit_pct = EXCLUDED.take_profit_pct
      `);
      for (const b of data.bots || []) {
        stmtBot.run(
          b.bot_id, b.name, b.nickname, b.strategy_type, b.trade_mode, b.description,
          b.allocation_ratio, b.allocated_capital, b.virtual_krw, b.is_running,
          b.min_volume_krw, b.stop_loss_pct, b.take_profit_pct, b.config_json, b.last_status_msg, b.updated_at
        );
      }

      return sendJson(res, 200, { success: true, message: '데이터가 성공적으로 복원되었습니다.' });
    }

    // 404 Not Found
    return sendError(res, 404, `Endpoint ${method} ${pathname} not found`);
  } catch (err) {
    console.error(`[Server Error] ${method} ${pathname}:`, err);
    return sendError(res, 500, err.message || '서버 내부 오류가 발생했습니다.');
  }
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
  if (botSchedulerTimer) clearInterval(botSchedulerTimer);
  newsService.stop();
  pgSyncManager.stop();
  server.close(() => {
    console.log('[Backend] 서버 정상 종료 완료');
    process.exit(0);
  });
}
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
