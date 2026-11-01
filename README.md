# 🇰🇷 키움증권(시세조회) ⨉ 토스증권(주문체결) 기반 다중 전략 국내주식 자동매매 & 가상매매 AI 퀀트 시스템

> **국내주식 시세 및 호가 조회는 키움증권 Open API**, **실전 주문 및 잔고 관리는 토스증권 Open API**를 연동한 하이브리드 고성능 국내주식 실전/가상 자동매매 & 실시간 AI 증시 인텔리전스 시스템 (Backend + Frontend + Dual DB + Virtual Paper Trading Engine + AI Streaming + Network Tunnel)

---

## 1. 주요 특징 및 핵심 아키텍처

- **하이브리드 증권사 분리 연동 아키텍처 (Kiwoom Quotes ⨉ Toss Trading)**
  - **시세/호가 조회 (키움증권)**: `backend/common/kiwoom_client.mjs`
    - 키움증권 Open API를 통해 국내주식 실시간 현재가, 1호가(매도 1호가/매수 1호가), 체결량, 시장 체제(KOSPI/KOSDAQ 지수 및 20/60 MA) 수집
    - 한국거래소(KRX) 가격대별 호가단위(Tick Size) 자동 보정
    - API 초당 호출 제한 방어를 위한 250ms Rate Limiter
  - **주문/매매 체결 (토스증권)**: `backend/common/toss_client.mjs`
    - 토스증권 Open API를 통해 실전 주문(매수/매도)을 직접 집행하고 계좌 예수금 및 보유 주식 잔고 실시간 동기화
- **고성능 경량 백엔드 (Node.js v20+ / ES Module)**
  - `node:http`와 Node.js 내장 `node:sqlite` (DatabaseSync, WAL 모드) 기반 초경량·고신뢰성 아키텍처 (Port `8100`)
  - 정규장(09:00~15:30) / 시간외 동시호가 자동 감지 및 비동기 봇 스케줄러 (7초 주기)
- **정밀 가상 매매(Paper Trading) 체결 엔진 (`virtual_engine.mjs`)**
  - 키움증권 실시간 매도 1호가(매수 시) 및 매수 1호가(매도 시) 체결 슬리피지 반영
  - 위탁수수료(0.015%) 및 증권거래세(0.18%)를 정확히 차감한 순실현손익 계산
  - 누적 수익률, 승률, 손익비(Profit Factor), 최대 낙폭(MDD), 샤프 지수(Sharpe Ratio) 실시간 산출
  - **⚡ 30영업일 고속 시뮬레이션(Fast Replay Test)**: 야간/주말에도 알고리즘 성능 즉시 검증
  - **자금 격리 및 상호 간섭 방지**: 봇별 order_no 독립 관리, 가상 잔고 트랜잭션 락, 잔고 부족 시 자동 중지 및 모달 알림
- **Google Gemini 2.5 Flash 실시간 스트리밍 (SSE: Server-Sent Events)**
  - 수집된 국내 증시 뉴스 및 호재/악재 감성 분석 결과 실시간 종합 시황 리포트 생성
  - 18ms 간격 한 글자씩 부드러운 타자기(Typewriter) 효과 및 보라색 커서 애니메이션
- **듀얼 데이터베이스 (Dual Database)**
  - 기본 실시간 로컬 DB: SQLite (`data/auto_stock_trade.db`, WAL 모드)
  - 동기화 및 백업 DB: PostgreSQL 16 (`stock_trader` DB)
  - 백그라운드 동기화 매니저 (`pg_sync.mjs`)를 통한 8개 테이블 실시간 양방향/UPSERT 동기화
- **반응형 프리미엄 다크 테마 프론트엔드 (React 18 & Vite, Port `9900`)**
  - Pretendard 폰트 기반 `#0b0f19` 다크 테마, 2:8 화면 분할 레이아웃
  - 기본 보안 입장 코드 (`coin`, [환경설정]에서 변경 가능)
  - 국내 증시 표준 색상 적용 (이익 빨간색 `#ef4444`, 손해 파란색 `#3b82f6`)
  - 뉴스 테이블: 고정 48px Row 높이, 1줄 말줄임, 호버 툴팁, 50건 단위 페이지네이션

---

## 2. 국내주식 검증 완료 3대 매매 알고리즘

| 봇 ID | 알고리즘 명 | 전략 핵심 | 진입 / 청산 규칙 |
| :--- | :--- | :--- | :--- |
| `bot_kr_volatility_breakout` | **래리 윌리엄스 변동성 돌파 봇** | 당일 거래대금 상위 30위 데이트레이딩 | **진입**: 전일 변동폭 × 0.5 + 당일 시가 돌파 & 5분봉 거래량 200% 급증<br>**청산**: 15:15 장마감 전 전량 시간청산 (오버나잇 배제) 또는 +4.0% 익절 / -2.0% 손절 |
| `bot_kr_inst_dual_momentum` | **외인·기관 양매수 듀얼 모멘텀 봇** | 수급 팩터 + 듀얼 모멘텀 중단기 스윙 | **진입**: 최근 20거래일 수익률 상위 중 3일 연속 외인·기관 순매수 유입 & 20일선 정배열<br>**청산**: 5일선 이탈 또는 +7.0% 익절 / 트레일링 스톱 -3.0% |
| `bot_kr_bb_rsi_reversion` | **볼린저밴드 하단 + RSI 평균회귀 봇** | 우량 대형주(KOSPI200/KOSDAQ150) 역추세 | **진입**: 20일 볼린저밴드 하단선(-2σ) 이탈 후 재진입 양봉 & RSI ≤ 30 탈출<br>**청산**: 20일선 또는 상단선 도달 시 +3.5% 분할 익절 / -2.5% 손절 |

---

## 3. 디렉토리 구조

```text
autoStockTrader/
├── backend/
│   ├── node_server.mjs          # 백엔드 코어 HTTP 서버, SQLite 초기화, REST API, SSE 스트리밍
│   └── common/
│       ├── kiwoom_client.mjs    # 키움증권 Open API (시세/호가/지수 조회, KRX 호가 보정)
│       ├── toss_client.mjs      # 토스증권 Open API (주문 발송, 잔고/예수금 조회)
│       ├── virtual_engine.mjs   # 정밀 가상매매 체결, 30일 시뮬레이션, 성과지표(MDD/샤프) 계산
│       ├── news_service.mjs     # 네이버금융/한경/매경/공시 RSS 수집, 감성 분석, 태그 추출
│       └── pg_sync.mjs          # PostgreSQL 16 실시간 데이터 동기화 매니저
├── config/
│   ├── broker_config.json       # 키움증권/토스증권 API 및 Gemini 설정 파일 (Git 제외)
│   └── broker_config.example.json # 설정 파일 템플릿
├── data/
│   └── auto_stock_trade.db      # 로컬 SQLite 데이터베이스 (WAL 모드)
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # 프론트엔드 메인 컴포넌트 (5대 메뉴, AI 스트리밍, 검증소)
│   │   ├── main.jsx             # React 엔트리포인트
│   │   └── styles.css           # 다크 테마, 2:8 레이아웃, 동일 Row 높이 테이블, 모달 스타일
│   ├── index.html
│   ├── package.json
│   └── vite.config.js           # 0.0.0.0 바인딩, allowedHosts, /api 프록시 설정
├── scripts/
│   ├── setup_postgresql.sh      # PostgreSQL 16 stock_trader 계정 및 DB 자동 설정 스크립트
│   └── migrate_sqlite_to_pg.py  # SQLite -> PostgreSQL 전체 8개 테이블 마이그레이션 스크립트
├── start_services.sh            # 백엔드(8100) 및 프론트엔드(9900) 백그라운드 원클릭 실행 스크립트
├── stop_services.sh             # 실행 중인 서비스 정상 종료 스크립트
├── start_tunnel.sh              # Cloudflare 외부 인터넷 접속 보안 터널 실행 스크립트
├── stop_tunnel.sh               # Cloudflare 보안 터널 종료 스크립트
├── .env                         # LOCATION=local|outer, PostgreSQL 접속 정보, Gemini API 키
└── prompt.md                    # 전체 시스템 요구사항 및 기획서
```

---

## 4. 빠른 시작 가이드

### 1) 서비스 원클릭 시작
```bash
./start_services.sh
```
- 백엔드 (`http://127.0.0.1:8100`) 및 프론트엔드 (`http://127.0.0.1:9900`)가 백그라운드로 구동되고 헬스체크가 수행됩니다.
- 사내 LAN: `http://<내부IP>:9900`
- 게이트 입장 코드: `coin` (환경설정에서 변경 가능)

### 2) 서비스 종료
```bash
./stop_services.sh
```

### 3) PostgreSQL 16 연동 (선택)
```bash
# 1. PostgreSQL DB 및 사용자 생성 (root/sudo 권한 필요)
sudo ./scripts/setup_postgresql.sh

# 2. SQLite 데이터 수동 마이그레이션 실행
python3 ./scripts/migrate_sqlite_to_pg.py
```

### 4) 외부 접속 (Cloudflare Quick Tunnel)
```bash
# 터널 시작
./start_tunnel.sh

# 터널 종료
./stop_tunnel.sh
```
- 발급된 보안 HTTPS 주소(`https://*.trycloudflare.com`)를 통해 외부 모바일, 태블릿, 외부 PC 어디서나 포트포워딩 없이 안전하게 접속할 수 있습니다.
- 백엔드 API (`/api/*`)와 게이트 보안(`coin`)이 그대로 연동됩니다.

---

## 5. 형상 관리 (Git) 및 보안 규칙

- 키움증권 및 토스증권 API Key, Secret, 계좌번호 및 Gemini API 키 등 모든 민감 정보는 `.env` 및 `config/broker_config.json`에만 저장되며 Git 추적에서 제외됩니다.
- 원격 저장소: `https://github.com/wonsubshin/autoStockTrade.git`
- 커밋 메시지에는 개인정보나 계좌/키 정보가 일절 포함되지 않습니다.
