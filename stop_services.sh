#!/usr/bin/env bash
# ========================================================
# KIS AutoStockTrader - 서비스 안전 종료 스크립트
# ========================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

BACKEND_PORT="${PORT:-8100}"
FRONTEND_PORT="${FRONTEND_PORT:-9900}"

echo "========================================================"
echo "🛑 KIS AI Quant 자동매매 서비스 종료 중..."
echo "========================================================"

# PID 종료
for pid_file in logs/.backend.pid logs/backend.pid logs/.frontend.pid logs/frontend.pid; do
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file" 2>/dev/null || true)
        if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
            echo "• 프로세스 종료 (PID: $PID)..."
            kill "$PID" 2>/dev/null || true
        fi
        rm -f "$pid_file"
    fi
done

# 포트 기준 잔여 프로세스 방어 종료
fuser -k -n tcp "$BACKEND_PORT" 2>/dev/null || true
fuser -k -n tcp "$FRONTEND_PORT" 2>/dev/null || true

echo "========================================================"
echo "✅ 모든 서비스(백엔드: $BACKEND_PORT, 프론트엔드: $FRONTEND_PORT)가 안전하게 종료되었습니다."
echo "========================================================"
