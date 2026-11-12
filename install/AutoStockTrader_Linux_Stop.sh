#!/usr/bin/env bash
# ========================================================
# AutoStockTrader - Linux 서비스 안전 종료 스크립트
# ========================================================
set -e

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

echo "========================================================"
echo "🛑 AutoStockTrader 서비스 안전 종료 중..."
echo "========================================================"

# PID 파일 기반 종료
for pid_file in app/logs/.backend.pid app/logs/.frontend.pid app/logs/.llm_filter.pid logs/.backend.pid logs/.frontend.pid logs/.llm_filter.pid; do
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
fuser -k -n tcp 8100 2>/dev/null || true
fuser -k -n tcp 9900 2>/dev/null || true
fuser -k -n tcp 9901 2>/dev/null || true

echo "========================================================"
echo "✅ 모든 서비스(8100, 9900, 마법사 9901)가 안전하게 종료되었습니다."
echo "========================================================"
