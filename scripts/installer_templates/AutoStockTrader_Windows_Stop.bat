@echo off
chcp 65001 >nul
title AutoStockTrader - 서비스 안전 종료

echo ========================================================
echo  🛑 AutoStockTrader 자동매매 서비스 종료 중...
echo ========================================================

:: PowerShell을 사용하여 8100, 9900 포트를 점유 중인 프로세스 종료
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ports = @(8100, 9900, 9901); foreach ($p in $ports) { try { $pids = (Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue).OwningProcess; foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host ('• 포트 ' + $p + ' 점유 프로세스(PID: ' + $procId + ') 종료') } } catch {} }"

:: Python LLM 워커 및 백엔드 잔여 프로세스 방어 종료
taskkill /F /IM node.exe /FI "WINDOWTITLE eq AutoStockTrader*" >nul 2>&1

echo ========================================================
echo  ✅ 모든 서비스(8100, 9900, 마법사 9901)가 안전하게 종료되었습니다.
echo ========================================================
timeout /t 2 >nul
