"""
init_db.py - PostgreSQL 16 데이터베이스 연결 및 초기화 모듈 (Python)
- SQLite 완전 제거 및 PostgreSQL 16 전용
- LLM 시장 체제 & 감성 필터 상태 테이블 (market_regime_filter, id=1 단일 행)
"""

import logging
import os
from pathlib import Path
from typing import Optional

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    import sys
    auto_venv_python = Path("/home/asura/dev/sourceCode/autoCoinTrade/.venv/bin/python3")
    if auto_venv_python.exists() and sys.executable != str(auto_venv_python):
        os.execv(str(auto_venv_python), [str(auto_venv_python)] + sys.argv)
    raise

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("init_db")

PROJECT_ROOT = Path(__file__).resolve().parent
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
    """
    PostgreSQL 데이터베이스 커넥션을 생성하여 반환합니다.
    RealDictCursor를 적용하여 dict/row 형태 접근을 지원합니다.
    """
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


def init_database(db_path: Optional[str] = None) -> None:
    """
    market_regime_filter 테이블을 확인하고 id=1 기본 행을 시딩합니다.
    """
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
        logger.info("PostgreSQL market_regime_filter 테이블 초기화 완료")
    except Exception as exc:
        logger.error("DB 초기화 실패: %s", exc)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    init_database()
