#!/usr/bin/env bash
# ========================================================
# KIS AutoStockTrader - Cloudflare 외부 접속 보안 터널 실행기
# ========================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"
mkdir -p logs

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[ERROR] cloudflared가 설치되어 있지 않습니다." >&2
    exit 1
fi

if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

FRONTEND_PORT="${FRONTEND_PORT:-9900}"

# 기존 autoStockTrader 터널 종료
"$PROJECT_ROOT/stop_tunnel.sh" >/dev/null 2>&1 || true
sleep 1

echo "========================================================"
echo "🌐 [autoStockTrader] 외부 인터넷 접속 보안 터널 시작 중..."
echo "========================================================"
echo "• 로컬 포트 : http://127.0.0.1:$FRONTEND_PORT"

LOG_FILE="$PROJECT_ROOT/logs/tunnel.log"
rm -f "$LOG_FILE"

# IPv6 충돌 방지를 위해 반드시 http://127.0.0.1:$FRONTEND_PORT로 바인딩
setsid cloudflared tunnel --url "http://127.0.0.1:$FRONTEND_PORT" </dev/null >> "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$PROJECT_ROOT/logs/.tunnel.pid"

echo "공개 HTTPS 도메인 발급 대기 중..."
PUBLIC_URL=""
for i in {1..25}; do
    if [ -f "$LOG_FILE" ]; then
        PUBLIC_URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" "$LOG_FILE" | head -n 1 || true)
        if [ -n "$PUBLIC_URL" ]; then
            break
        fi
    fi
    sleep 1
done

echo ""
echo "========================================================"
if [ -n "$PUBLIC_URL" ]; then
    echo "🎉 [SUCCESS] 외부 어디서나 접속 가능한 보안 HTTPS 주소 발급 완료!"
    echo "========================================================"
    echo "• 외부 접속 HTTPS 주소 : $PUBLIC_URL"
    echo "• 게이트 입장 코드     : sws@2129"
    echo "• 터널 프로세스 PID    : $TUNNEL_PID"
    echo "• 터널 종료 명령어     : ./stop_tunnel.sh"
    echo "• 터널 실시간 로그     : tail -f logs/tunnel.log"
    echo "========================================================"
else
    echo "⚠️ 공개 도메인 주소 파싱 중입니다. 잠시 후 logs/tunnel.log를 확인해주세요:"
    echo "tail -n 20 logs/tunnel.log"
fi

