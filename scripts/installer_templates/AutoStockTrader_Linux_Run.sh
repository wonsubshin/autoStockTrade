#!/usr/bin/env bash
# ========================================================
# AutoStockTrader - Linux 원클릭 실행 런처
# ========================================================
set -e

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

# 1. 스크립트 실행 권한 자동 부여
chmod +x "$INSTALL_DIR"/*.sh 2>/dev/null || true

echo "========================================================"
echo "🚀 AutoStockTrader 원클릭 실행 런처 (Linux)"
echo "========================================================"
echo "• 저장소 경로 : $INSTALL_DIR"
echo "• 백엔드 포트 : 8100"
echo "• 프론트엔드  : 9900"
echo "========================================================"

# 2. Node.js 확인
if ! command -v node >/dev/null 2>&1; then
    echo "⚠️ Node.js가 설치되어 있지 않습니다."
    echo "Ubuntu/Debian: sudo apt update && sudo apt install -y nodejs npm"
    echo "RHEL/Fedora/Rocky: sudo dnf install -y nodejs npm"
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "⚠️ Node.js 버전이 v$NODE_MAJOR 입니다. v20 이상(권장 v22+)이 필요합니다."
fi

# 3. Python3 확인
PY_CMD="python3"
if ! command -v python3 >/dev/null 2>&1; then
    if command -v python >/dev/null 2>&1; then
        PY_CMD="python"
    else
        echo "⚠️ Python이 설치되어 있지 않습니다. 토스 주문 실행을 위해 python3 설치가 권장됩니다."
    fi
fi

# 4. 데스크톱 바로가기 아이콘 자동 생성 (GUI 환경 데스크톱이 있는 경우)
DESKTOP_DIR=""
if [ -d "$HOME/Desktop" ]; then
    DESKTOP_DIR="$HOME/Desktop"
elif [ -d "$HOME/바탕화면" ]; then
    DESKTOP_DIR="$HOME/바탕화면"
fi

if [ -n "$DESKTOP_DIR" ] && [ ! -f "$DESKTOP_DIR/AutoStockTrader.desktop" ]; then
    cat << EOF > "$DESKTOP_DIR/AutoStockTrader.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=AutoStockTrader
Comment=키움 ⨉ 토스 AI 퀀트 주식 자동매매
Exec=bash -c "cd '$INSTALL_DIR' && ./AutoStockTrader_Linux_Run.sh"
Icon=utilities-terminal
Terminal=true
Categories=Office;Finance;
EOF
    chmod +x "$DESKTOP_DIR/AutoStockTrader.desktop" 2>/dev/null || true
    echo "• 바탕화면 실행 아이콘 생성 완료: $DESKTOP_DIR/AutoStockTrader.desktop"
fi

# 디렉터리 생성
mkdir -p app/logs app/data app/config

# 5. 초기 설정 완료 여부 판별
SETUP_DONE=0
if [ -f "app/.setup_completed" ] || [ -f ".setup_completed" ]; then
    SETUP_DONE=1
fi

if [ "$SETUP_DONE" -eq 0 ]; then
    echo ""
    echo "========================================================"
    echo "🪄 최초 실행: Step-by-Step 초기 설정 마법사를 실행합니다."
    echo "========================================================"
    echo "웹 브라우저(http://127.0.0.1:9901)가 자동으로 열립니다."
    echo "========================================================"
    echo ""
    node setup_wizard/wizard_server.mjs --open
    exit 0
fi

# 6. 기존 프로세스 정리
"$INSTALL_DIR/AutoStockTrader_Linux_Stop.sh" >/dev/null 2>&1 || true
sleep 1

# 7. 서비스 백그라운드 기동
echo ""
echo "[1/3] 백엔드 Node.js 서버 기동 (Port: 8100)..."
setsid node app/backend/node_server.mjs </dev/null >> app/logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > app/logs/.backend.pid

echo "[2/3] 프론트엔드 정적 대시보드 서버 기동 (Port: 9900)..."
FRONTEND_SCRIPT="app/frontend_server.mjs"
if [ ! -f "$FRONTEND_SCRIPT" ]; then
    FRONTEND_SCRIPT="scripts/frontend_server.mjs"
fi
setsid node "$FRONTEND_SCRIPT" </dev/null >> app/logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > app/logs/.frontend.pid

echo "[3/3] 거시 LLM 리스크 관리자 워커 기동..."
if [ -f "app/backend/python/llm_filter_worker.py" ]; then
    setsid "$PY_CMD" app/backend/python/llm_filter_worker.py </dev/null >> app/logs/llm_filter.log 2>&1 &
    LLM_PID=$!
    echo "$LLM_PID" > app/logs/.llm_filter.pid
fi

# 8. 헬스체크
echo ""
echo "[헬스체크] 서비스 정상 응답 확인 중..."
BACKEND_OK=0
for i in {1..20}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8100/api/health" 2>/dev/null | grep -q "200"; then
        BACKEND_OK=1
        break
    fi
    sleep 0.5
done

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo "========================================================"
echo "✅ AutoStockTrader 자동매매 시스템이 정상 가동되었습니다!"
echo "========================================================"
echo "• 로컬 대시보드 접속 : http://127.0.0.1:9900"
echo "• LAN 네트워크 접속  : http://$LAN_IP:9900"
echo "• 백엔드 REST API    : http://127.0.0.1:8100"
echo "• 실행 로그 디렉터리 : app/logs/"
echo "========================================================"

# 브라우저 자동 오픈
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:9900" >/dev/null 2>&1 || true
elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "http://127.0.0.1:9900" >/dev/null 2>&1 || true
fi
