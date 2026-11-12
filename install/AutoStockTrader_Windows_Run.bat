@echo off
chcp 65001 >nul
title AutoStockTrader - 키움 ⨉ 토스 AI 퀀트 자동매매 시스템

setlocal enabledelayedexpansion
set "INSTALL_DIR=%~dp0"
cd /d "%INSTALL_DIR%"

echo ========================================================
echo  🚀 AutoStockTrader 원클릭 실행 런처 (Windows)
echo ========================================================
echo • 저장소 위치: %INSTALL_DIR%
echo • 백엔드 포트: 8100
echo • 프론트엔드 포트: 9900
echo ========================================================

:: 1. Node.js 설치 확인
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [경고] Node.js 런타임이 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
    echo Node.js v20 이상(v22 권장) 설치가 필요합니다.
    echo 브라우저를 열어 공식 다운로드 페이지로 이동합니다...
    start https://nodejs.org/
    echo.
    echo Node.js 설치 완료 후 이 런처를 다시 실행해 주세요.
    pause
    exit /b 1
)

:: 2. Python 설치 확인
set "PY_CMD=python"
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    where py >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        set "PY_CMD=py"
    ) else (
        echo [경고] Python 실행 환경이 감지되지 않았습니다.
        echo 토스증권 실전 주문 브릿지를 위해 Python 3.12 이상 설치가 권장됩니다.
        echo 다운로드 페이지: https://www.python.org/downloads/
        echo (설치 시 반드시 'Add python.exe to PATH' 체크박스를 선택하세요)
        pause
    )
)

:: 디렉터리 준비
if not exist "app\logs" mkdir "app\logs"
if not exist "app\data" mkdir "app\data"
if not exist "app\config" mkdir "app\config"

:: 3. 초기 설정 마법사 실행 여부 판별
set "SETUP_DONE=0"
if exist "app\.setup_completed" set "SETUP_DONE=1"
if exist ".setup_completed" set "SETUP_DONE=1"

if "%SETUP_DONE%"=="0" (
    echo.
    echo ========================================================
    echo  🪄 최초 실행 감지: Step-by-Step 초기 설정 마법사를 실행합니다
    echo ========================================================
    echo  웹 브라우저 창(http://127.0.0.1:9901)이 자동으로 열립니다.
    echo ========================================================
    echo.
    start "" node setup_wizard\wizard_server.mjs --open
    exit /b 0
)

:: 4. 기존 구동 중인 서비스 정리
call AutoStockTrader_Windows_Stop.bat >nul 2>&1

:: 5. 일반 서비스 기동
echo.
echo [1/3] 백엔드 Node.js 서버 기동 (Port: 8100)...
start /b "" node app\backend\node_server.mjs > app\logs\backend.log 2>&1

echo [2/3] 프론트엔드 웹 대시보드 서버 기동 (Port: 9900)...
start /b "" node app\frontend_server.mjs > app\logs\frontend.log 2>&1

echo [3/3] 거시 LLM 리스크 관리자 워커 기동...
if exist "app\backend\python\llm_filter_worker.py" (
    start /b "" %PY_CMD% app\backend\python\llm_filter_worker.py > app\logs\llm_filter.log 2>&1
)

echo.
echo [헬스체크] 서비스 기동 확인 중...
timeout /t 3 /nobreak >nul

echo ========================================================
echo  ✅ AutoStockTrader 자동매매 시스템이 가동되었습니다!
echo ========================================================
echo  • 웹 대시보드 접속: http://127.0.0.1:9900
echo  • 백엔드 REST API : http://127.0.0.1:8100
echo  • 실행 로그 위치  : app\logs\
echo ========================================================
echo.
start http://127.0.0.1:9900
