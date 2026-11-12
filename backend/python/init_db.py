"""
init_db.py - SQLite (내장 WAL 모드) & PostgreSQL 16 듀얼 모드 데이터베이스 연결 및 초기화 모듈 (Python)
- DB_MODE=SQLITE_ONLY (기본/초간편): Python 내장 sqlite3 모듈 사용, data/auto_stock_trade.db 연결
- DB_MODE=POSTGRESQL (고급): psycopg2를 통한 PostgreSQL 16 연결
- LLM 시장 체제 & 감성 필터 상태 테이블 (market_regime_filter, id=1 단일 행)
"""

import logging
import os
import sqlite3
import sys
from pathlib import Path
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("init_db")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
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
                    if k and k not in os.environ:
                        os.environ[k] = v


load_env()


class SqliteCursorWrapper:
    def __init__(self, cur):
        self.cur = cur

    def execute(self, sql, params=None):
        sql = sql.replace("%s", "?")
        if params is None:
            return self.cur.execute(sql)
        return self.cur.execute(sql, tuple(params))

    def fetchall(self):
        return [dict(r) for r in self.cur.fetchall()]

    def fetchone(self):
        r = self.cur.fetchone()
        return dict(r) if r else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


class SqliteConnectionWrapper:
    def __init__(self, conn):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.autocommit = True

    def cursor(self):
        return SqliteCursorWrapper(self.conn.cursor())

    def commit(self):
        self.conn.commit()

    def close(self):
        try:
            self.conn.commit()
        except Exception:
            pass
        self.conn.close()


def get_pg_config():
    location = os.getenv("LOCATION", "local").strip().lower()
    if location == "outer":
        return {
            "host": os.getenv("OUTER_PG_HOST", ""),
            "port": int(os.getenv("OUTER_PG_PORT", os.getenv("PGPORT", "5432"))),
            "dbname": os.getenv("OUTER_PG_DATABASE", "stock"),
            "user": os.getenv("OUTER_PG_USER", "stock_trader"),
            "password": os.getenv("OUTER_PG_PASSWORD", ""),
        }
    return {
        "host": os.getenv("LOCAL_PG_HOST", "127.0.0.1"),
        "port": int(os.getenv("LOCAL_PG_PORT", os.getenv("PGPORT", "5432"))),
        "dbname": os.getenv("LOCAL_PG_DATABASE", "stock"),
        "user": os.getenv("LOCAL_PG_USER", "stock_trader"),
        "password": os.getenv("LOCAL_PG_PASSWORD", ""),
    }


def get_db_connection(db_path: Optional[str] = None):
    db_mode = os.getenv("DB_MODE", "").strip().upper()

    # 1. SQLite 전용 모드인 경우
    if db_mode in ("SQLITE_ONLY", "SQLITE") or not os.getenv("LOCAL_PG_PASSWORD") and db_mode != "POSTGRESQL":
        target_path = Path(db_path) if db_path else PROJECT_ROOT / "data" / "auto_stock_trade.db"
        target_path.parent.mkdir(parents=True, exist_ok=True)
        raw_conn = sqlite3.connect(str(target_path))
        raw_conn.execute("PRAGMA journal_mode = WAL;")
        raw_conn.execute("PRAGMA synchronous = NORMAL;")
        return SqliteConnectionWrapper(raw_conn)

    # 2. PostgreSQL 모드
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        cfg = get_pg_config()
        conn = psycopg2.connect(
            host=cfg["host"],
            port=cfg["port"],
            dbname=cfg["dbname"],
            user=cfg["user"],
            password=cfg["password"],
            cursor_factory=RealDictCursor,
            connect_timeout=5,
        )
        conn.autocommit = True
        return conn
    except Exception as pg_err:
        if db_mode != "POSTGRESQL":
            logger.warning("PostgreSQL 연결 불가(%s). 내장 SQLite로 안전 폴백합니다.", pg_err)
            target_path = Path(db_path) if db_path else PROJECT_ROOT / "data" / "auto_stock_trade.db"
            target_path.parent.mkdir(parents=True, exist_ok=True)
            raw_conn = sqlite3.connect(str(target_path))
            raw_conn.execute("PRAGMA journal_mode = WAL;")
            raw_conn.execute("PRAGMA synchronous = NORMAL;")
            return SqliteConnectionWrapper(raw_conn)
        raise


def init_database(db_path: Optional[str] = None) -> None:
    conn = get_db_connection(db_path)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
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
                """
            )
            cur.execute(
                """
                INSERT INTO market_regime_filter (
                    id, sentiment_score, market_regime, risk_alert, recommended_action,
                    position_size_multiplier, blacklist_tickers_json, reason, updated_at
                )
                VALUES (1, 0.0, 'SIDEWAYS', 0, 'NORMAL', 1.0, '[]', '초기 정상 가동 상태', CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO NOTHING;
                """
            )
        logger.info("market_regime_filter 테이블 초기화 완료")
    except Exception as exc:
        logger.error("DB 초기화 실패: %s", exc)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    init_database()
