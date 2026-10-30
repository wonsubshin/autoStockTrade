import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export class PgSyncManager {
  constructor(projectRoot, getSqliteDb) {
    this.projectRoot = projectRoot;
    this.getSqliteDb = getSqliteDb;
    this.pool = null;
    this.isConnected = false;
    this.syncInterval = null;
    this.lastSyncTime = null;
    this.loadEnv();
  }

  loadEnv() {
    const envPath = path.join(this.projectRoot, '.env');
    this.config = {
      location: 'local',
      host: '127.0.0.1',
      port: 5432,
      database: 'stock_trader',
      user: 'stock_trader',
      password: 'stock123$%^',
    };

    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const env = {};
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

      this.config.location = (env.LOCATION || 'local').toLowerCase();
      if (this.config.location === 'outer') {
        this.config.host = env.OUTER_PG_HOST || '218.234.55.78';
        this.config.port = parseInt(env.OUTER_PG_PORT || '5432', 10);
        this.config.database = env.OUTER_PG_DATABASE || 'stock_trader';
        this.config.user = env.OUTER_PG_USER || 'stock_trader';
        this.config.password = env.OUTER_PG_PASSWORD || 'stock123$%^';
      } else {
        this.config.host = env.LOCAL_PG_HOST || '127.0.0.1';
        this.config.port = parseInt(env.LOCAL_PG_PORT || '5432', 10);
        this.config.database = env.LOCAL_PG_DATABASE || 'stock_trader';
        this.config.user = env.LOCAL_PG_USER || 'stock_trader';
        this.config.password = env.LOCAL_PG_PASSWORD || 'stock123$%^';
      }
    }
  }

  async start() {
    try {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
        max: 5,
      });

      this.pool.on('error', (err) => {
        // Suppress unhandled errors from background pool
        this.isConnected = false;
      });

      // Test connection
      await this.pool.query('SELECT 1');
      this.isConnected = true;
      console.log(`[PG-Sync] PostgreSQL 연결 성공 (${this.config.user}@${this.config.host}:${this.config.port}/${this.config.database})`);

      // Initial sync
      await this.syncAll();
    } catch (err) {
      this.isConnected = false;
      console.warn(`[PG-Sync] PostgreSQL 연결 대기 중 (${err.message}). 로컬 SQLite로 정상 작동합니다.`);
    }

    // Periodic sync every 60s
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(() => {});
    }, 60000);
  }

  stop() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.pool) {
      this.pool.end().catch(() => {});
    }
  }

  async syncAll() {
    if (!this.pool) return;
    const db = this.getSqliteDb();
    if (!db) return;

    try {
      // Re-verify connection if it was down
      if (!this.isConnected) {
        await this.pool.query('SELECT 1');
        this.isConnected = true;
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // 1. system_settings
        const settings = db.prepare('SELECT * FROM system_settings').all();
        for (const row of settings) {
          await client.query(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [row.key, row.value, row.updated_at]
          );
        }

        // 2. bots
        const bots = db.prepare('SELECT * FROM bots').all();
        for (const b of bots) {
          await client.query(
            `INSERT INTO bots (bot_id, name, nickname, strategy_type, trade_mode, description,
                               allocation_ratio, allocated_capital, virtual_krw, is_running,
                               min_volume_krw, stop_loss_pct, take_profit_pct, config_json, last_status_msg, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (bot_id) DO UPDATE SET
               name = EXCLUDED.name, nickname = EXCLUDED.nickname, strategy_type = EXCLUDED.strategy_type,
               trade_mode = EXCLUDED.trade_mode, description = EXCLUDED.description,
               allocation_ratio = EXCLUDED.allocation_ratio, allocated_capital = EXCLUDED.allocated_capital,
               virtual_krw = EXCLUDED.virtual_krw, is_running = EXCLUDED.is_running,
               min_volume_krw = EXCLUDED.min_volume_krw, stop_loss_pct = EXCLUDED.stop_loss_pct,
               take_profit_pct = EXCLUDED.take_profit_pct, config_json = EXCLUDED.config_json,
               last_status_msg = EXCLUDED.last_status_msg, updated_at = EXCLUDED.updated_at`,
            [b.bot_id, b.name, b.nickname, b.strategy_type, b.trade_mode, b.description,
             b.allocation_ratio, b.allocated_capital, b.virtual_krw, b.is_running,
             b.min_volume_krw, b.stop_loss_pct, b.take_profit_pct, b.config_json, b.last_status_msg, b.updated_at]
          );
        }

        // 3. trades
        const trades = db.prepare('SELECT * FROM trades').all();
        for (const t of trades) {
          await client.query(
            `INSERT INTO trades (id, bot_id, trade_mode, stock_code, stock_name, buy_order_no, sell_order_no,
                                 buy_price, buy_qty, buy_amount, buy_date, sell_price, sell_qty, sell_amount,
                                 sell_date, fee_and_tax, profit_krw, profit_pct, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             ON CONFLICT (id) DO UPDATE SET
               bot_id = EXCLUDED.bot_id, trade_mode = EXCLUDED.trade_mode, stock_code = EXCLUDED.stock_code,
               stock_name = EXCLUDED.stock_name, buy_order_no = EXCLUDED.buy_order_no, sell_order_no = EXCLUDED.sell_order_no,
               buy_price = EXCLUDED.buy_price, buy_qty = EXCLUDED.buy_qty, buy_amount = EXCLUDED.buy_amount,
               buy_date = EXCLUDED.buy_date, sell_price = EXCLUDED.sell_price, sell_qty = EXCLUDED.sell_qty,
               sell_amount = EXCLUDED.sell_amount, sell_date = EXCLUDED.sell_date, fee_and_tax = EXCLUDED.fee_and_tax,
               profit_krw = EXCLUDED.profit_krw, profit_pct = EXCLUDED.profit_pct, status = EXCLUDED.status`,
            [t.id, t.bot_id, t.trade_mode, t.stock_code, t.stock_name, t.buy_order_no, t.sell_order_no,
             t.buy_price, t.buy_qty, t.buy_amount, t.buy_date, t.sell_price, t.sell_qty, t.sell_amount,
             t.sell_date, t.fee_and_tax, t.profit_krw, t.profit_pct, t.status]
          );
        }

        // 4. bot_positions
        const positions = db.prepare('SELECT * FROM bot_positions').all();
        for (const p of positions) {
          await client.query(
            `INSERT INTO bot_positions (id, bot_id, trade_mode, stock_code, stock_name, order_no, qty,
                                        avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at, closed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (order_no) DO UPDATE SET
               bot_id = EXCLUDED.bot_id, trade_mode = EXCLUDED.trade_mode, stock_code = EXCLUDED.stock_code,
               stock_name = EXCLUDED.stock_name, qty = EXCLUDED.qty, avg_buy_price = EXCLUDED.avg_buy_price,
               buy_amount = EXCLUDED.buy_amount, buy_fee = EXCLUDED.buy_fee, trade_id = EXCLUDED.trade_id,
               status = EXCLUDED.status, closed_at = EXCLUDED.closed_at`,
            [p.id, p.bot_id, p.trade_mode, p.stock_code, p.stock_name, p.order_no, p.qty,
             p.avg_buy_price, p.buy_amount, p.buy_fee, p.trade_id, p.status, p.created_at, p.closed_at]
          );
        }

        // 5. virtual_performance_logs
        const perfLogs = db.prepare('SELECT * FROM virtual_performance_logs').all();
        for (const pl of perfLogs) {
          await client.query(
            `INSERT INTO virtual_performance_logs (id, bot_id, eval_date, initial_capital, eval_assets,
                                                  cumulative_return_pct, win_rate, profit_factor, mdd_pct,
                                                  sharpe_ratio, total_trades, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO UPDATE SET
               bot_id = EXCLUDED.bot_id, eval_date = EXCLUDED.eval_date, initial_capital = EXCLUDED.initial_capital,
               eval_assets = EXCLUDED.eval_assets, cumulative_return_pct = EXCLUDED.cumulative_return_pct,
               win_rate = EXCLUDED.win_rate, profit_factor = EXCLUDED.profit_factor, mdd_pct = EXCLUDED.mdd_pct,
               sharpe_ratio = EXCLUDED.sharpe_ratio, total_trades = EXCLUDED.total_trades, created_at = EXCLUDED.created_at`,
            [pl.id, pl.bot_id, pl.eval_date, pl.initial_capital, pl.eval_assets,
             pl.cumulative_return_pct, pl.win_rate, pl.profit_factor, pl.mdd_pct,
             pl.sharpe_ratio, pl.total_trades, pl.created_at]
          );
        }

        // 6. stock_news (last 100)
        const news = db.prepare('SELECT * FROM stock_news ORDER BY id DESC LIMIT 100').all();
        for (const n of news) {
          await client.query(
            `INSERT INTO stock_news (id, title, link, source, published_at, summary, sentiment, keywords, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (link) DO UPDATE SET
               title = EXCLUDED.title, source = EXCLUDED.source, published_at = EXCLUDED.published_at,
               summary = EXCLUDED.summary, sentiment = EXCLUDED.sentiment, keywords = EXCLUDED.keywords`,
            [n.id, n.title, n.link, n.source, n.published_at, n.summary, n.sentiment, n.keywords, n.created_at]
          );
        }

        await client.query('COMMIT');
        this.lastSyncTime = new Date().toISOString();
      } catch (innerErr) {
        await client.query('ROLLBACK');
        throw innerErr;
      } finally {
        client.release();
      }
    } catch (err) {
      this.isConnected = false;
      // Silent error logging to not pollute logs
    }
  }
}
