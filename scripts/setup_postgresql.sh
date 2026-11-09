#!/usr/bin/env bash
# ========================================================
# PostgreSQL 16 - stock_trader DB 및 외부 접속 자동 설정 스크립트
# ========================================================
set -e

if [ "$EUID" -ne 0 ]; then
    echo "[ERROR] 이 스크립트는 root 권한(sudo)으로 실행해야 합니다." >&2
    echo "실행 방법: sudo ./scripts/setup_postgresql.sh" >&2
    exit 1
fi

echo "========================================================"
echo "[1/4] PostgreSQL 16 설정 파일(pg_hba.conf, postgresql.conf) 위치 탐색..."
echo "========================================================"

PG_DATA="/var/lib/pgsql/data"
if [ ! -d "$PG_DATA" ]; then
    PG_DATA=$(find /var/lib/pgsql -name "pg_hba.conf" -exec dirname {} \; 2>/dev/null | head -n 1)
fi
if [ -z "$PG_DATA" ] || [ ! -f "$PG_DATA/pg_hba.conf" ]; then
    PG_DATA=$(find /etc/postgresql -name "pg_hba.conf" -exec dirname {} \; 2>/dev/null | head -n 1)
fi

if [ -z "$PG_DATA" ] || [ ! -f "$PG_DATA/pg_hba.conf" ]; then
    echo "[WARN] PostgreSQL 데이터 디렉터리를 직접 찾지 못했습니다. 기본 psql 설정만 진행합니다."
else
    echo "  -> PG DATA 경로: $PG_DATA"

    # 1. postgresql.conf listen_addresses = '*' 설정
    echo ""
    echo "[2/4] 외부/원격 접속 허용 설정 (listen_addresses = '*')..."
    PG_CONF="$PG_DATA/postgresql.conf"
    if [ -f "$PG_CONF" ]; then
        if grep -qE "^\s*listen_addresses\s*=" "$PG_CONF"; then
            sed -i "s/^\s*listen_addresses\s*=.*/listen_addresses = '*'/" "$PG_CONF"
        else
            echo "listen_addresses = '*'" >> "$PG_CONF"
        fi
        echo "  [OK] listen_addresses = '*' 설정 완료"
    fi

    # 2. pg_hba.conf scram-sha-256 적용 및 외부 허용
    echo ""
    echo "[3/4] pg_hba.conf 인증 방식 scram-sha-256 확인..."
    HBA_CONF="$PG_DATA/pg_hba.conf"
    if [ -f "$HBA_CONF" ]; then
        if ! grep -q "0.0.0.0/0" "$HBA_CONF"; then
            echo "# Allow external password authentication for stock_trader" >> "$HBA_CONF"
            echo "host    all             all             0.0.0.0/0               scram-sha-256" >> "$HBA_CONF"
            echo "host    all             all             ::/0                    scram-sha-256" >> "$HBA_CONF"
            echo "  [OK] 외부 접속(0.0.0.0/0, ::/0) scram-sha-256 규칙 추가 완료"
        fi
    fi

    # PostgreSQL 서비스 재기동 시도
    systemctl restart postgresql 2>/dev/null || systemctl restart postgresql-16 2>/dev/null || true
fi

# .env 로드 시도
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    ENV_PASS=$(grep -E "^LOCAL_PG_PASSWORD=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d ' "\r\n')
    ENV_PORT=$(grep -E "^LOCAL_PG_PORT=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d ' "\r\n')
fi
DB_PASSWORD="${LOCAL_PG_PASSWORD:-${ENV_PASS:-stock123$%^}}"
DB_PORT="${LOCAL_PG_PORT:-${ENV_PORT:-5432}}"

# 3. stock_trader 계정 및 DB 생성
echo ""
echo "[4/4] PostgreSQL 'stock_trader' 유저 및 'stock' 데이터베이스 생성..."
sudo -u postgres psql << EOSQL
DO
\$do\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'stock_trader') THEN
      CREATE ROLE stock_trader WITH LOGIN ENCRYPTED PASSWORD '$DB_PASSWORD';
   ELSE
      ALTER ROLE stock_trader WITH ENCRYPTED PASSWORD '$DB_PASSWORD';
   END IF;
END
\$do\$;

SELECT 'CREATE DATABASE stock OWNER stock_trader'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'stock')\gexec

GRANT ALL PRIVILEGES ON DATABASE stock TO stock_trader;
ALTER DATABASE stock OWNER TO stock_trader;
\c stock
GRANT ALL ON SCHEMA public TO stock_trader;
ALTER SCHEMA public OWNER TO stock_trader;
EOSQL

echo ""
echo "========================================================"
echo "[SUCCESS] PostgreSQL stock_trader 계정 및 DB 구성 완료!"
echo "========================================================"
echo "• Database : stock"
echo "• User     : stock_trader"
echo "• Port     : $DB_PORT"
echo "• Host     : 127.0.0.1 (로컬) / \${OUTER_PG_HOST:-<원격호스트>} (원격)"
echo "========================================================"

