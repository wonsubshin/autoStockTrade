#!/usr/bin/env python3
"""
KIS AutoStockTrader - SQLite to PostgreSQL 16 Complete Migration Tool
Supports LOCATION mode from .env:
- LOCATION=local : Connects to local PostgreSQL (LOCAL_PG_HOST / 127.0.0.1)
- LOCATION=outer : Connects to remote PostgreSQL (OUTER_PG_HOST)
"""
import os
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    local_venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
    if local_venv_python.exists() and sys.executable != str(local_venv_python):
        os.execv(str(local_venv_python), [str(local_venv_python)] + sys.argv)
    print("[ERROR] psycopg2-binary가 설치되어 있지 않습니다. pip install psycopg2-binary 를 실행하세요.")
    sys.exit(1)

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
                    if k:
                        os.environ[k] = v

load_env()

LOCATION = os.getenv("LOCATION", "local").strip().lower()
IS_OUTER = LOCATION == "outer"

if IS_OUTER:
    PG_HOST = os.getenv("OUTER_PG_HOST", "")
    PG_PORT = int(os.getenv("OUTER_PG_PORT", os.getenv("PGPORT", "5432")))
    PG_DATABASE = os.getenv("OUTER_PG_DATABASE", "stock")
    PG_USER = os.getenv("OUTER_PG_USER", "stock_trader")
    PG_PASSWORD = os.getenv("OUTER_PG_PASSWORD", "")
else:
    PG_HOST = os.getenv("LOCAL_PG_HOST", "127.0.0.1")
    PG_PORT = int(os.getenv("LOCAL_PG_PORT", os.getenv("PGPORT", "5432")))
    PG_DATABASE = os.getenv("LOCAL_PG_DATABASE", "stock")
    PG_USER = os.getenv("LOCAL_PG_USER", "stock_trader")
    PG_PASSWORD = os.getenv("LOCAL_PG_PASSWORD", "")

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
    provider TEXT,
    model TEXT,
    kospi_index REAL,
    kosdaq_index REAL,
    kospi_20ma REAL,
    kosdaq_60ma REAL,
    regime_status TEXT,
    briefing_text TEXT,
    created_at TEXT,
    kr_index_price REAL,
    kr_daily_20ma REAL,
    kr_intraday_60ma REAL,
    kr_regime_status TEXT DEFAULT 'NORMAL',
    us_index_price REAL,
    us_daily_20ma REAL,
    us_intraday_60ma REAL,
    us_regime_status TEXT DEFAULT 'NORMAL',
    usd_krw_rate REAL,
    trigger_type TEXT DEFAULT 'MANUAL'
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

CREATE TABLE IF NOT EXISTS ai_trade_decisions (
    id SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS market_regime_filter (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sentiment_score REAL DEFAULT 0.0,
    market_regime TEXT DEFAULT 'SIDEWAYS',
    risk_alert INTEGER DEFAULT 0,
    recommended_action TEXT DEFAULT 'NORMAL',
    position_size_multiplier REAL DEFAULT 1.0,
    blacklist_tickers_json TEXT DEFAULT '[]',
    reason TEXT DEFAULT '초기 정상 가동 상태',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

TABLES = [
    ("system_settings", "key", [
        "key", "value", "updated_at"
    ]),
    ("bots", "bot_id", [
        "bot_id", "name", "nickname", "strategy_type", "trade_mode", "description",
        "allocation_ratio", "allocated_capital", "virtual_krw", "is_running",
        "min_volume_krw", "stop_loss_pct", "take_profit_pct", "config_json", "last_status_msg",
        "updated_at", "is_virtual_running", "virtual_initial_capital", "virtual_status_msg",
        "is_real_selected", "is_real_running", "real_allocation_ratio", "real_allocated_capital",
        "real_available_krw", "real_status_msg"
    ]),
    ("trades", "id", [
        "id", "bot_id", "trade_mode", "stock_code", "stock_name", "buy_order_no", "sell_order_no",
        "buy_price", "buy_qty", "buy_amount", "buy_date", "sell_price", "sell_qty", "sell_amount",
        "sell_date", "fee_and_tax", "profit_krw", "profit_pct", "status", "origin_bot_id"
    ]),
    ("bot_positions", "order_no", [
        "id", "bot_id", "trade_mode", "stock_code", "stock_name", "order_no",
        "qty", "avg_buy_price", "buy_amount", "buy_fee", "trade_id", "status",
        "created_at", "closed_at", "origin_bot_id"
    ]),
    ("virtual_performance_logs", "id", [
        "id", "bot_id", "eval_date", "initial_capital", "eval_assets",
        "cumulative_return_pct", "win_rate", "profit_factor", "mdd_pct",
        "sharpe_ratio", "total_trades", "created_at"
    ]),
    ("ai_market_briefings", "id", [
        "id", "provider", "model", "kospi_index", "kosdaq_index", "kospi_20ma", "kosdaq_60ma",
        "regime_status", "briefing_text", "created_at", "kr_index_price", "kr_daily_20ma",
        "kr_intraday_60ma", "kr_regime_status", "us_index_price", "us_daily_20ma",
        "us_intraday_60ma", "us_regime_status", "usd_krw_rate", "trigger_type"
    ]),
    ("stock_news", "link", [
        "id", "title", "link", "source", "published_at", "summary", "sentiment", "keywords", "created_at"
    ]),
    ("ai_news_briefings", "id", [
        "id", "provider", "model", "news_count", "bullish_count", "bearish_count", "neutral_count",
        "briefing_text", "created_at"
    ]),
    ("ai_trade_decisions", "id", [
        "id", "symbol", "stock_name", "market", "action", "confidence", "sentiment_score",
        "reasoning", "suggested_order_type", "executed_by", "execution_status", "order_no", "created_at"
    ]),
    ("market_regime_filter", "id", [
        "id", "sentiment_score", "market_regime", "risk_alert", "recommended_action",
        "position_size_multiplier", "blacklist_tickers_json", "reason", "updated_at"
    ]),
]

def migrate():
    print(f"=== KIS AutoStockTrader SQLite -> PostgreSQL 전체 마이그레이션 ===")
    print(f"• 모드: LOCATION={LOCATION}")
    print(f"• PG 대상: {PG_USER}@{PG_HOST}:{PG_PORT}/{PG_DATABASE}")
    print(f"• SQLite DB: {SQLITE_DB}")

    if not SQLITE_DB.exists():
        print(f"[ERROR] SQLite DB 파일이 존재하지 않습니다: {SQLITE_DB}")
        sys.exit(1)

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
        sys.exit(1)

    sqlite_conn = sqlite3.connect(str(SQLITE_DB))
    sqlite_conn.row_factory = sqlite3.Row

    try:
        with pg_conn.cursor() as pg_cur:
            print("\n1. PostgreSQL 테이블 스키마 초기화...")
            pg_cur.execute(PG_SCHEMA_SQL)
            pg_conn.commit()
            print("   -> 10개 테이블 스키마 생성 및 검증 완료.")

            print("\n2. SQLite 데이터 테이블별 마이그레이션 진행...")
            for table_name, conflict_key, columns in TABLES:
                # SQLite 컬럼 목록 확인 (존재하는 컬럼만 추출)
                s_cur = sqlite_conn.cursor()
                s_cur.execute(f"PRAGMA table_info({table_name});")
                existing_cols = [r[1] for r in s_cur.fetchall()]
                if not existing_cols:
                    print(f"   -> [{table_name}] SQLite에 테이블 없음 (건너뜀)")
                    continue

                valid_cols = [c for c in columns if c in existing_cols]
                col_str = ", ".join(valid_cols)
                s_cur.execute(f"SELECT {col_str} FROM {table_name}")
                rows = s_cur.fetchall()
                if not rows:
                    print(f"   -> [{table_name}] 0건 (비어있음)")
                    continue

                placeholders = ", ".join(["%s"] * len(valid_cols))
                update_cols = [c for c in valid_cols if c != conflict_key]
                if update_cols:
                    update_clause = ", ".join([f"{c} = EXCLUDED.{c}" for c in update_cols])
                    sql = f"""
                        INSERT INTO {table_name} ({col_str})
                        VALUES ({placeholders})
                        ON CONFLICT ({conflict_key}) DO UPDATE SET {update_clause};
                    """
                else:
                    sql = f"""
                        INSERT INTO {table_name} ({col_str})
                        VALUES ({placeholders})
                        ON CONFLICT ({conflict_key}) DO NOTHING;
                    """

                data_tuples = [tuple(row[c] for c in valid_cols) for row in rows]
                execute_batch(pg_cur, sql, data_tuples, page_size=1000)
                pg_conn.commit()
                print(f"   -> [{table_name}] {len(rows):,}건 동기화 완료")

                # SERIAL sequence 업데이트
                if "id" in valid_cols:
                    try:
                        seq_sql = f"""
                            SELECT setval(pg_get_serial_sequence('{table_name}', 'id'),
                                          COALESCE(MAX(id), 1),
                                          MAX(id) IS NOT NULL)
                            FROM {table_name};
                        """
                        pg_cur.execute(seq_sql)
                        pg_conn.commit()
                    except Exception as seq_err:
                        # SERIAL 시퀀스가 없는 테이블(market_regime_filter 등)은 무시
                        pg_conn.rollback()

            print("\n3. 마이그레이션 정합성 검증 (SQLite vs PostgreSQL 건수 비교):")
            all_matched = True
            for table_name, _, _ in TABLES:
                s_cur = sqlite_conn.cursor()
                try:
                    s_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                    s_cnt = s_cur.fetchone()[0]
                except Exception:
                    s_cnt = 0

                pg_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                p_cnt = pg_cur.fetchone()[0]

                match_str = "✅ 일치" if s_cnt == p_cnt else "⚠️ 불일치"
                if s_cnt != p_cnt:
                    all_matched = False
                print(f"   • {table_name:25s} : SQLite({s_cnt:,}건) <-> PG({p_cnt:,}건) [{match_str}]")

            if all_matched:
                print("\n🎉 모든 데이터가 PostgreSQL에 성공적으로 완벽히 이관되었습니다!")
            else:
                print("\n⚠️ 일부 테이블 건수에 차이가 있습니다. 로그를 확인하세요.")

    finally:
        sqlite_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
