#!/usr/bin/env bash
# ========================================================
# KIS AutoStockTrader - 백엔드(8100) & 프론트엔드(9900) 원클릭 구동 스크립트
# ========================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"

# .env 로드
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

BACKEND_PORT="${PORT:-8100}"
FRONTEND_PORT="${FRONTEND_PORT:-9900}"

mkdir -p logs data

echo "========================================================"
echo "🚀 키움(시세) ⨉ 토스(매매) AI 퀀트 자동매매 시스템 구동 시작"
echo "========================================================"
echo "• 시세/조회 엔진 : 키움증권 Open API"
echo "• 주문/매매 엔진 : 토스증권 Open API"
echo "• 백엔드 포트    : $BACKEND_PORT"
echo "• 프론트엔드 포트 : $FRONTEND_PORT"
echo "• 저장소 경로    : $PROJECT_ROOT"
echo "========================================================"

# 기존 구동 중인 프로세스 정리
"$PROJECT_ROOT/stop_services.sh" >/dev/null 2>&1 || true
sleep 1

# 1. 백엔드 실행 (setsid 분리 세션)
echo "[1/2] 백엔드 Node.js 서버 기동 (Port: $BACKEND_PORT)..."
setsid node backend/node_server.mjs </dev/null >> logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > logs/.backend.pid
echo "  -> 백엔드 PID: $BACKEND_PID (로그: logs/backend.log)"

# 2. 프론트엔드 실행 (setsid 분리 세션)
echo "[2/2] 프론트엔드 Vite 개발 서버 기동 (Port: $FRONTEND_PORT)..."
setsid bash -c "cd frontend && ./node_modules/.bin/vite --port $FRONTEND_PORT --host 0.0.0.0" </dev/null >> logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > logs/.frontend.pid
echo "  -> 프론트엔드 PID: $FRONTEND_PID (로그: logs/frontend.log)"

# 3. 비동기 거시 LLM 리스크 관리자 워커 기동 (1시간 주기 / 하루 5~7회, Gemini Free Tier 429 원천 차단)
echo "[3/3] 거시 LLM 리스크 관리자 워커 기동 (llm_filter_worker.py)..."
setsid python3 llm_filter_worker.py </dev/null >> logs/llm_filter.log 2>&1 &
LLM_WORKER_PID=$!
echo "$LLM_WORKER_PID" > logs/.llm_filter.pid
echo "  -> LLM 리스크 워커 PID: $LLM_WORKER_PID (로그: logs/llm_filter.log)"

# 4. 헬스체크
echo ""
echo "[4/4] 서비스 헬스체크 대기 중 (최대 10초)..."
BACKEND_OK=0
for i in {1..20}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null | grep -q "200"; then
        BACKEND_OK=1
        break
    fi
    sleep 0.5
done

FRONTEND_OK=0
for i in {1..20}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$FRONTEND_PORT" 2>/dev/null | grep -q "200"; then
        FRONTEND_OK=1
        break
    fi
    sleep 0.5
done

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
if [ "$BACKEND_OK" -eq 1 ] && [ "$FRONTEND_OK" -eq 1 ]; then
    echo "========================================================"
    echo "✅ 키움(시세) ⨉ 토스(매매) AI 퀀트 시스템이 가동되었습니다!"
    echo "========================================================"
    echo "• 로컬 웹 접속      : http://127.0.0.1:$FRONTEND_PORT"
    echo "• 사내 LAN 웹 접속  : http://$LAN_IP:$FRONTEND_PORT"
    echo "• 백엔드 REST/SSE   : http://127.0.0.1:$BACKEND_PORT"
    echo "• 게이트 입장 코드  : coin (설정 탭에서 변경 가능)"
    echo "--------------------------------------------------------"
    echo "• 외부 접속 (Cloudflare Tunnel):"
    echo "  cloudflared tunnel --url http://127.0.0.1:$FRONTEND_PORT"
    echo "========================================================"
else
    echo "⚠️ 일부 서비스 시작 대기 중입니다. logs/backend.log 및 logs/frontend.log를 확인해주세요."
fi
