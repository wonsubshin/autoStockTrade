#!/usr/bin/env python3
"""
KIS AutoStockTrader - SQLite to PostgreSQL 16 Migration Tool
Supports LOCATION mode from .env:
- LOCATION=local : Connects to local PostgreSQL (LOCAL_PG_HOST / 127.0.0.1)
- LOCATION=outer : Connects to remote PostgreSQL (OUTER_PG_HOST / 218.234.55.78)
"""
import os
import sqlite3
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_batch
except ImportError:
    # Check if autoCoinTrade venv exists and re-exec with that python if available
    auto_venv_python = Path("/home/asura/dev/sourceCode/autoCoinTrade/.venv/bin/python3")
    if auto_venv_python.exists() and sys.executable != str(auto_venv_python):
        os.execv(str(auto_venv_python), [str(auto_venv_python)] + sys.argv)
    print("[ERROR] psycopg2-binary가 설치되어 있지 않습니다. pip install psycopg2-binary 를 실행하세요.")
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SQLITE_DB = PROJECT_ROOT / "data" / "auto_stock_trade.db"
ENV_PATH = PROJECT_ROOT / ".env"

def load_env():
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    if k and (k not in os.environ or os.environ[k] == ""):
                        os.environ[k] = v

load_env()

LOCATION = os.getenv("LOCATION", "local").strip().lower()
IS_OUTER = LOCATION == "outer"

if IS_OUTER:
    PG_HOST = os.getenv("OUTER_PG_HOST", "218.234.55.78")
    PG_PORT = int(os.getenv("OUTER_PG_PORT", "5432"))
    PG_DATABASE = os.getenv("OUTER_PG_DATABASE", "stock_trader")
    PG_USER = os.getenv("OUTER_PG_USER", "stock_trader")
    PG_PASSWORD = os.getenv("OUTER_PG_PASSWORD", "stock123$%^")
else:
    PG_HOST = os.getenv("LOCAL_PG_HOST", "127.0.0.1")
    PG_PORT = int(os.getenv("LOCAL_PG_PORT", "5432"))
    PG_DATABASE = os.getenv("LOCAL_PG_DATABASE", "stock_trader")
    PG_USER = os.getenv("LOCAL_PG_USER", "stock_trader")
    PG_PASSWORD = os.getenv("LOCAL_PG_PASSWORD", "stock123$%^")

PG_SCHEMA_SQL = """
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
    allocated_capital BIGINT,
    virtual_krw BIGINT,
    is_running INTEGER,
    min_volume_krw BIGINT,
    stop_loss_pct REAL,
    take_profit_pct REAL,
    config_json TEXT,
    last_status_msg TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    bot_id TEXT,
    trade_mode TEXT DEFAULT 'VIRTUAL',
    stock_code TEXT,
    stock_name TEXT,
    buy_order_no TEXT,
    sell_order_no TEXT,
    buy_price BIGINT,
    buy_qty INTEGER,
    buy_amount BIGINT,
    buy_date TEXT,
    sell_price BIGINT,
    sell_qty INTEGER,
    sell_amount BIGINT,
    sell_date TEXT,
    fee_and_tax BIGINT,
    profit_krw BIGINT,
    profit_pct REAL,
    status TEXT DEFAULT 'HOLDING'
);

CREATE TABLE IF NOT EXISTS bot_positions (
    id SERIAL PRIMARY KEY,
    bot_id TEXT,
    trade_mode TEXT DEFAULT 'VIRTUAL',
    stock_code TEXT,
    stock_name TEXT,
    order_no TEXT UNIQUE,
    qty INTEGER,
    avg_buy_price BIGINT,
    buy_amount BIGINT,
    buy_fee BIGINT,
    trade_id INTEGER,
    status TEXT DEFAULT 'OPEN',
    created_at TEXT,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS virtual_performance_logs (
    id SERIAL PRIMARY KEY,
    bot_id TEXT,
    eval_date TEXT,
    initial_capital BIGINT,
    eval_assets BIGINT,
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
"""

TABLES = [
    ("system_settings", "key", ["key", "value", "updated_at"]),
    ("bots", "bot_id", ["bot_id", "name", "nickname", "strategy_type", "trade_mode", "description",
                        "allocation_ratio", "allocated_capital", "virtual_krw", "is_running",
                        "min_volume_krw", "stop_loss_pct", "take_profit_pct", "config_json", "last_status_msg", "updated_at"]),
    ("trades", "id", ["id", "bot_id", "trade_mode", "stock_code", "stock_name", "buy_order_no", "sell_order_no",
                      "buy_price", "buy_qty", "buy_amount", "buy_date", "sell_price", "sell_qty", "sell_amount",
                      "sell_date", "fee_and_tax", "profit_krw", "profit_pct", "status"]),
    ("bot_positions", "order_no", ["id", "bot_id", "trade_mode", "stock_code", "stock_name", "order_no",
                                   "qty", "avg_buy_price", "buy_amount", "buy_fee", "trade_id", "status",
                                   "created_at", "closed_at"]),
    ("virtual_performance_logs", "id", ["id", "bot_id", "eval_date", "initial_capital", "eval_assets",
                                        "cumulative_return_pct", "win_rate", "profit_factor", "mdd_pct",
                                        "sharpe_ratio", "total_trades", "created_at"]),
    ("ai_market_briefings", "id", ["id", "provider", "model", "kospi_index", "kosdaq_index",
                                   "kospi_20ma", "kosdaq_60ma", "regime_status", "briefing_text", "created_at"]),
    ("stock_news", "link", ["id", "title", "link", "source", "published_at", "summary", "sentiment", "keywords", "created_at"]),
    ("ai_news_briefings", "id", ["id", "provider", "model", "news_count", "bullish_count", "bearish_count",
                                 "neutral_count", "briefing_text", "created_at"]),
]

def migrate():
    print(f"=== KIS AutoStockTrader SQLite -> PostgreSQL 마이그레이션 ===")
    print(f"• 모드: LOCATION={LOCATION}")
    print(f"• PG 대상: {PG_USER}@{PG_HOST}:{PG_PORT}/{PG_DATABASE}")
    print(f"• SQLite DB: {SQLITE_DB}")

    if not SQLITE_DB.exists():
        print(f"[WARN] SQLite DB 파일이 아직 존재하지 않습니다: {SQLITE_DB}")
        return

    try:
        pg_conn = psycopg2.connect(
            host=PG_HOST,
            port=PG_PORT,
            dbname=PG_DATABASE,
            user=PG_USER,
            password=PG_PASSWORD,
            connect_timeout=5
        )
        pg_conn.autocommit = False
    except Exception as e:
        print(f"[ERROR] PostgreSQL 연결 실패: {e}")
        return

    sqlite_conn = sqlite3.connect(str(SQLITE_DB))
    sqlite_conn.row_factory = sqlite3.Row

    try:
        with pg_conn.cursor() as pg_cur:
            print("1. PostgreSQL 테이블 스키마 초기화...")
            pg_cur.execute(PG_SCHEMA_SQL)
            pg_conn.commit()
            print("   -> 스키마 적용 완료")

            for table_name, conflict_key, columns in TABLES:
                # Check if table exists in SQLite
                s_cur = sqlite_conn.cursor()
                s_cur.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
                if not s_cur.fetchone():
                    continue

                col_str = ", ".join(columns)
                s_cur.execute(f"SELECT {col_str} FROM {table_name}")
                rows = s_cur.fetchall()
                if not rows:
                    print(f"   -> [{table_name}] 0건 건너뜀")
                    continue

                placeholders = ", ".join(["%s"] * len(columns))
                update_cols = [c for c in columns if c != conflict_key and c != "id"]
                if update_cols:
                    update_clause = ", ".join([f"{c} = EXCLUDED.{c}" for c in update_cols])
                    upsert_sql = f"""
                    INSERT INTO {table_name} ({col_str})
                    VALUES ({placeholders})
                    ON CONFLICT ({conflict_key}) DO UPDATE SET {update_clause}
                    """
                else:
                    upsert_sql = f"""
                    INSERT INTO {table_name} ({col_str})
                    VALUES ({placeholders})
                    ON CONFLICT ({conflict_key}) DO NOTHING
                    """

                data = [tuple(r[c] for c in columns) for r in rows]
                execute_batch(pg_cur, upsert_sql, data)
                pg_conn.commit()

                # Adjust sequence if serial id exists
                if "id" in columns:
                    try:
                        pg_cur.execute(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), COALESCE(MAX(id), 1)) FROM {table_name}")
                        pg_conn.commit()
                    except Exception:
                        pg_conn.rollback()

                print(f"   -> [{table_name}] {len(rows)}건 마이그레이션/동기화 완료")

        print("========================================================")
        print("[SUCCESS] 전체 SQLite 데이터의 PostgreSQL 마이그레이션 완료!")
        print("========================================================")
    except Exception as e:
        pg_conn.rollback()
        print(f"[ERROR] 마이그레이션 중 오류 발생: {e}")
    finally:
        sqlite_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
