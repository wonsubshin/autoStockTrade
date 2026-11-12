# 🇰🇷 키움증권(시세조회) ⨉ 토스증권(주문체결) 기반 다중 전략 국내주식 자동매매 & 가상매매 AI 퀀트 시스템

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **국내주식 시세 및 호가 조회는 키움증권 Open API**, **실전 주문 및 잔고 관리는 토스증권 Open API**를 연동한 하이브리드 고성능 국내주식 실전/가상 자동매매 & 실시간 AI 증시 인텔리전스 시스템 (Backend + Frontend + Dual DB + Virtual Paper Trading Engine + AI Streaming + Network Tunnel)

---

## 🚀 0. [비개발자용] 크로스 플랫폼(Windows / Linux) 원클릭 배포 패키지 (`/install`)

비개발자(일반 사용자)도 복잡한 빌드나 명령어 입력 없이 **`/install` 폴더 하나만 전달받으면 Windows와 Linux 어디서든 더블클릭 한 번으로 즉시 구동**할 수 있습니다.

```text
autoStockTrader/
└── install/                                  # [완전 독립형 배포 패키지] 이 폴더만 압축해서 전달하면 즉시 구동 가능
    ├── AutoStockTrader_Windows_Run.bat       # Windows 원클릭 설치 & 실행 런처 (더블클릭 실행)
    ├── AutoStockTrader_Windows_Stop.bat      # Windows 서비스 일괄 종료 스크립트
    ├── AutoStockTrader_Linux_Run.sh          # Linux 원클릭 설치 & 실행 런처 (바탕화면 아이콘 자동 생성)
    ├── AutoStockTrader_Linux_Stop.sh         # Linux 서비스 일괄 종료 스크립트
    ├── setup_wizard/                         # 최초 실행 시 자동으로 뜨는 Step-by-Step 설정 마법사
    │   ├── wizard_server.mjs                 # 마법사 전용 경량 백엔드 (포트 9901)
    │   └── wizard_ui.html                    # 반응형 다크 테마 온보딩 인터페이스
    ├── app/                                  # 자급자족(Self-Contained) 코어 애플리케이션
    │   ├── backend/                          # 백엔드 엔진 & Python 토스 주문 브릿지
    │   ├── frontend_dist/                    # 사전 빌드된 React 웹 대시보드 (9900 포트)
    │   ├── frontend_server.mjs               # Node.js 내장 정적 서빙 & 리버스 프록시 서버
    │   ├── config/                           # broker_config.json 저장 위치
    │   ├── data/                             # 내장 SQLite DB(auto_stock_trade.db) 저장 위치
    │   ├── logs/                             # 실행 로그 저장 위치
    │   └── node_modules/                     # 필수 런타임 의존성 번들링
    └── README_INSTALL.txt                    # 비개발자용 1분 요약 안내서
```

### 📋 1) 사전 준비 사항
1. **Node.js 런타임 (v20 이상 설치 권장, v22 LTS 추천)**
   - [공식 다운로드 링크 (https://nodejs.org)](https://nodejs.org)
   - 설치 프로그램(MSI/PKG/RPM)을 기본값으로 설치합니다.
2. **Python 3.12 (또는 Python 3.10 이상)**
   - [공식 다운로드 링크 (https://www.python.org/downloads)](https://www.python.org/downloads/)
   - ⚠️ **Windows 사용자 필수 주의**: 설치 첫 화면 하단의 **`Add python.exe to PATH`** 체크박스를 반드시 선택하고 설치하세요.
3. **증권사 및 AI API 키 발급처 (마법사 또는 대시보드 환경설정에서 등록)**
   - **키움증권 Open API (국내 실시간 시세/호가용)**: [키움 Open API 서비스 포털](https://openapi.kiwoom.com) (미보유 시 시뮬레이션 호가 모드로 즉시 체험 가능)
   - **토스증권 Open API (국내/미국 실전 주문 및 잔고용)**: [토스 개발자 센터](https://openapi.tossinvest.com)
   - **Google Gemini API Key (뉴스 감성 분석 & 퀀트 리스크 제어용)**: [Google AI Studio (무료 발급)](https://aistudio.google.com)

### 🖥️ 2) 운영체제별 원클릭 실행 방법
- **Windows 환경**:
  1. `/install` 폴더 내의 `AutoStockTrader_Windows_Run.bat` 파일을 더블클릭합니다.
  2. 최초 실행 시 웹 브라우저에 **Step-by-Step 설정 마법사 창(http://127.0.0.1:9901)**이 자동으로 뜹니다.
  3. 설정 완료 시 백엔드(8100)와 프론트엔드(9900)가 자동 기동되며 메인 대시보드로 이동합니다.
- **Linux 환경**:
  1. 터미널에서 `./AutoStockTrader_Linux_Run.sh`를 실행하거나 바탕화면에 자동 생성된 `AutoStockTrader` 아이콘을 더블클릭합니다.
  2. 브라우저에서 마법사를 완료하면 자동으로 `http://127.0.0.1:9900` 대시보드로 연결됩니다.

### 🗄️ 3) 데이터베이스(DB) 선택 기준 (마법사 2단계)
- 🟢 **`[DB 서버 없음 (추천 · 기본값)] - 내장 SQLite 사용`**:
  - 별도의 데이터베이스 서버가 없어도 PC 내부 파일(`data/auto_stock_trade.db`, WAL 초고속 모드)로 모든 거래 내역과 10대 퀀트 봇 데이터를 안전하게 보관합니다.
  - 외부 DB 설치 및 비밀번호 관리 부담이 없어 **일반 사용자에게 강력히 권장**합니다.
- 🔵 **`[DB 서버 있음 (고급)] - 외부/로컬 PostgreSQL 16 서버 연동`**:
  - 이미 PostgreSQL 데이터베이스를 보유 중인 경우 호스트, 포트, 계정을 입력하고 `[🔌 접속 테스트 및 테이블 자동 생성]`을 클릭하면 8개 핵심 테이블과 시드 데이터를 자동 생성하고 실시간 이중 백업을 수행합니다.

### 🪄 4) Step-by-Step 초기 설정 마법사 단계 안내
- **[Step 1] 환경 점검**: OS 사양, Node.js v20+, Python 3.12+, 포트 8100/9900 가용성 자동 진단
- **[Step 2] DB 선택**: 내장 SQLite (권장) 또는 외부 PostgreSQL 16 분기 선택
- **[Step 3] API 키 연동**: 키움증권, 토스증권, Gemini AI 키 입력 (시뮬레이션 모드 지원)
- **[Step 4] 보안 & 예산**: 대시보드 입장 패스코드 (기본값: `coin`), 실전 예산 (기본 1천만원), 10대 봇 가상 시드 설정
- **[Step 5] 원클릭 기동**: 설정 파일 자동 생성, DB 스키마 주입, 백엔드/프론트엔드 백그라운드 자동 기동 및 메인 화면 자동 이동

### 🛑 5) 서비스 종료 방법
- **Windows**: `AutoStockTrader_Windows_Stop.bat` 더블클릭
- **Linux**: `./AutoStockTrader_Linux_Stop.sh` 실행

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
  - `node:http`와 PostgreSQL 16 기반 초경량·고신뢰성 아키텍처 (Port `8100`)
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
- **데이터베이스 (Database)**
  - 메인 실시간 DB: PostgreSQL 16 (`stock` DB)
  - 10개 핵심 테이블 실시간 직접 트랜잭션 및 원장 보존
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
│   ├── node_server.mjs          # 백엔드 코어 HTTP 서버, DB 초기화, REST API, SSE 스트리밍
│   ├── db/
│   │   ├── index.mjs            # PostgreSQL 16 전용 고성능 동기 어댑터 및 스키마
│   │   └── pg_worker.mjs        # PostgreSQL 16 커넥션 풀 워커
│   └── common/
│       ├── kiwoom_client.mjs    # 키움증권 Open API (시세/호가/지수 조회, KRX 호가 보정)
│       ├── toss_client.mjs      # 토스증권 Open API (주문 발송, 잔고/예수금 조회)
│       ├── virtual_engine.mjs   # 정밀 가상매매 체결, 30일 시뮬레이션, 성과지표(MDD/샤프) 계산
│       └── news_service.mjs     # 네이버금융/한경/매경/공시 RSS 수집, 감성 분석, 태그 추출
├── config/
│   ├── broker_config.json       # 키움증권/토스증권 API 및 Gemini 설정 파일 (Git 제외)
│   └── broker_config.example.json # 설정 파일 템플릿
├── data/                        # 데이터 백업 및 리소스 디렉터리
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
- 게이트 입장 코드: `sws@2129` (환경변수 `GATE_PASSCODE` 또는 환경설정에서 변경 가능)

### 2) 서비스 종료
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

- 키움증권 및 토스증권 API Key, Secret, 계좌번호 및 Gemini API 키 등 모든 민감 정보는 `.env` 및 `config/broker_config.json`에만 저장되며 Git 추적에서 제외됩니다.
- 원격 저장소: `https://github.com/wonsubshin/autoStockTrade.git`
- 커밋 메시지에는 개인정보나 계좌/키 정보가 일절 포함되지 않습니다.

---

## ⚖️ 6. 라이선스 및 법적 면책 조항 (Disclaimer)

### 라이선스 (License)
본 프로젝트는 **[Apache License 2.0](LICENSE)**에 따라 배포됩니다.

### 법적 면책 조항 (Legal Disclaimer)
> ⚠️ **주의 및 고지**: **본 소프트웨어의 사용으로 발생하는 모든 투자 손실의 책임은 사용자 본인에게 있으며, 제작자는 투자 자문이나 수익을 보장하지 않습니다.**  
> 본 프로그램은 퀀트 알고리즘 연구 및 시스템 개발을 목적으로 제작된 오픈소스 소프트웨어입니다. 실제 금융 시장 매매 주문 집행 및 자금 운용에 따른 모든 법적, 금전적 위험 부담은 전적으로 사용자 본인에게 있습니다.
