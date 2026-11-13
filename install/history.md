# 📜 autoStockTrader 버전별 변경 이력 (Version History)

이 문서는 **autoStockTrader** 프로젝트의 릴리즈별 수정 내역과 개발 히스토리를 기록하는 공식 체인지로그(Changelog)입니다.

---

## 📌 버전 관리 정책 (Version Policy)

1. **시작 버전**: `v0.0.1`부터 시작되었습니다.
2. **버전 증가 규칙**: **Git 커밋 1건당 패치(Patch) 버전을 1씩 순차 증가**시킵니다.
   - 예: `0.0.1` ➡️ `0.0.2` ➡️ `0.0.3` ➡️ ... ➡️ `0.0.X`
3. **규칙 유지 원칙**: 사용자의 별도 지침이나 명시적 변경 요청이 없는 한 **`0.0.숫자` 증가 형태를 지속적으로 유지**합니다.
4. **웹 대시보드 실시간 확인**: 
   - 웹 대시보드 상단 사이드바 브랜드 헤더 (`Kiwoom ⨉ Toss v0.0.X`)
   - 대시보드 메인 최하단 푸터 (`v0.0.X`)
   - 사이드바 시스템 상태 푸터 (`v0.0.X`)
   - 환경설정(Settings) 패널 ➡️ `시스템 버전 및 릴리즈 정보`
   - 백엔드 REST API: `GET /api/health` 응답의 `version` 필드

---

## 🚀 버전별 상세 변경 내역 (Changelog)

### [0.0.10] - 2026-11-13
- **커밋 성격**: `fix`
- **커밋 메시지**: `fix: 실전 매매 체결 병목 방어 및 스케줄러 동시성 락 강화, 게이트 인증 및 문서 정합성 일원화 (v0.0.10)`
- **주요 내용**: 전체 소스 코드 및 문서 정밀 전수 검사, 스케줄러 7초 주기 동시성 뮤텍스 락 보강, 게이트 기본 입장 코드(`sws@2129`) 일원화, `README.md` 원격 저장소 URL 및 라이선스 마크다운 링크 정정, 배포 번들 동기화
- **세부 변경사항**:
  - **스케줄러 동시성 락(Mutex) 보강 (`backend/services/scheduler_service.mjs`)**:
    - `runCycle()` 진입 시 `isRunningCycle`과 `isTickRunning`을 동시 검증 및 세팅하여 타이머 겹침 및 경쟁 상태(Race Condition)를 원천 차단
    - `finally` 블록에서 두 플래그를 모두 안전하게 해제하여 무중단 연속성 보장
  - **게이트 인증 기본 패스코드 일원화**:
    - `.env.example`, `env.mjs`, `setup_wizard`, `README.md`, `start_services.sh`, `SettingsPanel.jsx`, `GateModal.jsx` 전반의 게이트 패스코드 기본 표기를 `sws@2129`로 일치
    - 기존 `coin` 코드 또한 하위 호환성을 위해 백엔드 검증(`HealthController.verifyGateCode`)에서 계속 유효하도록 유지
  - **공식 문서 마크다운 및 원격 저장소 URL 정정 (`README.md`)**:
    - `README.md` 내 원격 저장소 안내 주소를 최신 공식 주소(`https://github.com/asura207/autoStockTrade.git`)로 갱신
    - 라이선스 섹션 마크다운 링크를 GitHub 공식 LICENSE URL로 완벽 연결
  - **패키지 메타데이터 및 배포 번들 동기화**:
    - `version.json`, `package.json`, `frontend/package.json`, `install/app/package.json` 버전을 `0.0.10`으로 통일
    - Vite 빌드 및 독립형 배포 패키지(`install/app/`) 자동 동기화

---

### [0.0.9] - 2026-11-13
- **커밋 성격**: `feat`
- **커밋 메시지**: `feat: 11번째 신규 퀀트 봇('잭 켈로그 VWAP 핵심레벨 돌파') 추가 및 전체 시스템 확장 (v0.0.9)`
- **주요 내용**: 11번째 신규 퀀트 봇(`bot_11_jack_kellogg_vwap`) 추가, 4대 순수 퀀트 수식 진입 필터 및 VWAP·시가 이탈 칼손절(Key Level Cut) 로직 구현, 가상 아레나 및 실전 매매 연동, UI/문서 동기화
- **세부 변경사항**:
  - **DB 시드 확장 (`backend/db/index.mjs`)**:
    - 11번째 퀀트 봇 객체 `bot_11_jack_kellogg_vwap` ('잭 켈로그 VWAP 핵심레벨 돌파', `KELLOGG-VWAP #11`, `JACK_KELLOGG_VWAP`) UPSERT 시드 등록
    - 가상 시드 10,000,000원, 목표 익절 +6.0%, 고정 손절 -2.0%, `is_virtual_running = 1` 가상 아레나 상시 가동 설정
  - **순수 퀀트 알고리즘 수식 엔진 (`backend/common/quant_algorithms.mjs`)**:
    - `evaluatePureQuantAlgorithm` 내 `case 'JACK_KELLOGG_VWAP':` 분기 추가
    - 4대 진입 조건 수식화:
      1. VWAP 상단 유지 (`price >= vwap`)
      2. 핵심 레벨 상회 (`price > openPrice && changePct >= 1.5`)
      3. 거래량 폭발 필터 (`volumeRatio >= 2.0`)
      4. 당일 고가 부근 눌림/횡보 후 돌파 (`distFromHighPct <= 3.5`) 및 극단적 과열 추격 방지 (`rsi <= 78`)
  - **잭 켈로그 전용 칼손절(Key Level Cut) 청산 로직 (`backend/services/scheduler_service.mjs`)**:
    - Track A (가상 아레나) 및 Track B (실전 매매) 청산 루프 모두에 `JACK_KELLOGG_VWAP` 전략 전용 핵심 지지선 이탈 검사 탑재
    - 주가가 VWAP(-0.5% 버퍼)과 당일 시가를 동시에 하향 이탈(`curPrice < vwapPrice * 0.995 && curPrice < openPrice`) 시 고정 손절선(-2.0%) 도달 전이라도 즉시 조기 칼손절 집행
  - **30일 고속 시뮬레이션 및 봇 서비스 확장 (`virtual_engine.mjs`, `bot_service.mjs`)**:
    - 30일 고속 시뮬레이션(`runFastReplayTest`)에 11번째 봇 전략 정의 추가 및 백테스팅 지원
    - 전체 11대 가상 봇 실시간 메트릭 산출 및 실전 1~3대 봇 선택/예산 분배 연동
  - **프론트엔드 UI 및 설치 마법사 동기화**:
    - `LabPanel.jsx`, `SettingsPanel.jsx`, `App.jsx`: "10대 봇" 하드코딩 표기를 동적 봇 개수 및 "11대 퀀트 봇"으로 전면 갱신
    - 온보딩 마법사(`wizard_ui.html`) 및 독립 패키지 안내서(`README_INSTALL.txt`) 문구 동기화
  - **공식 기술 문서 최신화**:
    - `README.md`, `prompt.md`의 퀀트 전략 종합 요약표에 11번 `bot_11_jack_kellogg_vwap` 명세 추가
  - **패키지 메타데이터 및 배포 번들 동기화**:
    - `version.json`, `package.json`, `frontend/package.json`, `install/app/package.json` 버전을 `0.0.9`로 일괄 업데이트
    - Vite 빌드 및 독립형 배포 패키지(`install/app/`) 자동 동기화

---

### [0.0.8] - 2026-11-13
- **커밋 성격**: `feat`
- **커밋 메시지**: `feat: 실전 수익 통계 상단 이번달 1일 및 현재 평가자산 증감 표기, 월별 기록 및 그래프 시각화 추가 (v0.0.8)`
- **주요 내용**: 실전 수익 통계 상단 이번 달 1일 시점 평가자산, 현재 시점 평가자산, 증감액/율 표기, 월별 스냅샷 자동 기록 및 반응형 차트 구현
- **세부 변경사항**:
  - **월별 평가자산 스냅샷 DB 설계**:
    - SQLite 및 PostgreSQL 듀얼 DB에 `monthly_asset_snapshots` 테이블 신설 (`backend/db/index.mjs`)
    - 연월(`year_month`), 1일 평가자산(`month_start_asset`), 현재 평가자산(`current_asset`), 증감액(`change_krw`), 증감율(`change_pct`) 등 저장
  - **월별 자산 스냅샷 관리 서비스 개발**:
    - `backend/services/asset_snapshot_service.mjs` 신설
    - 토스증권 실계좌 실시간 잔고(`tossClient.getAccountBalance()`)와 연동하여 1일 평가자산 및 현재 시점 평가자산 자동 산출/저장
    - 스케줄러(`scheduler_service.mjs`) 5분 주기로 스냅샷 자동 갱신 및 월 단위 자동 보존 파이프라인 구축
    - 과거 월(9월, 10월) 비교 기준 시드 데이터 자동 초기화 지원
  - **통계 API 및 컨트롤러 확장**:
    - `backend/services/trade_service.mjs`: `getStats()` 내에 `monthlyAssets` 데이터 자동 탑재 및 `getMonthlyAssets()` 정적 메서드 추가
    - `backend/controllers/trade_controller.mjs` 및 `router.mjs`: 비동기 처리 파이프라인 정비 및 `GET /api/stats/monthly-assets` 엔드포인트 개설
  - **프론트엔드 통계 UI 및 인터랙티브 차트 구현**:
    - `frontend/src/components/stats/MonthlyAssetSection.jsx` 신설
    - 상단 3단 주요 지표 카드: 이번 달 1일 평가자산, 현재 시점 총 평가자산, 자산 증감액/증감율(늘어남 ▲ / 줄어듬 ▼ 배지)
    - 고해상도 SVG 기반 월별 보유 자산 증감 반응형 차트:
      - `월초 vs 월말 자산 총액 비교` 듀얼 바 차트 모드
      - `월별 순증감액 (+/-)` 0선 기준 모드
      - 막대 호버 시 툴팁 및 상세 금액 인터랙션 제공
    - `frontend/src/components/stats/StatsPanel.jsx` 최상단에 월별 자산 섹션 통합
  - **실전 봇 3개 복원 및 분배 방어 로직 개선**:
    - 봇 3개(`momentum_bot_real`, `scalping_bot_real`, `swing_bot_real`) 정상 활성화 및 예산 분배 비율 가드 보강 (`backend/services/bot_service.mjs`)
  - **배포 및 패키지 메타데이터 동기화**:
    - `version.json`, `package.json`, `frontend/package.json`, `install/app/package.json` 버전을 `0.0.8`로 일괄 업데이트
    - Vite 빌드 및 독립형 배포 패키지(`install/app/`) 자동 동기화

---

### [0.0.7] - 2026-11-12
- **커밋 성격**: `feat`
- **커밋 메시지**: `feat: 프로젝트 버전 체계(0.0.X) 확립, history.md 제정 및 웹 대시보드 버전 UI/API 연동`
- **주요 내용**: 프로젝트 버전 관리 체계(0.0.X) 확립, `history.md` 제정 및 웹 대시보드 전반 버전 표시 UI/API 연동
- **세부 변경사항**:
  - **버전 정책 수립**: Git 커밋 1건당 1씩 증가하는 `0.0.X` 버전 규칙 확립 및 단일 소스(`version.json`) 구축
  - **히스토리 문서화**: 프로젝트 기원(`0.0.1`)부터 현재까지의 전체 커밋 히스토리를 상세 정리한 `history.md` 신규 생성
  - **백엔드 연동**: `backend/config/version.mjs` 신설 및 `GET /api/health` 응답에 `version: APP_VERSION` 필드 탑재
  - **웹 대시보드 UI 연동**:
    - 사이드바 브랜드 타이틀 옆 실시간 버전 배지(`brand-version-badge`) 추가
    - 사이드바 최하단 시스템 정보에 버전 표기 연동
    - 메인 대시보드 하단 푸터(`app-footer`)에 버전 배지 추가
    - 환경설정(`SettingsPanel.jsx`) 내 6번째 섹션 `시스템 버전 및 릴리즈 정보` 신설
  - **패키지 메타데이터 동기화**: `package.json`, `frontend/package.json`, `install/app/package.json` 버전을 `0.0.7`로 통일
  - **배포 번들 빌드**: Vite 프로덕션 빌드 및 `/install` 독립형 배포 패키지(`install/app/frontend_dist`) 동기화 완료
  - **버전 범프 유틸리티**: 차기 커밋 시 자동 버전 관리를 돕는 `scripts/bump_version.mjs` 스크립트 제공

---

### [0.0.6] - 2026-11-12
- **커밋 해시**: `41eebe58f2e23e83c9e59626825cdf19926f92a0`
- **커밋 성격**: `fix`
- **커밋 메시지**: `fix: 푸터(Footer) 레이아웃 위치 오류 수정 및 하단 배치 고정`
- **세부 변경사항**:
  - **레이아웃 수정**: `App.jsx` 내 `footer` 요소를 수평 `app-container`의 flex 자식에서 `main-content` 내부 최하단으로 이동
  - **스타일 개선**: `styles.css` 내 `.main-content`에 `flex-direction: column` 적용 및 `.app-footer` 하단 밀착/패딩/여백 스타일 추가
  - **반응형 최적화**: 모바일(900px 및 480px 이하) 환경에서도 푸터가 메인 컨텐츠 영역 최하단에 자연스럽게 밀착되도록 조정
  - **배포 번들 동기화**: Vite 프로덕션 빌드 재수행 및 `/install` 독립형 배포 패키지(`frontend_dist`) 정적 애셋 갱신

---

### [0.0.5] - 2026-11-12
- **커밋 해시**: `96f2f3e22f1f7539f4dce5ce84945e5cb0fff419`
- **커밋 성격**: `docs`
- **커밋 메시지**: `docs: README.md 10대 퀀트 봇 명세 현행화, 듀얼 DB 정합성 통일 및 기본 패스코드 일원화`
- **세부 변경사항**:
  - **문서 현행화**: `README.md` 최상단에 Apache 2.0 라이선스 및 최신 기술 스택 배지 보강
  - **10대 퀀트 봇 명세 수록**: 구버전 3대 봇 설명 표를 실제 소스코드에 구현된 10대 퀀트 알고리즘 봇(단기 모멘텀, 골든크로스, 볼린저밴드, RSI 역추세, 수급 추종, 변동성 돌파 등) 명세로 전면 현행화
  - **듀얼 DB 아키텍처 정합성 통일**: 내장 SQLite(WAL 초고속 모드) ⨉ 외부 PostgreSQL 16 듀얼 DB 실시간 동기화 파이프라인 구조 명세 정비
  - **보안 패스코드 일원화**: 대시보드 기본 입장 패스코드를 `sws@2129`로 `README.md`, 설정 마법사 UI/서버, 배포 안내서 전반에 단일화
  - **디렉토리 구조 현행화**: `/install` 패키지 및 최신 디렉토리 트리 반영

---

### [0.0.4] - 2026-11-12
- **커밋 해시**: `7c4f3b1c4a66b2caacecf34ae67cbe2dc82d19cc`
- **커밋 성격**: `feat`
- **커밋 메시지**: `feat: 비개발자용 원클릭 독립 배포 패키지(/install), 웹 설정 마법사 및 DB 동기화 고도화`
- **세부 변경사항**:
  - **원클릭 배포 패키지 구축**: 비개발자 사용자를 위한 Windows(`AutoStockTrader_Windows_Run.bat`), Linux(`AutoStockTrader_Linux_Run.sh`) 독립형 실행 런처 및 종료 스크립트 작성
  - **독립 패키지 빌더**: 전체 프로젝트를 의존성 포함 배포형으로 패키징하는 `scripts/build_installer.mjs` 자동화 스크립트 구현
  - **웹 설정 마법사 (Setup Wizard)**: 최초 사용자를 위한 Step-by-Step 웹 설정 마법사(포트 3001) 및 독립 서버/UI 탑재
  - **DB 동기화 모듈 (pg_sync)**: SQLite WAL ⨉ PostgreSQL 16 실시간 백그라운드 동기화 모듈(`backend/db/pg_sync.mjs`) 탑재 및 DB 격리 안정화
  - **텔레그램 알림 연동**: 실전/가상 매매 체결 및 시스템 경고를 실시간 발송하는 `notification_service.mjs` 연동
  - **프론트엔드 예산 관리 바**: 실시간 실전 총예산 및 봇별 예산 배분 슬라이더 UI(`BudgetBar.jsx`) 추가 및 대시보드 연동
  - **컨테이너 오케스트레이션**: `Dockerfile` 및 `docker-compose.yml` 구성 파일 추가

---

### [0.0.3] - 2026-11-11
- **커밋 해시**: `79f725c4fd4cff1e0bf76f3ad13b45528060158a`
- **커밋 성격**: `feat`
- **커밋 메시지**: `feat: 키움/토스 하이브리드 국내·미국 주식 자동매매 및 Gemini LLM 듀얼 트랙 리스크 관리 고도화`
- **세부 변경사항**:
  - **하이브리드 브로커 파이프라인**: 
    - 키움 Open API (국내 0초 지연 실시간 호가/체결 시세)
    - 토스증권 Open API (미국 실시간 시세 및 0.0001주 단위 소수점/단주 매매)
    - 기존 KIS 클라이언트 대비 키움-토스 하이브리드 특화 구조로 엔진 개편
  - **Gemini LLM 듀얼 트랙 고도화**: 실시간 뉴스 감성 분석(Bull/Bear 점수화)과 시장 거시 체제(Regime Filter) 판별 듀얼 트랙 프롬프트 추론 최적화
  - **가상 경쟁 아레나(Virtual Arena)**: 10대 알고리즘 봇 실시간 시뮬레이션 매매 엔진(`virtual_engine.mjs`) 및 스케줄러 동기화 강화
  - **프론트엔드 UI 대대적 개편**: `HybridBoard`, `PositionsTable`, `StatsPanel`, `NewsPanel` 컴포넌트 기능 고도화

---

### [0.0.2] - 2026-11-10
- **커밋 해시**: `dfa3f720dbbfb4e69d0b08369cedecbdbf908dca`
- **커밋 성격**: `chore`
- **커밋 메시지**: `Create LICENSE`
- **세부 변경사항**:
  - **오픈소스 라이선스 제정**: `Apache License 2.0` 정식 라이선스 파일(`LICENSE`) 추가
  - **법적 권리 및 면책 조항 정의**: 시스템 사용에 따른 상업적 이용 가능 범위 및 투자 손실에 대한 개발자 면책 조항 법적 근거 마련

---

### [0.0.1] - 2026-11-09
- **커밋 해시**: `817bf2afb8b48eddcbedfc829ec7360c2d9460a9`
- **커밋 성격**: `feat`
- **커밋 메시지**: `초기화 후 재커밋`
- **세부 변경사항**:
  - **최초 베이스라인 시스템 구축**: 키움 Open API 시세 조회 및 토스/KIS 증권 매매 연동 백엔드 기반 구축
  - **백엔드 HTTP 서버**: Node.js 순수 HTTP 모듈 기반 고성능 경량 REST API 서버(`backend/node_server.mjs`) 및 라우터 구현
  - **리액트 대시보드 UI**: Vite + React 18 기반 5개 탭 네비게이션(실전 매매, 가상 아레나, 수익 통계, AI 뉴스, 환경설정) 단일 페이지 애플리케이션(SPA) 구축
  - **AI 감성 분석 워커**: Google Gemini LLM 기반 실시간 뉴스 수집 및 투자 리스크 분석 Python 파이프라인(`llm_filter_worker.py`) 연동
  - **데이터베이스 아키텍처**: 내장 SQLite 초고속 캐싱 및 외부 PostgreSQL 16 영구 스토리지 듀얼 데이터베이스 기본 설계
  - **시스템 관리 스크립트**: 원클릭 서비스 기동(`start_services.sh`), 종료(`stop_services.sh`), Cloudflare 보안 터널링(`start_tunnel.sh`) 제공
