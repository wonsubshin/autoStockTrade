# 🇰🇷 키움증권(시세조회) ⨉ 토스증권(주문체결) 기반 다중 전략 국내주식 자동매매 & 가상매매 AI 퀀트 시스템

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Version](https://img.shields.io/badge/Version-v0.0.7-orange.svg)](history.md)
[![Changelog](https://img.shields.io/badge/Changelog-history.md-blueviolet.svg)](history.md)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

> **국내주식 시세 및 호가 조회는 키움증권 Open API**, **실전 주문 및 잔고 관리는 토스증권 Open API**를 연동한 하이브리드 고성능 국내주식 실전/가상 자동매매 & 실시간 AI 증시 인텔리전스 시스템  
> *(Backend + Frontend + Dual DB + Virtual Paper Trading Engine + Gemini LLM Risk Filter + Multi-Channel Notification + Network Tunnel)*

---

## 🚀 0. [비개발자용] 크로스 플랫폼(Windows / Linux) 원클릭 배포 패키지 (`/install`)

비개발자(일반 사용자)도 복잡한 빌드나 명령어 입력 없이 **`/install` 폴더 하나만 전달받으면 Windows와 Linux 어디서든 더블클릭 한 번으로 즉시 구동**할 수 있습니다.

```text
autoStockTrader/
└── install/                                  # [완전 독립형 배포 패키지] 이 폴더만 압축해서 전달하면 즉시 구동 가능
    ├── AutoStockTrader_Windows_Run.bat       # Windows 원클릭 설치 & 실행 런처 (더블클릭 실행)
    ├── AutoStockTrader_Windows_Stop.bat      # Windows 서비스 일괄 안전 종료 스크립트
    ├── AutoStockTrader_Linux_Run.sh          # Linux 원클릭 설치 & 실행 런처 (바탕화면 아이콘 자동 생성)
    ├── AutoStockTrader_Linux_Stop.sh         # Linux 서비스 일괄 안전 종료 스크립트
    ├── Dockerfile                            # 독립형 컨테이너 빌드 파일
    ├── docker-compose.yml                    # 독립형 컨테이너 오케스트레이션 정의 파일
    ├── README_INSTALL.txt                    # 비개발자용 1분 퀵스타트 안내서
    ├── setup_wizard/                         # 최초 실행 시 자동으로 뜨는 Step-by-Step 설정 마법사
    │   ├── wizard_server.mjs                 # 마법사 전용 경량 백엔드 (포트 9901)
    │   └── wizard_ui.html                    # 반응형 다크 테마 온보딩 인터페이스
    └── app/                                  # 자급자족(Self-Contained) 코어 애플리케이션
        ├── backend/                          # 백엔드 엔진 & Python 토스 주문 브릿지
        ├── frontend_dist/                    # 사전 빌드된 React 웹 대시보드 정적 에셋 (9900 포트 서빙)
        ├── frontend_server.mjs               # Node.js 내장 정적 서빙 & 리버스 프록시 서버
        ├── config/                           # broker_config.json 저장 위치
        ├── data/                             # 내장 SQLite DB(auto_stock_trade.db) 영구 저장 위치
        └── logs/                             # 실행 로그 저장 위치
```

### 📋 1) 사전 준비 사항
1. **Node.js 런타임 (v20 이상 설치 권장, v22 LTS 추천)**
   - [공식 다운로드 링크 (https://nodejs.org)](https://nodejs.org)
   - 설치 프로그램(MSI/PKG/RPM)을 기본값으로 설치합니다.
2. **Python 3.10 이상 (Python 3.12 권장)**
   - [공식 다운로드 링크 (https://www.python.org/downloads)](https://www.python.org/downloads/)
   - ⚠️ **Windows 사용자 필수 주의**: 설치 첫 화면 하단의 **`Add python.exe to PATH`** 체크박스를 반드시 선택하고 설치하세요.
3. **증권사 및 AI API 키 발급처 (마법사 또는 대시보드 환경설정에서 등록)**
   - **키움증권 Open API (국내 실시간 시세/호가용)**: [키움 Open API 서비스 포털](https://openapi.kiwoom.com) *(미보유 시 시뮬레이션 호가 모드로 즉시 체험 가능)*
   - **토스증권 Open API (국내/미국 실전 주문 및 잔고용)**: [토스 개발자 센터](https://openapi.tossinvest.com)
   - **Google Gemini API Key (뉴스 감성 분석 & 퀀트 리스크 제어용)**: [Google AI Studio (무료 발급)](https://aistudio.google.com)

### 🖥️ 2) 운영체제별 원클릭 실행 방법
- **Windows 환경**:
  1. `/install` 폴더 내의 `AutoStockTrader_Windows_Run.bat` 파일을 더블클릭합니다.
  2. 최초 실행 시 웹 브라우저에 **Step-by-Step 설정 마법사 창(http://127.0.0.1:9901)**이 자동으로 열립니다.
  3. 마법사 설정을 마치면 백엔드(8100)와 프론트엔드(9900)가 자동 기동되며 메인 대시보드로 이동합니다.
- **Linux 환경**:
  1. 터미널에서 `./AutoStockTrader_Linux_Run.sh`를 실행하거나 바탕화면에 자동 생성된 `AutoStockTrader` 바로가기 아이콘을 더블클릭합니다.
  2. 브라우저에서 마법사를 완료하면 자동으로 `http://127.0.0.1:9900` 대시보드로 연결됩니다.

### 🗄️ 3) 데이터베이스(DB) 선택 기준 (마법사 2단계)
- 🟢 **`[DB 서버 없음 (추천 · 기본값)] - 내장 SQLite 사용`**:
  - 별도의 데이터베이스 서버 설치 없이도 PC 내부 파일(`data/auto_stock_trade.db`, WAL 초고속 모드)로 모든 거래 내역과 11대 퀀트 봇 데이터를 안전하게 보관합니다.
  - 외부 DB 설치 및 접속 계정 관리 부담이 없어 **일반 사용자에게 강력히 권장**합니다.
- 🔵 **`[DB 서버 있음 (고급)] - 외부/로컬 PostgreSQL 16 서버 연동`**:
  - 이미 PostgreSQL 데이터베이스를 보유 중인 경우 호스트, 포트, 계정을 입력하고 `[🔌 접속 테스트 및 테이블 자동 생성]`을 클릭하면 핵심 테이블과 시드 데이터를 자동 생성하고 실시간 동기화(`pg_sync`)를 지원합니다.

### 🪄 4) Step-by-Step 초기 설정 마법사 단계 안내
- **[Step 1] 환경 점검**: OS 사양, Node.js v20+, Python 3.10+, 포트 8100/9900 가용성 자동 진단
- **[Step 2] DB 선택**: 내장 SQLite (권장 기본값) 또는 외부 PostgreSQL 16 분기 선택
- **[Step 3] API 키 연동**: 키움증권, 토스증권, Gemini AI 키 입력 (시뮬레이션 모드 지원)
- **[Step 4] 보안 & 예산**: 대시보드 입장 패스코드 (기본값: `sws@2129`), 실전 총예산 (기본 1천만원), 11대 봇 가상 시드 설정
- **[Step 5] 원클릭 기동**: 설정 파일 자동 생성, DB 스키마 주입, 백엔드/프론트엔드 백그라운드 자동 기동 및 메인 화면 자동 이동

### 🛑 5) 서비스 종료 방법
- **Windows**: `AutoStockTrader_Windows_Stop.bat` 더블클릭
- **Linux**: `./AutoStockTrader_Linux_Stop.sh` 실행

---

## 1. 주요 특징 및 핵심 아키텍처

- **하이브리드 증권사 분리 연동 아키텍처 (Kiwoom Quotes ⨉ Toss Trading)**
  - **시세/호가 조회 (키움증권)**: `backend/common/kiwoom_client.mjs`
    - 키움증권 Open API를 통해 국내주식 실시간 현재가, 최우선 호가(매도 1호가/매수 1호가), 체결량, 시장 체제(KOSPI/KOSDAQ 지수 및 20/60 MA) 수집
    - 한국거래소(KRX) 가격대별 호가단위(Tick Size) 자동 보정
    - API 초당 호출 제한 방어를 위한 250ms Rate Limiter 탑재
  - **주문/매매 체결 (토스증권)**: `backend/common/toss_client.mjs`
    - 토스증권 Open API를 통해 실전 주문(매수/매도)을 직접 집행하고 계좌 예수금 및 보유 주식 잔고 실시간 동기화
- **고성능 경량 백엔드 (Node.js v20+ / ES Module)**
  - `node:http` 기반 초경량·고신뢰성 아키텍처 (Port `8100`)
  - 정규장(09:00~15:30) / 시간외 동시호가 자동 감지 및 7초 주기 비동기 봇 스케줄러 (`scheduler_service.mjs`)
- **듀얼 데이터베이스 아키텍처 및 실시간 동기화 (Dual DB & Sync)**
  - **기본 모드**: 무설치 초경량 고성능 내장 SQLite (`data/auto_stock_trade.db`, WAL 초고속 모드) - 11대 봇 자금 및 포지션 원장 완벽 격리
  - **확장 모드**: 외부/로컬 PostgreSQL 16 (`stock` DB) 연동 및 실시간/주기적 데이터 동기화 워커 (`pg_sync.mjs`)
- **정밀 가상 매매(Paper Trading) 체결 엔진 (`virtual_engine.mjs`)**
  - 키움증권 실시간 매도 1호가(매수 시) 및 매수 1호가(매도 시) 체결 슬리피지 반영
  - 위탁수수료(0.015%) 및 증권거래세(0.18%)를 정확히 차감한 순실현손익 계산
  - 누적 수익률, 승률, 손익비(Profit Factor), 최대 낙폭(MDD), 샤프 지수(Sharpe Ratio) 실시간 산출
  - **⚡ 30영업일 초고속 시뮬레이션(Fast Replay Test)**: 야간/주말에도 11대 알고리즘 성능 즉시 검증
  - **자금 격리 및 상호 간섭 방지**: 봇별 order_no 독립 관리, 가상 잔고 트랜잭션 락, 잔고 부족 시 자동 안전 중지
- **순수 수식 퀀트 ⨉ Gemini LLM 듀얼 트랙 리스크 제어**
  - **1차 기술적 지표 평가 (`quant_algorithms.mjs`)**: 외부 AI 호출 없이 100% 순수 수식(MA, RSI, 볼린저밴드, 거래량, 엔벨로프, 일목균형표, VWAP, 켈트너 등)으로 즉시 시그널 도출
  - **2차 AI 감성 & 리스크 필터링 (`llm_decision_service.mjs`)**: Google Gemini 2.5 Flash를 연동하여 실시간 뉴스 호재/악재 감성 분석 및 시장 위험도 종합 평가
  - **실시간 SSE 스트리밍**: 18ms 간격 한 글자씩 부드러운 타자기(Typewriter) 효과 및 실시간 시황 리포트 출력
- **다중 채널 실시간 알림 서비스 (`notification_service.mjs`)**
  - 텔레그램 봇 연동을 통한 실시간 매수/매도 체결 알림, 익절/손절 도달 통보 및 일일 결산 보고서 발송
- **반응형 프리미엄 다크 테마 프론트엔드 (React 18 & Vite, Port `9900`)**
  - Pretendard 폰트 기반 `#0b0f19` 다크 테마, 2:8 최적화 분할 레이아웃
  - 보안 게이트웨이: 기본 입장 패스코드 (`sws@2129`, 대시보드 [환경설정] 탭에서 자유롭게 변경 가능)
  - 국내 증시 표준 색상 적용 (이익 빨간색 `#ef4444`, 손해 파란색 `#3b82f6`)
  - 실시간 예산 바(`BudgetBar`): 실전 총예산, 토스 가용 예수금, 봇별 자금 할당 실시간 모니터링

---

## 2. 검증 완료 11대 퀀트 매매 알고리즘 봇 명세

시스템은 시장 상황(상승장, 하락장, 횡보장, 변동성 장세)에 능동적으로 대응할 수 있도록 상호 보완적인 **11대 퀀트 알고리즘 봇**을 탑재하고 있습니다.

### 📊 11대 봇 종합 요약표

| 봇 ID | 알고리즘 명 | 닉네임 | 전략 유형 | 진입 조건 (기술적 지표) | 청산 규칙 (익절 / 손절) | 실전 기본 배분 |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| `bot_01_volatility_breakout` | **래리 윌리엄스 변동성 돌파** | `VOL-BREAK #1` | 변동성 돌파 | 당일 시가 + (전일 변동폭 × 0.5) 돌파 & 거래량 급증 | 15:15 장마감 전량 청산 또는 **+4.0% / -2.0%** | **33.3%** (주력) |
| `bot_02_inst_dual_momentum` | **외인·기관 양매수 듀얼 모멘텀** | `INST-DUAL #2` | 듀얼 모멘텀 | 20일 수익률 상위 + 외인/기관 3일 동반 순매수 + 20일선 정배열 | 5일선 이탈 또는 **+7.0% / -3.0% (트레일링)** | **33.3%** (주력) |
| `bot_03_bb_rsi_reversion` | **볼린저 밴드 + RSI 평균회귀** | `BB-RSI #3` | 평균 회귀 | 볼린저 하단(-2σ) 터치 후 반등 + RSI(14) ≤ 38 탈출 | 20일선 도달 또는 **+3.5% / -2.5%** | **33.4%** (주력) |
| `bot_04_macd_volume_surge` | **MACD 골든크로스 거래량 폭발** | `MACD-SURGE #4` | 모멘텀 추종 | MACD(12,26,9) 시그널 상향 돌파 & 5일 평균 거래량 300% 폭발 | 시그널 데드크로스 또는 **+5.5% / -2.5%** | 대기 / 선택 운용 |
| `bot_05_supertrend_atr` | **슈퍼트렌드 ATR 추세추종** | `SUPER-ATR #5` | 채널 추세추종 | ATR(10)×3 변동성 채널 상단 돌파 & ADX ≥ 25 강세 추세 | 채널 하단 이탈 또는 **+8.0% / -3.0%** | 대기 / 선택 운용 |
| `bot_06_envelope_sniper` | **엔벨로프 낙폭과대 스나이퍼** | `ENV-SNIPER #6` | 역추세 반등 | 20일선 대비 -7% 엔벨로프 하단 터치 & RSI < 45 단기 과매도 | 중심선(20일선) 복귀 또는 **+3.0% / -2.0%** | 대기 / 선택 운용 |
| `bot_07_ichimoku_cloud` | **일목균형표 구름대 돌파** | `ICHIMOKU #7` | 중기 추세돌파 | 전환선/기준선 호전 & 선행스팬 양운(Cloud Top) 상향 돌파 | 기준선 하향 이탈 또는 **+6.5% / -2.8%** | 대기 / 선택 운용 |
| `bot_08_stoch_vwap_scalp` | **스토캐스틱 RSI + VWAP 초단타** | `VWAP-SCALP #8` | 장중 스캘핑 | 당일 VWAP(거래량가중평균가) 상단 지지 & Stoch-RSI 골든크로스 | VWAP 하향 이탈 또는 **+2.5% / -1.2%** | 대기 / 선택 운용 |
| `bot_09_keltner_squeeze` | **켈트너 채널 스퀴즈 폭발** | `KELTNER #9` | 변동성 스퀴즈 | 볼린저밴드가 켈트너 채널 내 수축 후 에너지 응축 상향 돌파 | 밴드 중심선 이탈 또는 **+6.0% / -2.5%** | 대기 / 선택 운용 |
| `bot_10_ma_pullback_swing` | **20/60일 정배열 눌림목 스윙** | `PULLBACK #10` | 눌림목 스윙 | 20/60일 정배열 상승 국면 중 20일선 지지 이격(1.8% 이내) 반등 | 20일선 완전 이탈 또는 **+5.0% / -2.2%** | 대기 / 선택 운용 |
| `bot_11_jack_kellogg_vwap` | **잭 켈로그 VWAP 핵심레벨 돌파** | `KELLOGG-VWAP #11` | 장중 데이트레이딩 | VWAP·시가 상회 & 당일 고점 돌파(고점대비 ≤3.5%) & 거래량 200% 폭발 & RSI ≤ 78 | VWAP·시가 이탈 칼손절 또는 **+6.0% / -2.0%** | 대기 / 선택 운용 |

### 💡 실전 매매 & 가상 아레나 운용 방식
1. **실전 매매 (`REAL_TRADING`)**:
   - 시스템 초기 기동 시 검증된 상위 3대 봇(`bot_01`, `bot_02`, `bot_03`)이 주력으로 자동 선택되며, 설정된 실전 총예산을 균등 분할(33.3%, 33.3%, 33.4%)하여 동시 가동됩니다.
   - 대시보드에서 사용자가 원하는 전략 봇을 자유롭게 1~3개 선택하여 실전 투입 포트폴리오를 변경할 수 있습니다.
2. **가상 매매 아레나 (`VIRTUAL_ARENA`)**:
   - 11대 퀀트 봇 전체가 독립된 가상 시드(기본 각 1,000만원)를 가지고 24시간 동시 가동됩니다.
   - 실시간 랭킹 리더보드를 통해 승률, 수익률, MDD, 샤프 지수를 실시간 비교 분석할 수 있습니다.
   - **30영업일 초고속 시뮬레이션(Fast Replay)** 버튼을 통해 과거 시장 데이터 기반 성능 검증을 언제든 즉시 수행할 수 있습니다.

---

## 3. 디렉토리 구조

```text
autoStockTrader/
├── backend/
│   ├── node_server.mjs                 # 백엔드 코어 HTTP 서버, REST API, SSE 스트리밍
│   ├── config/
│   │   └── env.mjs                     # 포트, 패스코드, DB모드 등 핵심 환경설정 로더
│   ├── controllers/                    # 도메인별 HTTP 컨트롤러 (봇, 거래, AI, 뉴스, 환경설정, 헬스체크)
│   ├── routes/                         # REST API 라우터 매핑
│   ├── services/                       # 핵심 비즈니스 서비스 (스케줄러, 트레이딩, 봇, AI, 예산)
│   ├── db/
│   │   ├── index.mjs                   # SQLite (WAL 모드) / PostgreSQL 동기화 스키마 및 어댑터
│   │   ├── pg_worker.mjs               # PostgreSQL 16 커넥션 풀 워커
│   │   └── pg_sync.mjs                 # SQLite ⨉ PostgreSQL 실시간/주기적 데이터 동기화 워커
│   ├── common/
│   │   ├── kiwoom_client.mjs           # 키움증권 Open API (실시간 시세/호가, KRX 호가단위 보정)
│   │   ├── toss_client.mjs             # 토스증권 Open API (실전 주문 집행, 예수금/잔고 동기화)
│   │   ├── virtual_engine.mjs          # 가상매매 체결 엔진, 30일 고속 시뮬레이터, 성과지표 계산
│   │   ├── quant_algorithms.mjs        # 11대 퀀트 알고리즘 순수 수식 지표 평가 엔진
│   │   ├── llm_decision_service.mjs    # Gemini LLM 뉴스 감성 분석 & 듀얼 트랙 리스크 제어
│   │   ├── notification_service.mjs    # 텔레그램 및 멀티 채널 실시간 체결/손익 알림
│   │   ├── news_service.mjs            # 네이버금융/한경/매경/공시 실시간 뉴스 수집
│   │   └── python_executor_bridge.mjs  # 토스 Python 브릿지 연동 인터페이스
│   └── python/
│       ├── init_db.py                  # 데이터베이스 스키마 및 11대 봇 시드 초기화
│       ├── toss_executor.py            # 토스증권 Python 주문 집행 워커
│       └── llm_filter_worker.py        # Python LLM 백그라운드 필터링 워커
├── frontend/
│   ├── src/
│   │   ├── App.jsx                     # 프론트엔드 메인 컴포넌트 (5대 메뉴, AI 스트리밍, 검증소)
│   │   ├── components/                 # UI 컴포넌트 (BudgetBar, 차트, 테이블, 모달)
│   │   ├── services/api.js             # 백엔드 연동 비동기 클라이언트
│   │   └── styles.css                  # 프리미엄 다크 테마, 2:8 레이아웃, 모달 스타일
│   ├── index.html
│   ├── package.json
│   └── vite.config.js                  # 0.0.0.0 바인딩, /api 프록시 설정
├── install/                            # [비개발자용] 독립형 원클릭 배포 패키지
│   ├── AutoStockTrader_Windows_Run.bat  # Windows 원클릭 런처
│   ├── AutoStockTrader_Windows_Stop.bat # Windows 서비스 종료
│   ├── AutoStockTrader_Linux_Run.sh     # Linux 원클릭 런처
│   ├── AutoStockTrader_Linux_Stop.sh    # Linux 서비스 종료
│   ├── Dockerfile                       # 패키지 컨테이너 빌드 파일
│   ├── docker-compose.yml               # 패키지 컨테이너 오케스트레이션
│   ├── setup_wizard/                    # 설정 마법사 웹 서버 및 UI
│   └── app/                             # 정적 빌드 산출물 및 런타임 번들
├── setup_wizard/                       # 초기 온보딩 설정 마법사 원본
│   ├── wizard_server.mjs                # 마법사 백엔드 (포트 9901)
│   └── wizard_ui.html                   # 마법사 반응형 프론트엔드
├── scripts/
│   ├── build_installer.mjs              # 비개발자용 /install 배포 패키지 자동 빌더
│   ├── frontend_server.mjs              # 정적 프론트 서빙 및 API 리버스 프록시 서버
│   ├── setup_postgresql.sh              # PostgreSQL 16 stock_trader 계정 및 DB 자동 설정 스크립트
│   ├── migrate_sqlite_to_pg.py          # SQLite -> PostgreSQL 데이터 마이그레이션 도구
│   └── installer_templates/             # 배포 패키지용 스크립트 템플릿
├── config/
│   ├── broker_config.example.json      # 증권사/AI 키 설정 템플릿
│   └── broker_config.json              # 실제 API 키 보관 파일 (Git 추적 제외)
├── data/                               # 내장 SQLite DB(auto_stock_trade.db) 저장 디렉터리
├── logs/                               # 백엔드/프론트엔드 실행 로그 디렉터리
├── Dockerfile                          # 도커 컨테이너 빌드 파일
├── docker-compose.yml                  # 백엔드 ⨉ 정적 프론트 듀얼 컨테이너 실행 구성
├── start_services.sh                   # 개발/서버 환경 백그라운드 원클릭 실행 스크립트
├── stop_services.sh                    # 서비스 정상 종료 스크립트
├── start_tunnel.sh                     # Cloudflare 원격 접속 보안 터널 실행 스크립트
├── stop_tunnel.sh                      # Cloudflare 보안 터널 종료 스크립트
├── .env.example                        # 환경 변수 템플릿 파일
└── README.md                           # 시스템 통합 문서
```

---

## 4. 빠른 시작 가이드 (Quick Start)

### 1) 서비스 원클릭 시작
```bash
./start_services.sh
```
- 백엔드 (`http://127.0.0.1:8100`) 및 프론트엔드 (`http://127.0.0.1:9900`)가 백그라운드로 구동되고 헬스체크가 자동 수행됩니다.
- 사내 LAN: `http://<내부IP>:9900`
- 게이트 입장 코드: `sws@2129` *(환경변수 `GATE_PASSCODE` 또는 대시보드 [환경설정]에서 변경 가능)*

### 2) 서비스 정상 종료
```bash
./stop_services.sh
```

### 3) Docker 원클릭 구동 (SQLite 모드 & 듀얼 컨테이너)
```bash
# 루트 디렉터리 또는 install 디렉터리에서 즉시 실행
docker compose up -d
```
- 백엔드 (`http://127.0.0.1:8100`)와 프로덕션 정적 프론트엔드 (`http://127.0.0.1:9900`)가 격리된 컨테이너 환경에서 즉시 실행됩니다.
- 데이터베이스(`data/`), 실행 로그(`logs/`), 설정 파일(`config/`)이 볼륨으로 호스트에 영구 보존됩니다.

### 4) PostgreSQL 16 설정 및 관리 (선택 사항)
```bash
# PostgreSQL DB 및 사용자 생성 (필요 시 root/sudo 권한으로 실행)
sudo ./scripts/setup_postgresql.sh
```

### 5) 외부 접속 (Cloudflare Quick Tunnel)
```bash
# 터널 시작
./start_tunnel.sh

# 터널 종료
./stop_tunnel.sh
```
- 발급된 보안 HTTPS 주소(`https://*.trycloudflare.com`)를 통해 외부 모바일, 태블릿, 외부 PC 어디서나 포트포워딩 없이 안전하게 접속할 수 있습니다.
- 백엔드 API (`/api/*`)와 게이트 보안(`sws@2129`)이 그대로 연동됩니다.

---

## 5. 형상 관리 (Git) 및 보안 규칙

- 키움증권 및 토스증권 API Key, Secret, 계좌번호 및 Gemini API 키 등 모든 민감 정보는 `.env` 및 `config/broker_config.json`에만 저장되며 Git 추적에서 철저히 제외됩니다.
- 원격 저장소: `https://github.com/wonsubshin/autoStockTrade.git`
- 로컬 마법사 실행 마커(`.setup_completed`) 및 임시 덤프 파일(`full_source*.md`)은 `.gitignore`에 등록되어 안전하게 보호됩니다.

---

## ⚖️ 6. 라이선스 및 법적 면책 조항 (Disclaimer)

### 라이선스 (License)
본 프로젝트는 **[Apache License 2.0](LICENSE)**에 따라 배포됩니다.

```text
Copyright 2026 AutoStockTrader Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### 법적 면책 조항 (Legal Disclaimer)
> ⚠️ **주의 및 고지**: **본 소프트웨어의 사용으로 발생하는 모든 투자 손실의 책임은 사용자 본인에게 있으며, 제작자는 투자 자문이나 수익을 보장하지 않습니다.**  
> 본 프로그램은 퀀트 알고리즘 연구 및 시스템 개발을 목적으로 제작된 오픈소스 소프트웨어입니다. 실제 금융 시장 매매 주문 집행 및 자금 운용에 따른 모든 법적, 금전적 위험 부담은 전적으로 사용자 본인에게 있습니다.
