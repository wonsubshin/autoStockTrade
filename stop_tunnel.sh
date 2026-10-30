#!/usr/bin/env bash
# ========================================================
# KIS AutoStockTrader - Cloudflare 외부 접속 보안 터널 종료기
# ========================================================
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "========================================================"
echo "🛑 [autoStockTrader] 외부 접속 보안 터널 중지 중..."
echo "========================================================"

PID_FILE="$PROJECT_ROOT/logs/.tunnel.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "• 터널 프로세스 종료 [PID: $PID]..."
        kill "$PID" 2>/dev/null || true
        sleep 0.5
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# 9900 포트를 바인딩하는 특정 cloudflared 프로세스만 타깃 종료 (다른 프로젝트 터널 간섭 방지)
pgrep -f "cloudflared tunnel.*9900" | while read -r p; do
    echo "• 잔여 9900 터널 프로세스 종료 [PID: $p]..."
    kill "$p" 2>/dev/null || true
done

echo "========================================================"
echo "✅ autoStockTrader 외부 접속 터널이 안전하게 종료되었습니다."
echo "========================================================"
