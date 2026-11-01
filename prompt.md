# 한국투자증권(KIS) Open API 기반 다중 전략 국내주식 자동매매 & 가상매매(Paper Trading) AI 퀀트 시스템 구축 프롬프트

당신은 시니어 풀스택 개발자이자 국내주식(KOSPI/KOSDAQ) 퀀트 트레이딩 시스템 아키텍트입니다. 아래의 요구사항을 **하나도 빠짐없이 완벽하게** 반영하여, 한국투자증권(KIS) Open API를 연동한 로컬 및 외부 웹 기반 국내주식 실전/가상 자동매매 & 실시간 AI 증시 뉴스 인텔리전스 시스템(Backend + Frontend + Dual DB + Virtual Paper Trading Engine + AI Streaming + Network Tunnel)을 설계하고 구현해주세요.

---

## 1. 기술 스택 및 시스템 아키텍처

- **Backend**: Node.js (v20+ / ES Module, `node:http`, `node:sqlite` DatabaseSync 기반 고성능 경량 서버, Port `8001`)
  - 정규장(09:00~15:30) / 장전·장후 시간외 스케줄러 및 비동기 봇 전략 스케줄러 (5~10초 주기)
  - 한국투자증권(KIS) REST API & WebSocket 실시간 호가/체결 연동 모듈 (OAuth 접근 토큰 24시간 자동 갱신 캐싱)
  - **가상 매매(Paper Trading) 시뮬레이션 체결 엔진**: 실시간 호가/현재가 및 슬리피지·제세금(증권거래세+수수료)을 반영한 가상 체결 및 알고리즘 성과 검증 엔진
  - Gemini AI 실시간 스트리밍 (Server-Sent Events: SSE) 엔진
  - 국내 증시 뉴스/공시(DART, 네이버 금융, 한국경제 등) 실시간 RSS 수집 및 감성 분석 백그라운드 워커 (30분 주기)
- **Frontend**: React 18+ & Vite (Port `9000`)
  - 프리미엄 다크 테마 UI (Pretendard 폰트 기반, `#0b0f19` 다크 배경, 2:8 화면 분할)
  - 상대 경로(`API_BASE = ""`) 및 Vite 프록시(`vite.config.js`)를 통한 로컬, 사내 LAN, 외부 도메인 무설정 동시 지원
- **Dual Database Architecture (SQLite + PostgreSQL 16)**:
  - **기본 실시간 DB**: SQLite (`data/auto_stock_trade.db`, WAL 저널 모드, 자동 재접속 지원)
  - **동기화 및 백업 DB**: PostgreSQL 16 (`stock_trader` 데이터베이스)
  - **환경별 동적 분기 (.env)**: `LOCATION=local` (로컬 `127.0.0.1:5432`) 또는 `LOCATION=outer` (외부 접속 주소 및 포트) 설정에 따라 자동 연결
  - **백그라운드 동기화 매니저 (`pg_sync.mjs`)**: SQLite에 저장되는 모든 테이블(`system_settings`, `bots`, `trades`, `bot_positions`, `virtual_trades`, `stock_news`)의 변경 내역을 PostgreSQL에 실시간 양방향/UPSERT 동기화
- **외부 접속 지원 (Cloudflare Tunnel & LAN)**:
  - 사내 LAN (`http://<내부IP>:9000`) 및 Cloudflare Quick Tunnel (`https://*.trycloudflare.com`)을 통한 안전한 외부 접속 지원
  - Vite `server.allowedHosts: true`, `host: "0.0.0.0"` 적용
- **형상 관리 및 보안 (Git & `.gitignore`)**:
  - 원격 저장소: `https://github.com/wonsubshin/autoStockTrade.git`
  - 한국투자증권 App Key, App Secret, 계좌번호 및 Gemini API Key 등 민감 정보는 `.env` 및 `config/kis_config.json`으로 분리하여 Git 추적에서 제외(`kis_config.example.json` 템플릿 제공)
  - **Git 커밋 규칙**: 작업 완료 시 변경사항을 항상 커밋하되, 커밋 메시지에 개인정보나 계좌/키 정보가 일절 포함되지 않도록 작성

---

## 2. 디렉토리 및 모듈 구조

```text
autoStockTrade/
├── backend/
│   ├── node_server.mjs          # 백엔드 코어 HTTP 서버, DB 초기화, REST API, SSE 스트리밍
│   └── common/
│       ├── kis_client.mjs       # 한국투자증권 Open API 토큰 관리, 시세 조회, 실전/모의 주문 래퍼
│       ├── virtual_engine.mjs   # 가상 매매(Paper Trading) 시뮬레이션 및 알고리즘 성과 측정 엔진
│       ├── news_service.mjs     # 네이버 금융/한경/매경/공시 RSS 파싱, 감성 분석, 테마/종목 태그 추출
│       └── pg_sync.mjs          # PostgreSQL 16 실시간 데이터 동기화 매니저
├── config/
│   ├── kis_config.json          # KIS API(실전/모의) 및 Gemini API 키 설정 파일 (Git 제외)
│   └── kis_config.example.json  # 설정 파일 템플릿
├── data/
│   └── auto_stock_trade.db      # 로컬 SQLite 데이터베이스 (WAL 모드)
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # 프론트엔드 메인 컴포넌트 (5대 메뉴, 가상매매 검증소, AI 스트리밍)
│   │   ├── main.jsx             # React 엔트리포인트
│   │   └── styles.css           # 다크 테마, 2:8 레이아웃, 동일 Row 높이 테이블, 모달 스타일
│   ├── index.html
│   ├── package.json
│   └── vite.config.js           # 0.0.0.0 바인딩, allowedHosts, /api 프록시 설정
├── scripts/
│   ├── setup_postgresql.sh      # PostgreSQL 16 계정 및 데이터베이스 자동 설치/설정 스크립트
│   └── migrate_sqlite_to_pg.py  # SQLite -> PostgreSQL 전체 데이터 마이그레이션 스크립트
├── start_services.sh            # 백엔드(8001) 및 프론트엔드(9000) 백그라운드 원클릭 실행 스크립트
├── stop_services.sh             # 실행 중인 서비스 정상 종료 스크립트
└── .env                         # LOCATION=local|outer, PostgreSQL 접속 정보, Gemini API 키
```

---

## 3. 데이터베이스 스키마 요구사항

SQLite와 PostgreSQL 모두 동일한 스키마 구조를 유지하며, 실전 매매와 가상 매매(`trade_mode`: `'REAL'` | `'VIRTUAL'`)를 완벽히 추적할 수 있도록 다음 8개 테이블을 구성해야 합니다:

1. **`system_settings`**: `key`(PK, TEXT), `value`(TEXT), `updated_at`(TEXT)
2. **`bots`**: `bot_id`(PK, TEXT), `name`(TEXT), `nickname`(TEXT), `strategy_type`(TEXT), `trade_mode`(TEXT DEFAULT 'VIRTUAL' -- 'REAL' 실전매매 / 'VIRTUAL' 가상매매), `description`(TEXT), `allocation_ratio`(REAL), `allocated_capital`(INTEGER), `virtual_krw`(INTEGER), `is_running`(INTEGER), `min_volume_krw`(INTEGER), `stop_loss_pct`(REAL), `take_profit_pct`(REAL), `config_json`(TEXT), `last_status_msg`(TEXT), `updated_at`(TEXT)
3. **`trades`**: `id`(PK, AUTOINCREMENT), `bot_id`(TEXT), `trade_mode`(TEXT DEFAULT 'VIRTUAL'), `stock_code`(TEXT), `stock_name`(TEXT), `buy_order_no`(TEXT), `sell_order_no`(TEXT), `buy_price`(INTEGER), `buy_qty`(INTEGER), `buy_amount`(INTEGER), `buy_date`(TEXT), `sell_price`(INTEGER), `sell_qty`(INTEGER), `sell_amount`(INTEGER), `sell_date`(TEXT), `fee_and_tax`(INTEGER), `profit_krw`(INTEGER), `profit_pct`(REAL), `status`(TEXT DEFAULT 'HOLDING')
4. **`bot_positions`**: `id`(PK, AUTOINCREMENT), `bot_id`(TEXT), `trade_mode`(TEXT DEFAULT 'VIRTUAL'), `stock_code`(TEXT), `stock_name`(TEXT), `order_no`(TEXT UNIQUE), `qty`(INTEGER), `avg_buy_price`(INTEGER), `buy_amount`(INTEGER), `buy_fee`(INTEGER), `trade_id`(INTEGER), `status`(TEXT DEFAULT 'OPEN'), `created_at`(TEXT), `closed_at`(TEXT)
5. **`virtual_performance_logs`** (가상 매매 알고리즘 성능 일별/회차별 스냅샷): `id`(PK, AUTOINCREMENT), `bot_id`(TEXT), `eval_date`(TEXT), `initial_capital`(INTEGER), `eval_assets`(INTEGER), `cumulative_return_pct`(REAL), `win_rate`(REAL), `profit_factor`(REAL), `mdd_pct`(REAL), `sharpe_ratio`(REAL), `total_trades`(INTEGER), `created_at`(TEXT)
6. **`ai_market_briefings`**: `id`(PK, AUTOINCREMENT), `provider`(TEXT), `model`(TEXT), `kospi_index`(REAL), `kosdaq_index`(REAL), `kospi_20ma`(REAL), `kosdaq_60ma`(REAL), `regime_status`(TEXT), `briefing_text`(TEXT), `created_at`(TEXT)
7. **`stock_news`**: `id`(PK, AUTOINCREMENT), `title`(TEXT), `link`(TEXT UNIQUE), `source`(TEXT), `published_at`(TEXT), `summary`(TEXT), `sentiment`(TEXT DEFAULT 'NEUTRAL'), `keywords`(TEXT), `created_at`(TEXT)
   - 인덱스: `idx_stock_news_pubdate` ON `stock_news (published_at DESC)`
8. **`ai_news_briefings`**: `id`(PK, AUTOINCREMENT), `provider`(TEXT), `model`(TEXT), `news_count`(INTEGER), `bullish_count`(INTEGER), `bearish_count`(INTEGER), `neutral_count`(INTEGER), `briefing_text`(TEXT), `created_at`(TEXT)

---

## 4. 국내주식 수익률 상위 3대 매매 알고리즘 및 가상 매매(Paper Trading) 아키텍처

### 4.1 국내 증시(KOSPI/KOSDAQ) 검증 완료 수익률 상위 3대 매매 전략 봇

국내 증시의 높은 개인 수급 비중, 테마주 순환매, 잦은 박스권 장세에 최적화된 상위 3가지 퀀트 알고리즘을 탑재합니다.

1. **래리 윌리엄스 변동성 돌파 + 거래대금 급증 필터 봇 (`bot_kr_volatility_breakout`)**
   - **알고리즘 핵심**: 국내 단타/데이트레이딩에서 가장 높은 손익비를 기록하는 대표 추세 돌파 알고리즘.
   - **진입 조건**: 당일 거래대금 상위 30위 종목 중, 전일 변동폭($\text{전일 고가} - \text{전일 저가}$) $\times K(0.5) + \text{당일 시가}$를 돌파하고, 동시에 5분봉 거래량이 전일 동시간대 대비 200% 이상 급증할 때 매수 진입.
   - **청산 조건**: 장 마감 동시호가 진입 전(15:15~15:19) 전량 시간청산(오버나잇 리스크 제거) 또는 장중 목표 익절(+4.0%) / 손절(-2.0%) 도달 시 즉시 청산.
2. **외국인·기관 양매수 수급 + 듀얼 모멘텀 스윙 봇 (`bot_kr_inst_dual_momentum`)**
   - **알고리즘 핵심**: 한국 증시에서 주가 견인력이 가장 높은 외국인·기관 동반 순매수(수급 팩터)와 상대/절대 모멘텀을 결합한 중단기 스윙 전략.
   - **진입 조건**: 최근 20거래일 수익률 상위 섹터 종목 중 최근 3거래일 연속 외국인·기관 합산 순매수가 유입되고, 20일 이동평균선이 정배열 상승 중이며 절대 모멘텀(무위험 수익률 초과)이 양(+)인 종목 매수.
   - **청산 조건**: 5일 이동평균선 하향 이탈 또는 외국인/기관 대량 매도 전환 시 청산 (목표 익절 +7.0% / 트레일링 스톱 -3.0%).
3. **볼린저 밴드 하단 과매도 + RSI 다이버전스 평균회귀 봇 (`bot_kr_bb_rsi_reversion`)**
   - **알고리즘 핵심**: 박스권 횡보장이 잦은 국내 우량 대형주(KOSPI 200 및 KOSDAQ 150)에서 높은 승률(70% 이상)을 기록하는 역추세 평균회귀(Mean Reversion) 알고리즘.
   - **진입 조건**: 20일 볼린저 밴드 하단선($-2\sigma$)을 이탈한 후 재진입하는 양봉 발생 + 14일 $\text{RSI} \le 30$ 과매도 구간 탈출 신호 발생 시 매수.
   - **청산 조건**: 볼린저 밴드 중심선(20일선) 또는 상단선 도달 시 분할 익절 (+3.5% 익절 / -2.5% 손절).

### 4.2 가상 매매(Paper Trading) 및 알고리즘 성능 검증 시스템 (핵심 추가 요구사항)
- **실전 매매(`REAL`) vs 가상 매매(`VIRTUAL`) 완벽 분리 및 원클릭 전환**:
  - 각 봇은 개별적으로 **[🧪 가상매매 모드]** 또는 **[💰 실전매매 모드]**로 설정 가능하며, 기본값은 안전한 성능 확인을 위해 `VIRTUAL` 모드로 동작합니다.
- **실시간 호가 기반 정밀 가상 체결 엔진 (`virtual_engine.mjs`)**:
  - 가상 매매 시 단순 현재가가 아니라 한국투자증권 실시간 호가창의 **매도 1호가(매수 시)** 및 **매수 1호가(매도 시)**를 기준으로 체결시켜 실전 슬리피지를 반영합니다.
  - 국내주식 매매 비용인 **위탁매매 수수료(약 0.015%)**와 **매도 시 증권거래세(약 0.18%)**를 정확히 차감하여 실질 순수익(`profit_krw`, `profit_pct`)을 계산합니다.
- **알고리즘 성능 검증 지표 자동 산출**:
  - 봇별 가상 매매 결과를 바탕으로 **누적 수익률(%)**, **승률(Win Rate, %)**, **손익비(Profit Factor = 총이익/총손실)**, **최대 낙폭(MDD, Maximum Drawdown %)**, **샤프 지수(Sharpe Ratio)**, **평균 보유 시간**을 실시간 산출하여 알고리즘 간 우위를 객관적으로 비교합니다.
- **장외 시간/주말 즉시 알고리즘 시뮬레이션(Fast Replay Test) 기능**:
  - 정규장이 열리지 않는 야간이나 주말에도 알고리즘 성능을 즉시 확인할 수 있도록, 최근 30영업일 분봉/일봉 데이터를 기반으로 3개 봇의 가상 매매를 고속 시뮬레이션하고 성과 리포트를 즉시 생성하는 **[⚡ 알고리즘 고속 성능 검증 실행]** 버튼을 제공합니다.

### 4.3 상호 간섭 방지 및 자금 격리 규칙 (절대 준수)
- **계좌 전체 잔고 직접 매도 금지**:
  - 매도 시 반드시 본인 `bot_id`의 `bot_positions`에 기록된 `qty`(보유 주식 수)만 지정하여 주문 발행.
- **동일 종목 동시 진입 격리**:
  - 복수 봇이 동일 종목(예: `005930` 삼성전자)을 매수하더라도 개별 `order_no`로 지분을 분리하여 관리.
- **가상 잔고(`virtual_krw`) 트랜잭션 락**:
  - 각 봇은 DB에 할당된 `virtual_krw` 예산 범위 내에서만 주문을 발행하며, 국내주식 특성상 **1주 단위 정수 수량(`Math.floor(예산 / (현재가 * 1.00015))`)**으로만 주문 가능.
- **잔고 부족 및 0 이하 시 전체 봇 자동 중지 및 모달 알림**:
  - 가용 예수금이 1주 매수 금액 미만이거나 0 이하가 되면 봇을 비활성화하고 거래현황 진입 시 Modal Popup 표기.
- **KOSPI / KOSDAQ 시장 체제 필터 (Market Regime Filter)**:
  - 코스피(KOSPI) 또는 코스닥(KOSDAQ) 지수가 일봉 20일 이동평균선(20 MA) 및 60일 이동평균선(60 MA) 아래에 동시에 위치하고 당일 지수가 -2.0% 이상 급락 중일 경우, 신규 매수를 전면 차단하고 현금 보유(`HOLD_CASH`) 모드로 전환.
- **한국투자증권(KIS) API 안정성 규칙**:
  - KIS API 초당 호출 제한(실전 초당 20건, 모의 초당 2건) 방어를 위한 `250ms` 요청 큐(Rate Limiter) 적용.
  - 한국거래소(KRX) 가격대별 **호가단위(Tick Size: 1원 ~ 1,000원)** 자동 보정 함수 필수 내장.

---

## 5. 프론트엔드 (React) UI/UX 상세 요구사항

### 5.1 공통 레이아웃 및 보안 게이트
- **다크 테마 & 2:8 레이아웃**:
  - 좌측 20% 메뉴 영역 + 우측 80% 상세 콘텐츠 영역.
- **입장 코드(Gate) 화면**:
  - 별도 회원가입 없이 기본 입장 코드 `coin` 입력 시 메인 화면 진입 (환경설정에서 변경 가능, 새로고침 시 세션 유지).
- **KIS API 통신 상태 & 장 운영 상태 인디케이터**:
  - 좌측 메뉴 상단에 KIS 서버 상태(초록: 정상 / 노랑: 지연 / 빨강: 통신불가) 및 현재 장 상태(`🟢 정규장 진행중`, `🟡 장전/장후 동시호가`, `⚪ 장마감/휴장 - 가상시뮬레이션 가능`) 실시간 표시.
- **5대 네비게이션 메뉴 구성**:
  1. `📊 거래현황` (실전/가상 봇 제어 및 실시간 체결 내역)
  2. `🧪 알고리즘 성능 검증소` (가상 매매 봇 Top 3 수익률·승률·MDD 비교 대시보드)
  3. `📈 통계` (일별/주별/월별 및 종목별 손익 통계)
  4. `📰 증시뉴스 & 공시` (실시간 뉴스 피드 & AI 종합 시황 분석)
  5. `⚙️ 설정` (KIS API, 자금 배분, 가상 시드머니, DB 백업/복원)

---

### 5.2 [메뉴 1] 거래현황 화면
- **봇별 탭(Tab) & 모드 배지**: 봇별 별명, 적용 알고리즘명, 현재 모드(`[🧪 가상매매]` 또는 `[💰 실전매매]`)가 표시되는 개별 탭.
- **봇 제어 버튼**: `거래 시작`, `거래 중지`, `모드 전환(가상↔실전)`, `가상 매수 테스트`, `가상 매도 테스트`, `가상 계좌 초기화` 버튼 제공 및 동작 결과 Modal Popup 안내.
- **거래 정보 게시판**:
  - 1행 매칭 방식: 종목명(종목코드), 매수단가/수량/금액, 매도단가/수량/금액, 수수료·제세금, 매수일시, 매도일시, 실현손익(원/%), 매매구분(가상/실전) 표기.
  - 미체결/보유 중 포지션은 현재가 기준 실시간 평가손익 표시.
- **상단 AI 실시간 국내증시 마켓 브리핑**:
  - KOSPI/KOSDAQ 지수, 수급 동향, 시장 체제(Regime)를 기반으로 Gemini AI가 시황을 분석하여 한 글자씩 스트리밍 타이핑(Typewriter) 출력.

---

### 5.3 [메뉴 2] 알고리즘 성능 검증소 화면 (가상 매매 전용 대시보드)
- **Top 3 알고리즘 실시간 리더보드 카드**:
  - 1위~3위 알고리즘 봇의 **누적 수익률(%)**, **실현 손익금**, **승률(%)**, **손익비(Profit Factor)**, **최대 낙폭(MDD)**, **샤프 지수**를 한눈에 비교하는 배틀 스코어보드 제공.
- **가상 시드머니 설정 및 고속 백테스팅/시뮬레이션 실행**:
  - 봇별 가상 시드머니(예: 각 1,000만 원) 부여 및 **[⚡ 최근 30일 데이터로 3대 알고리즘 즉시 시뮬레이션]** 버튼 제공.
  - 실행 시 3개 알고리즘이 과거 분봉/일봉 데이터를 기반으로 가상 매매를 수행하고, 수익 곡선(Equity Curve)과 거래 내역을 즉시 생성하여 가장 수익률이 높은 알고리즘을 추천.
- **우수 알고리즘 실전 승격 기능**:
  - 가상 매매 검증 결과 수익률과 안정성이 검증된 봇을 원클릭으로 **[🚀 실전 매매 모드로 승격]** 전환하는 기능.

---

### 5.4 [메뉴 3] 통계 화면
- **필터 스위치**: `전체 보기` / `🧪 가상매매 통계만` / `💰 실전매매 통계만` 필터링 지원.
- **기간별 탭**: `일별 통계` / `주별 통계` / `월별 통계` (새로고침 시 선택 탭 유지).
- **통계 시작 기준일**: `2026.10.01`부터 누적 집계.
- **손익 색상 구분 규칙 (국내 증시 표준 필수 준수)**:
  - **이익(> 0)**: 빨간색 (`#ef4444`)
  - **손해(< 0)**: 파란색 (`#3b82f6`)
  - **0원(= 0)**: 검은색/회색 뱃지
- **종목별 수익 기여도 순위 테이블**: 매매한 국내주식 종목별 누적 실현 손익 및 승률 순위 표기.

---

### 5.5 [메뉴 4] 증시뉴스 & 공시 화면

#### ① 뉴스 수집 및 감성 분석 엔진 (`news_service.mjs`)
- 네이버 금융 주요뉴스, 한국경제, 매일경제 증권 RSS 및 주요 공시 뉴스를 실시간 파싱하여 수집 (중복 링크 방어).
- 제목 및 본문 기반 감성 분석: `▲ 호재(BULLISH)`, `▼ 악재(BEARISH)`, `● 중립(NEUTRAL)`.
- 키워드 자동 태깅: `#반도체`, `#2차전지`, `#바이오`, `#AI/로봇`, `#자동차`, `#실적발표`, `#금리/연준`, `#환율`, `#외국인수급`, `#공시/계약`.
- 서버 기동 시 최초 수집 및 **30분 주기 백그라운드 자동 갱신**.
- 상단 **[🔄 최신 증시뉴스 즉시 수집]** 버튼 제공.

#### ② 검색 및 필터링 기능
- **날짜 범위 검색**: 시작일(`startDate`) 및 종료일(`endDate`) 캘린더 입력.
- **통합 키워드 검색**: 기사 제목, 요약, 언론사, 종목명, 해시태그 대상 실시간 검색.
- **인기 태그 뱃지**: 원클릭으로 검색어에 테마 태그 자동 입력 및 즉시 조회.
- **초기화 버튼**: 검색 조건 초기화.

#### ③ 50건 단위 목록 뷰 및 행(Row) 높이 동일화 (필수 준수)
- **한 화면 50건 노출**: `limit=50`, 전체 페이지네이션(`« 처음`, `‹ 이전`, 페이지 번호 7개, `다음 ›`, `마지막 »`).
- **Row 높이 동일화 (`.news-board-table`)**:
  - 테이블에 `table-layout: fixed; width: 100%;` 적용.
  - 모든 행(`tr`) 및 셀(`td`)에 고정 높이(`height: 48px; max-height: 48px; line-height: 48px; vertical-align: middle;`) 적용.
  - 제목이 길어도 줄바꿈되지 않고 1줄 말줄임표(`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`)로 표시되어 **모든 행의 높이가 완벽히 동일**해야 함.
  - 마우스 호버 시 기사 전체 제목과 요약문이 툴팁(`title`)으로 노출되어 언제든 원문 확인 가능.
  - 기사 제목 클릭 시 새 탭(`target="_blank"`)에서 원문 기사 오픈.

#### ④ 뉴스 기반 AI 종합 판단 및 국내증시 시황 분석 (Gemini SSE 스트리밍)
- **접을 수 있는 아코디언 영역 (Collapsible Box)**:
  - 상단 **[▲ 접기] / [▼ 펼치기]** 토글 버튼 및 카드 헤더 클릭으로 영역을 자유롭게 열고 닫을 수 있음.
  - 접힌 상태에서도 최근 분석 시각, 사용 모델, 호재/악재 통계 배지 노출.
- **'AI 분석하기' 버튼 클릭 시 실시간 스트리밍 한 글자씩 타이핑**:
  - **[🤖 AI 분석하기]** 버튼 클릭 시 백엔드 `/api/ai/stream-news-analyze` 엔드포인트(SSE) 호출.
  - 수집된 250+ 국내 증시 뉴스와 호재/악재 비율, KOSPI/KOSDAQ 지수 및 주도 섹터를 Gemini AI(`gemini-2.5-flash`)가 분석.
  - 수신된 청크 토큰을 큐(Queue)에 담아 **18ms 간격으로 한 글자씩 부드럽게 화면에 타이핑(Typewriter Effect)** 출력.
  - 타이핑 진행 중 깜빡이는 보라색 커서(`|`) 애니메이션 표시.
  - 분석 완료 후 `ai_news_briefings` 테이블에 영구 저장되어 새로고침 시에도 유지.

---

### 5.6 [메뉴 5] 설정 화면
- **한국투자증권(KIS) 실계좌/모의계좌 자산 확인**: 읽기 전용으로 실제 주문가능 예수금, 주식 매입금액, 총 평가금액, 평가손익률 표시.
- **자금 분배 비율 및 원금 설정**: 전체 운용 원금(실전 원금 및 가상 시드머니) 및 봇별 배분 비율(%) 설정 시 소수점 버림 처리.
- **봇 파라미터 및 별명 수정**: 실전/가상 모드 설정, 손절율, 익절율, 최소 거래대금 필터, 전략별 계수(변동성 K값, RSI 기준치, 볼린저 표준편차 배수) 저장.
- **KIS API 및 Gemini API 키 등록/수정**: 웹 UI에서 App Key, App Secret, 계좌번호(앞 8자리 + 뒤 2자리), Gemini API 키 직접 입력 및 저장 (마스킹 처리).
- **JSON 데이터 마이그레이션(백업) 및 복원**:
  - SQLite의 전체 데이터(봇, 실전/가상 거래내역, 포지션, 알고리즘 성적표, 설정)를 단일 JSON 파일로 Export.
  - JSON 파일을 업로드하여 기존 DB를 무결성 검증과 함께 완벽 복원 (UNIQUE 충돌 방어 처리 포함).

---

## 6. 외부 네트워크 및 배포/운영 구성

- **실행 및 중지 스크립트**:
  - `./start_services.sh`: 백엔드(8100) 및 프론트엔드(9900)를 백그라운드 구동하고 헬스체크 수행.
  - `./stop_services.sh`: 구동 중인 프로세스를 안전하게 종료.
- **Cloudflare Tunnel 연동**:
  - `cloudflared tunnel --url http://127.0.0.1:9900`을 통해 HTTPS 외부 주소 생성.
  - IPv6 충돌 방지를 위해 반드시 `http://127.0.0.1:9900`으로 바인딩.
- **Vite Same-Origin Proxy**:
  - 프론트엔드에서 `/api`를 호출하면 `vite.config.js`의 proxy가 내부 백엔드(`http://127.0.0.1:8100`)로 무중단 포워딩하여 브라우저 환경에 구애받지 않고 동작.

---

## 7. 작업 수행 및 형상관리(Git) 지침

1. **국소 수정 원칙 (사이드 이펙트 방지)**:
   - 추가 요청 사항 작업 시 반드시 요청받은 범위만 수정하며, 기존에 정상 작동 중인 매매 봇 로직, 가상 매매 엔진, 통계 집계, DB 동기화 코드에 절대 영향을 주지 않도록 합니다.
2. **React TDZ(Temporal Dead Zone) 방어**:
   - `useCallback` 및 함수 선언이 `useEffect`보다 반드시 앞에 위치하도록 선언 순서를 엄격히 준수합니다.
3. **작업 완료 후 자동 Git 반영**:
   - 모든 수정 작업 완료 후 `git add` 및 `git commit`을 반드시 수행합니다.
   - 커밋 메시지에는 API 키, 계좌번호, 비밀번호 등 민감 정보를 일절 포함하지 않고 기능 단위(`feat`, `fix`, `refactor`)로 명확히 작성합니다.