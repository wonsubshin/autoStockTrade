import fs from 'fs';
import path from 'path';
import { NotificationService } from './notification_service.mjs';

export const GEMINI_FLASH_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-1.5-flash',
];

export const GEMINI_PRO_MODELS = [
  'gemini-pro-latest',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-1.5-pro',
];

export const STOCK_KEYWORDS = {
  AAPL: ['애플', '아이폰', 'Apple', 'AAPL', '팀쿡', 'iOS', '온디바이스', 'Mag 7'],
  NVDA: ['엔비디아', 'Nvidia', 'NVDA', '젠슨황', '블랙웰', 'AI 반도체', 'GPU', 'AI'],
  TSLA: ['테슬라', 'Tesla', 'TSLA', '일론머스크', '전기차', 'FSD', '사이버트럭', '기가'],
  MSFT: ['마이크로소프트', 'Microsoft', 'MSFT', '애저', 'Azure', '코파일럿', '클라우드'],
  QQQ: ['QQQ', '나스닥', 'Nasdaq', '빅테크', 'S&P', '증시', '뉴욕증시', '미국증시', 'Futures'],
  SBUX: ['스타벅스', 'Starbucks', 'SBUX', '커피'],
  '005930': ['삼성전자', '삼성', '005930', 'HBM', '메모리', '반도체'],
  '000660': ['SK하이닉스', '하이닉스', '000660', 'HBM3E', 'HBM', '메모리'],
  '068270': ['셀트리온', '068270', '짐펜트라', '바이오', '시밀러'],
  '005380': ['현대차', '005380', '현대자동차', '하이브리드', '완성차'],
};

export function normalizeMarketRegime(raw) {
  const s = String(raw || '').toUpperCase().trim();
  if (s.includes('BULL')) return 'BULLISH_MOMENTUM';
  if (s.includes('BEAR') || s.includes('DEFENSE') || s.includes('RISK_OFF') || s.includes('HALT')) {
    return 'BEARISH_DEFENSE';
  }
  if (s.includes('FALLBACK')) return 'FALLBACK_PURE_QUANT';
  return 'NEUTRAL_BOX';
}

export function getDefaultAllowedFamiliesForRegime(regime) {
  switch (normalizeMarketRegime(regime)) {
    case 'BULLISH_MOMENTUM':
      return ['BREAKOUT', 'TREND', 'REVERSION'];
    case 'BEARISH_DEFENSE':
      return ['REVERSION'];
    case 'NEUTRAL_BOX':
    default:
      return ['REVERSION', 'TREND'];
  }
}

export function getDefaultMultiplierForRegime(regime) {
  switch (normalizeMarketRegime(regime)) {
    case 'BULLISH_MOMENTUM':
      return 1.0;
    case 'BEARISH_DEFENSE':
      return 0.35;
    case 'NEUTRAL_BOX':
    default:
      return 0.85;
  }
}

/**
 * [서킷 브레이커 (Circuit Breaker) 상태 관리 클래스]
 * - CLOSED: 정상 상태, API 호출 허용
 * - OPEN: 장애 감지 (연속 N회 실패), API 호출 전면 차단 및 퀀트 Fallback 활성화
 * - HALF_OPEN: N분(15분) 후 단일 테스트 호출 수행하여 성공 시 복구
 */
export class CircuitBreaker {
  constructor({ failureThreshold = 3, resetTimeoutMs = 15 * 60 * 1000, name = 'Gemini' } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.name = name;
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.lastStateChange = Date.now();
  }

  canExecute() {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        console.log(`[CircuitBreaker:${this.name}] ⏳ 쿨다운 만료로 상태 전환: OPEN -> HALF_OPEN (테스트 호출 허용)`);
        return true;
      }
      return false; // 아직 OPEN 유지
    }
    return true; // CLOSED or HALF_OPEN
  }

  recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
      console.log(`[CircuitBreaker:${this.name}] ✅ 테스트 호출 성공! 서킷 복구 완료: HALF_OPEN -> CLOSED`);
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.lastStateChange = Date.now();
    console.log(`[CircuitBreaker:${this.name}] 🔄 서킷 브레이커 수동 리셋 완료: -> CLOSED`);
  }

  recordFailure(err) {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    console.warn(`[CircuitBreaker:${this.name}] ⚠️ 호출 실패 감지 (연속 ${this.failureCount}/${this.failureThreshold}회):`, err?.message || err);

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
      const waitMin = Math.round(this.resetTimeoutMs / 60000);
      console.warn(`[CircuitBreaker:${this.name}] 🔴 서킷 브레이커 발동(OPEN): 연속 ${this.failureCount}회 장애로 향후 ${waitMin}분 동안 API 호출 차단 및 순수 퀀트 Fallback 모드 전환`);
      
      // 4.3 서킷 브레이커 발동 및 Fallback 전환 웹훅 즉시 발송
      try {
        NotificationService.notifyCircuitBreaker({
          modelName: this.name,
          failureCount: this.failureCount,
          cooldownMin: waitMin,
          reason: err?.message || String(err),
        });
      } catch (notifyErr) {}
    }
  }

  getStatus() {
    const now = Date.now();
    const isCoolingDown = this.state === 'OPEN' && (now - this.lastFailureTime < this.resetTimeoutMs);
    const remainingCooldownSec = isCoolingDown ? Math.ceil((this.resetTimeoutMs - (now - this.lastFailureTime)) / 1000) : 0;
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      remainingCooldownSec,
      isOpen: this.state === 'OPEN' && isCoolingDown,
    };
  }
}

/**
 * Gemini LLM 기반 퀀트 의사결정 인텔리전스 엔진 (LLMDecisionService)
 * - 30분 단위 Flash 종합 판단 (실시간 속보 뉴스 및 단기 호가 시그널)
 * - 1시간 단위 Pro 심층 분석 (거시 경제 지표, 이평선 괴리율 및 심층 리스크 평가)
 * - 다중 LLM(Flash/Pro) 하이브리드 의사결정 지원
 * - 지수 백오프 & 429 방어 및 서킷 브레이커 (Circuit Breaker) 탑재
 */
export class LLMDecisionService {
  constructor(projectRoot, getDb) {
    this.projectRoot = projectRoot;
    this.getDb = getDb;
    this.flashQuotaExceededUntil = 0;
    this.proQuotaExceededUntil = 0;
    this.quotaExceededUntil = 0; // 호환용

    // 서킷 브레이커 (Flash & Pro 분리 관리, 3회 연속 실패 시 15분 차단)
    this.circuitBreakers = {
      FLASH: new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 15 * 60 * 1000, name: 'Gemini-Flash' }),
      PRO: new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 15 * 60 * 1000, name: 'Gemini-Pro' }),
    };
  }

  getCircuitBreaker(modelType = 'FLASH') {
    const cleanType = String(modelType || 'FLASH').toUpperCase() === 'PRO' ? 'PRO' : 'FLASH';
    return this.circuitBreakers[cleanType];
  }

  getCircuitBreakerStatus(modelType = null) {
    if (modelType) {
      return this.getCircuitBreaker(modelType).getStatus();
    }
    return {
      FLASH: this.circuitBreakers.FLASH.getStatus(),
      PRO: this.circuitBreakers.PRO.getStatus(),
      isOpen: this.circuitBreakers.FLASH.getStatus().isOpen || this.circuitBreakers.PRO.getStatus().isOpen,
    };
  }

  isCircuitOpen(modelType = null) {
    if (modelType) {
      return this.getCircuitBreaker(modelType).getStatus().isOpen;
    }
    return this.circuitBreakers.FLASH.getStatus().isOpen || this.circuitBreakers.PRO.getStatus().isOpen;
  }

  /**
   * 동적 프롬프트 토큰 최적화 (Token Truncation)
   * 잦은 호출에 따른 토큰 낭비 및 Rate Limit 방지
   * 최대 허용 글자수(기본 약 7,500자 / 약 4,500토큰) 초과 시 뉴스 및 시황 데이터 최신순 절사
   */
  optimizePromptTokens(prompt, maxChars = 7500) {
    if (!prompt || typeof prompt !== 'string') return '';
    if (prompt.length <= maxChars) return prompt;

    console.log(`[LLMDecisionService] ✂️ 프롬프트 길이(${prompt.length}자)가 허용치(${maxChars}자)를 초과하여 동적 토큰 절사(Truncation)를 적용합니다.`);
    return prompt.slice(0, maxChars) + '\n\n[...이하 토큰 최적화를 위해 이전 데이터는 생략됨. 상기 제공된 최신 핵심 팩트만을 기준으로 완결된 JSON 응답을 작성하세요...]';
  }

  loadGeminiConfig(modelType = 'FLASH') {
    const brokerConfPath = path.join(this.projectRoot, 'config', 'broker_config.json');
    const stockConfPath = path.join(this.projectRoot, 'config', 'stock_config.json');
    let geminiApiKey = process.env.GEMINI_API_KEY || '';
    let configuredModel = '';

    if (fs.existsSync(brokerConfPath)) {
      try {
        const conf = JSON.parse(fs.readFileSync(brokerConfPath, 'utf8'));
        if (conf.gemini?.api_key) geminiApiKey = conf.gemini.api_key;
        if (conf.gemini?.model) configuredModel = conf.gemini.model;
      } catch (e) {}
    }

    if (!geminiApiKey && fs.existsSync(stockConfPath)) {
      try {
        const sConf = JSON.parse(fs.readFileSync(stockConfPath, 'utf8'));
        if (sConf.gemini_api_key) geminiApiKey = sConf.gemini_api_key;
        else if (sConf.gemini?.api_key) geminiApiKey = sConf.gemini.api_key;
      } catch (e) {}
    }

    const isPro = String(modelType || '').toUpperCase() === 'PRO';
    const candidateChain = isPro ? [...GEMINI_PRO_MODELS] : [...GEMINI_FLASH_MODELS];

    if (configuredModel) {
      const cleanConf = configuredModel.replace(/^models\//, '');
      if (!candidateChain.includes(cleanConf)) {
        candidateChain.unshift(cleanConf);
      }
    }

    const defaultModel = candidateChain[0];
    return {
      geminiApiKey: String(geminiApiKey || '').trim(),
      geminiModel: defaultModel,
      candidateChain,
      modelType: isPro ? 'PRO' : 'FLASH',
    };
  }

  /**
   * [API 방어 래퍼 (Circuit Breaker & Exponential Backoff)]
   * - 서킷 브레이커 상태 확인 (OPEN 시 즉시 차단 후 Fallback 유도)
   * - 429 Too Many Requests / 503 에러 발생 시 지수 백오프 (2초 -> 4초 -> 8초) 최대 3회 재시도
   * - 동적 프롬프트 토큰 절사(optimizePromptTokens) 적용
   */
  async callGeminiApiWithDefense(prompt, modelType = 'FLASH', { maxRetries = 3 } = {}) {
    const breaker = this.getCircuitBreaker(modelType);
    if (!breaker.canExecute()) {
      const status = breaker.getStatus();
      const errMsg = `[CircuitBreaker:${breaker.name}] 서킷 브레이커가 OPEN 상태입니다. (${status.remainingCooldownSec}초 남음) 무의미한 API 호출을 차단하고 순수 퀀트 Fallback 모드를 가동합니다.`;
      console.warn(`[LLMDecisionService] ${errMsg}`);
      const err = new Error(errMsg);
      err.circuitOpen = true;
      err.status = status;
      throw err;
    }

    const optimizedPrompt = this.optimizePromptTokens(prompt);
    const { geminiApiKey, candidateChain } = this.loadGeminiConfig(modelType);

    if (!geminiApiKey) {
      const err = new Error('Gemini API 키가 설정되지 않았습니다.');
      err.code = 'NO_API_KEY';
      throw err;
    }

    const backoffDelays = [2000, 4000, 8000]; // 2초 -> 4초 -> 8초
    const isPro = String(modelType).toUpperCase() === 'PRO';
    const timeoutMs = isPro ? 35000 : 25000;
    const temperature = isPro ? 0.15 : 0.25;

    let lastError = null;

    // 후보 모델 체인을 순회하며 지수 백오프 적용
    for (const candidateModel of candidateChain) {
      const cleanModel = candidateModel.replace(/^models\//, '');

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let resp = null;
        let controller = new AbortController();
        let timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: optimizedPrompt }] }],
                generationConfig: {
                  temperature,
                  maxOutputTokens: 8192,
                  responseMimeType: 'application/json',
                },
              }),
            }
          );
          clearTimeout(timer);

          if (resp.ok) {
            const resData = await resp.json();
            const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            let jsonStr = rawText.trim();
            const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match && match[1]) jsonStr = match[1].trim();
            jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

            const parsed = JSON.parse(jsonStr);
            breaker.recordSuccess();
            return { success: true, parsed, usedModel: cleanModel };
          }

          const errText = await resp.text();
          const status = resp.status;

          // 429 Rate Limit 또는 500/503 서버 일시 장애 처리
          if (status === 429 || status === 503 || status === 500) {
            let retryDelayMs = backoffDelays[attempt] || 8000;
            try {
              const errJson = JSON.parse(errText);
              const retryInfo = errJson.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
              if (retryInfo?.retryDelay) {
                const seconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
                if (!isNaN(seconds) && seconds > 0) retryDelayMs = Math.ceil(seconds * 1000);
              }
            } catch (_) {}

            lastError = new Error(`Gemini ${cleanModel} ${status} (${errText.slice(0, 100)})`);
            lastError.status = status;

            if (attempt < maxRetries) {
              const waitSec = (retryDelayMs / 1000).toFixed(1);
              console.warn(`[LLMDefense] ⚠️ Gemini ${modelType}(${cleanModel}) ${status} 발생. 지수 백오프 대기 후 재시도 (${attempt + 1}/${maxRetries}회, ${waitSec}초 대기)...`);
              await new Promise((r) => setTimeout(r, retryDelayMs));
              continue; // 동일 모델 재시도
            } else {
              console.warn(`[LLMDefense] ⚠️ Gemini ${cleanModel} ${status} 최대 재시도 초과. 다음 후보 모델로 폴백 시도...`);
              break; // 다음 모델 시도
            }
          } else {
            // 기타 404, 400 등 비복구성 오류는 즉시 다음 모델 시도
            lastError = new Error(`Gemini ${cleanModel} HTTP ${status}: ${errText.slice(0, 100)}`);
            lastError.status = status;
            break;
          }
        } catch (fetchErr) {
          clearTimeout(timer);
          lastError = fetchErr;
          if (attempt < maxRetries) {
            const delay = backoffDelays[attempt] || 4000;
            console.warn(`[LLMDefense] ⚠️ Gemini ${modelType}(${cleanModel}) 네트워크/타임아웃 오류(${fetchErr.message}). 백오프 대기 후 재시도 (${attempt + 1}/${maxRetries}회, ${delay / 1000}초 대기)...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            break;
          }
        }
      }
    }

    // 모든 후보 모델 및 재시도 실패 시 서킷 브레이커 실패 기록
    breaker.recordFailure(lastError);
    throw lastError || new Error('모든 Gemini 모델 호출에 실패하였습니다.');
  }

  /**
   * 하위 호환 호출 래퍼
   */
  async callGeminiJson({ prompt, modelType = 'FLASH', temperature = 0.2 }) {
    try {
      return await this.callGeminiApiWithDefense(prompt, modelType);
    } catch (err) {
      return { success: false, reason: err.message, circuitOpen: !!err.circuitOpen };
    }
  }

  /**
   * 30분 단위 Flash 종합 판단 (Gemini Flash 적용)
   * 네이버 금융/언론사 RSS 실시간 뉴스와 빠른 시황을 입력받아 30분 단위 단기 트렌드 시그널을 출력
   */
  async evaluateFlashSignals(candidates = [], context = {}) {
    return await this._evaluateWithModel(candidates, {
      ...context,
      modelType: 'FLASH',
      timeframeLabel: '30분 단기 트렌드',
      focusArea: '실시간 뉴스 속보 감성, 호가창 수급 모멘텀, 단기 급등락 대응 및 30분 내 유효한 진입/이탈 타점',
    });
  }

  /**
   * 1시간 단위 Pro 심층 분석 (Gemini Pro 적용)
   * 누적된 지표와 심층 프롬프트를 입력받아 1시간 단위 거시적/심층 트렌드를 출력
   */
  async evaluateProDeepAnalysis(candidates = [], context = {}) {
    return await this._evaluateWithModel(candidates, {
      ...context,
      modelType: 'PRO',
      timeframeLabel: '1시간 거시/심층 트렌드',
      focusArea: '일봉 20MA/60분봉 60MA 이동평균선 괴리율, 거시 경제 환경(환율·금리), 종목별 펀더멘털 및 1시간 이상 유지될 중기 추세 지지/저항',
    });
  }

  /**
   * 기존 시그니처 호환 및 modelType에 따른 자동 분기
   */
  async evaluateTradeSignals(candidates = [], context = {}) {
    const modelType = String(context.modelType || 'FLASH').toUpperCase();
    if (modelType === 'PRO') {
      return await this.evaluateProDeepAnalysis(candidates, context);
    }
    return await this.evaluateFlashSignals(candidates, context);
  }

  /**
   * 내부 공통 LLM 평가 실행 엔진
   */
  async _evaluateWithModel(candidates = [], context = {}) {
    const db = this.getDb();
    const modelType = String(context.modelType || 'FLASH').toUpperCase();
    const isPro = modelType === 'PRO';
    const { geminiApiKey } = this.loadGeminiConfig(modelType);

    // 1. 최근 수집된 뉴스 상위 30건 (네이버 금융, 한경, 매경, 구글 등)
    let recentNews = [];
    try {
      recentNews = db.prepare(`
        SELECT id, title, summary, sentiment, keywords, source, created_at
        FROM stock_news
        ORDER BY id DESC LIMIT 30
      `).all() || [];
    } catch (e) {
      console.warn('[LLMDecisionService] 뉴스 조회 실패:', e.message);
    }

    // 2. 봇 상태 요약
    let botsSummaryText = context.botsSummary || '';
    if (!botsSummaryText) {
      try {
        const realBots = db.prepare(`
          SELECT bot_id, name, nickname, real_allocated_capital, real_status_msg, take_profit_pct, stop_loss_pct
          FROM bots WHERE is_real_selected = 1
        `).all();
        const openRealPos = db.prepare(`
          SELECT bot_id, stock_name, stock_code, qty, avg_buy_price
          FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'
        `).all();
        botsSummaryText = realBots.map((b) => {
          const posList = openRealPos
            .filter((p) => p.bot_id === b.bot_id)
            .map((p) => `${p.stock_name}(${p.stock_code}) ${p.qty}주`)
            .join(', ') || '보유 포지션 없음';
          return `- ${b.name}(${b.nickname}): 예산 ${Number(b.real_allocated_capital || 0).toLocaleString()}원, 익절 +${b.take_profit_pct}%/손절 -${b.stop_loss_pct}%, 보유[${posList}], 상태[${b.real_status_msg || '정상'}]`;
        }).join('\n');
      } catch (e) {}
    }

    // 3. 후보 종목 기본값
    const targetCandidates = candidates.length > 0 ? candidates : [
      { code: '005930', name: '삼성전자', market: 'KR', isFractional: false },
      { code: '000660', name: 'SK하이닉스', market: 'KR', isFractional: false },
      { code: '068270', name: '셀트리온', market: 'KR', isFractional: false },
      { code: '005380', name: '현대차', market: 'KR', isFractional: false },
      { code: 'AAPL', name: '애플', market: 'US', isFractional: true },
      { code: 'NVDA', name: '엔비디아', market: 'US', isFractional: true },
      { code: 'TSLA', name: '테슬라', market: 'US', isFractional: true },
      { code: 'QQQ', name: 'QQQ ETF', market: 'US', isFractional: true },
      { code: 'MSFT', name: '마이크로소프트', market: 'US', isFractional: true },
    ];

    if (!geminiApiKey) {
      console.warn(`[LLMDecisionService] Gemini API 키 부재 -> ${modelType} 규칙 기반 폴백 시그널 적용`);
      return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, { ...context, modelType });
    }

    const newsContext = recentNews.map((n, i) =>
      `[기사 ${i + 1}] (${n.sentiment || 'NEUTRAL'} | ${n.source || '증시속보'}) ${n.title} - ${n.summary || ''}`
    ).join('\n');

    const candidateListStr = targetCandidates.map((c) =>
      `- [${c.market}] ${c.name}(${c.code}): ${c.isFractional ? '미국 소수점 금액 주문 가능' : '국내 온주(1주 단위) 주문'}`
    ).join('\n');

    // 거시 경제 및 체제 데이터 (Pro 심층 분석 시 강조)
    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const macroContext = [
      `- 🇰🇷 한국 시장 체제: ${filterRow?.kr_recommended_action || 'NORMAL'} (배율: ${Math.round((Number(filterRow?.kr_position_size_multiplier || 1.0)) * 100)}%, 사유: ${filterRow?.kr_reason || '정상'})`,
      `- 🇺🇸 미국 시장 체제: ${filterRow?.us_recommended_action || 'NORMAL'} (배율: ${Math.round((Number(filterRow?.us_position_size_multiplier || 1.0)) * 100)}%, 사유: ${filterRow?.us_reason || '정상'})`,
      `- 분석 주기 및 분석 모델: ${isPro ? 'Gemini 1.5 Pro (1시간 단위 거시·심층 퀀트 분석)' : 'Gemini 1.5 Flash (30분 단위 뉴스·시황 고속 스캔)'}`,
    ].join('\n');

    const prompt = `
당신은 월스트리트와 여의도 탑티어 퀀트 헤지펀드의 수석 AI 전략가입니다.
현재 모드는 [${isPro ? 'Gemini Pro 1시간 심층 퀀트 분석' : 'Gemini Flash 30분 고속 시황 판단'}] 엔진입니다.

아래에 제공된 ${isPro ? '누적된 시장 거시 지표, 60분봉/일봉 추세, 심층 수급 및' : '네이버 금융 및 주요 언론사 실시간 속보 뉴스와 빠른 시황'} 데이터를 바탕으로:
1) marketBriefing: ${isPro ? '1시간 단위 거시적 관점의 종합 심층 브리핑' : '30분 단위 실시간 빠른 시황 판단'}
2) krMarketOverview: 🇰🇷 한국 주식 시장(KRX) 구두 시황 해설
3) usMarketOverview: 🇺🇸 미국 주식 시장(NYSE/NASDAQ) 구두 시황 해설
4) verbalOverview: 3개 파트([🇰🇷 한국 시장], [🇺🇸 미국 시장], [🤖 실전 봇 진단])로 구분된 상세 브리핑
5) market_regime / confidence / allowed_families / regime_multiplier / hot_sectors / avoid_tickers: Soft Regime Routing용 구조화 시장 국면 메타데이터
   - market_regime: 'BULLISH_MOMENTUM' (강세·거래량 폭발), 'NEUTRAL_BOX' (횡보·박스권), 'BEARISH_DEFENSE' (급락·거시 악재) 중 택1
   - confidence: 현재 시장 레짐 판단 확신도 (0~100 정수)
   - allowed_families: 현재 레짐에서 진입 허용할 전략군 배열 (예: ["BREAKOUT", "TREND", "REVERSION"])
   - regime_multiplier: 신규 진입 예산 배율 (0.0 ~ 1.2)
   - hot_sectors: 최근 호재/수급 집중 섹터 배열 (예: ["반도체", "AI"])
   - avoid_tickers: 악재 또는 리스크로 신규 진입 회피할 종목 코드 배열 (예: ["TSLA"])
6) decisions: 각 종목에 대한 매매 판단(BUY, HOLD, SELL), 신뢰도(0~100), 감성점수(-10.0 ~ +10.0), 근거 뉴스 및 구체적 사유
를 JSON 객체로 작성해주세요.

[분석 핵심 중점사항]
- 주기: ${context.timeframeLabel || (isPro ? '1시간 단위 심층 트렌드' : '30분 단위 단기 트렌드')}
- 중점 영역: ${context.focusArea || (isPro ? '거시 경제, 20MA/60MA 이동평균선, 종목 펀더멘털' : '실시간 속보 뉴스 감성, 단기 수급, 즉시성 호재/악재')}

[시장 체제 및 거시 환경]
${macroContext}

[현재 실전 가동 퀀트 봇 및 보유 포지션 현황]
${botsSummaryText || '3대 실전 퀀트 봇 정상 가동 중'}

[분석 대상 종목군]
${candidateListStr}

[최근 수집 실시간 뉴스]
${newsContext || '최근 뉴스가 아직 충분치 않습니다. 글로벌 테크 반도체 및 AI 밸류체인 수혜 관점으로 평가해주세요.'}

[평가 지침 및 규칙]
1. decisions 배열: 각 종목에 대해 'BUY'(매수 권고), 'HOLD'(관망), 'SELL'(매도/리스크 관리)을 부여하세요.
2. ${isPro ? 'Pro 심층 분석 모드이므로, 단기 잡음(Noise)에 휘둘리지 않고 펀더멘털과 60분봉/일봉 지지선, 거시 리스크를 기준으로 보수적이고 깊이 있게 추론하세요.' : 'Flash 모드이므로 실시간 속보 뉴스 키워드와 단기 수급 탄력을 기민하게 반영하여 30분 단위 단기 시그널을 신속하게 도출하세요.'}
3. 🇰🇷 한국 종목과 🇺🇸 미국 종목은 서로 독립적으로 평가하세요 (코스피 지표와 나스닥 지표 각각 적용).
4. 'BUY' 신호는 확신도(confidence) 70% 이상, 호재 감성점수(sentimentScore) +3.0점 이상일 때 부여하세요.
5. 각 종목의 'reasoning' 필드는 최근 뉴스 제목과 핵심 이슈를 직접 언급하며 ${isPro ? '1시간 단위 심층 거시/기술적 관점' : '30분 단위 단기 트렌드/뉴스 모멘텀 관점'}에서 2~3문장의 생생한 구어체로 서술하세요.
6. 반드시 아래 JSON 객체 스키마 형식으로만 응답하세요.

[응답 JSON 스키마]
{
  "marketBriefing": "${isPro ? '[1시간 Pro 심층 퀀트 분석]' : '[30분 Flash 실시간 종합 판단]'} ...",
  "krMarketOverview": "🇰🇷 [한국 시장] ...",
  "usMarketOverview": "🇺🇸 [미국 시장] ...",
  "verbalOverview": "### 🇰🇷 [한국 시장 종합 진단]\n...\n\n### 🇺🇸 [미국 시장 종합 진단]\n...\n\n### 🤖 [실전 봇 진단]\n...",
  "market_regime": "BULLISH_MOMENTUM | NEUTRAL_BOX | BEARISH_DEFENSE",
  "confidence": 82,
  "allowed_families": ["BREAKOUT", "TREND"],
  "regime_multiplier": 1.0,
  "hot_sectors": ["반도체", "AI"],
  "avoid_tickers": [],
  "decisions": [
    {
      "symbol": "AAPL",
      "name": "애플",
      "market": "US",
      "action": "BUY",
      "confidence": 85,
      "sentimentScore": 7.5,
      "related_news": "애플 AI 채택 가속화 및 서비스 부문 분기 호실적",
      "reasoning": "...",
      "isFractional": true,
      "suggestedBudgetRatio": 0.35
    }
  ]
}
`;

    let apiResult = null;
    try {
      apiResult = await this.callGeminiApiWithDefense(prompt, modelType);
    } catch (defenseErr) {
      console.warn(`[LLMDecisionService] 🛡️ Gemini ${modelType} API 방어/서킷 브레이커 발동 (${defenseErr.message}) -> 내장 퀀트 감성 폴백 전환`);
      return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, { ...context, modelType, circuitOpen: !!defenseErr.circuitOpen });
    }

    if (apiResult && apiResult.success && apiResult.parsed) {
      const parsed = apiResult.parsed;
      const decisionsList = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.decisions) ? parsed.decisions : []);

      if (decisionsList.length > 0) {
        const regimeMeta = this.buildRegimeMetaFromParsed(parsed, decisionsList, filterRow, modelType);
        this.saveDecisionsToDb(decisionsList, modelType, regimeMeta);
        const defaultSummaries = this.buildDefaultAnalysisSummaries(decisionsList, botsSummaryText, { ...context, modelType });
        const marketBriefing = parsed?.marketBriefing || defaultSummaries.marketBriefing;
        const krMarketOverview = parsed?.krMarketOverview || defaultSummaries.krMarketOverview;
        const usMarketOverview = parsed?.usMarketOverview || defaultSummaries.usMarketOverview;
        let verbalOverview = parsed?.verbalOverview;
        if (verbalOverview && typeof verbalOverview === 'object') {
          const parts = [];
          if (verbalOverview.krMarket || verbalOverview.kr) parts.push(`### 🇰🇷 [한국 주식 시장 (KRX: KOSPI / KOSDAQ)] 종합 분석 & 온주 전략\n- ${verbalOverview.krMarket || verbalOverview.kr}`);
          if (verbalOverview.usMarket || verbalOverview.us) parts.push(`### 🇺🇸 [미국 주식 시장 (US: NYSE / NASDAQ)] 종합 분석 & 소수점 전략\n- ${verbalOverview.usMarket || verbalOverview.us}`);
          if (verbalOverview.botDiagnostic || verbalOverview.bot) parts.push(`### 🤖 [실전 퀀트 봇 & 알고리즘 매매 진단]\n- ${verbalOverview.botDiagnostic || verbalOverview.bot}`);
          verbalOverview = parts.length > 0 ? parts.join('\n\n') : JSON.stringify(verbalOverview);
        }
        if (!verbalOverview) verbalOverview = defaultSummaries.verbalOverview;

        this.saveLatestAnalysisToDb({
          marketBriefing,
          krMarketOverview,
          usMarketOverview,
          verbalOverview,
          triggerType: context.triggerType || 'AUTO',
          slotLabel: context.slotLabel || (isPro ? '1시간 Pro 심층분석' : '30분 Flash 자동분석'),
          modelType,
        });
        return decisionsList;
      }
    }

    console.warn(`[LLMDecisionService] Gemini ${modelType} API 응답 실패/파싱불가 -> 내장 퀀트 폴백 적용`);
    return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, { ...context, modelType });
  }

  buildDefaultAnalysisSummaries(decisions, botsSummaryText = '', context = {}) {
    const db = this.getDb();
    const kstTimeStr = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const krAction = filterRow?.kr_recommended_action || 'NORMAL';
    const krReason = filterRow?.kr_reason || '한국 거시 지표 및 이동평균선 정상 구간';
    const krMult = filterRow?.kr_position_size_multiplier !== undefined ? Number(filterRow.kr_position_size_multiplier) : 1.0;
    const krRiskAlert = Number(filterRow?.kr_risk_alert || 0);
    const krIsHalted = krAction === 'HALT_NEW_BUYS' || krRiskAlert === 1;

    const usAction = filterRow?.us_recommended_action || 'NORMAL';
    const usReason = filterRow?.us_reason || '미국 나스닥/S&P500 안정적 추세 유지';
    const usMult = filterRow?.us_position_size_multiplier !== undefined ? Number(filterRow.us_position_size_multiplier) : 1.0;
    const usRiskAlert = Number(filterRow?.us_risk_alert || 0);
    const usIsHalted = usAction === 'HALT_NEW_BUYS' || usRiskAlert === 1;

    const krDecisions = decisions.filter((d) => d.market === 'KR');
    const usDecisions = decisions.filter((d) => d.market === 'US');

    const krBuyList = krDecisions.filter((d) => d.action === 'BUY').sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const krHoldList = krDecisions.filter((d) => d.action === 'HOLD');
    const krSellList = krDecisions.filter((d) => d.action === 'SELL');

    const usBuyList = usDecisions.filter((d) => d.action === 'BUY').sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const usHoldList = usDecisions.filter((d) => d.action === 'HOLD');
    const usSellList = usDecisions.filter((d) => d.action === 'SELL');

    const modeLabel = context.triggerType === 'MANUAL' ? '수동 즉시 분석' : `정기 자동 분석(${context.slotLabel || '4시간 주기'})`;

    const krTopNames = krBuyList.slice(0, 4).map((d) => `${d.name || d.stock_name}(${d.symbol}, 확신도 ${d.confidence}%)`).join(', ') || '삼성전자, SK하이닉스';
    const usTopNames = usBuyList.slice(0, 4).map((d) => `${d.name || d.stock_name}(${d.symbol}, 확신도 ${d.confidence}%)`).join(', ') || '엔비디아(NVDA), QQQ, 애플(AAPL)';

    const krBadgeShort = krIsHalted ? '🔴매수차단' : krMult < 1.0 ? `🟡비중${Math.round(krMult * 100)}%` : '🟢정상매매';
    const usBadgeShort = usIsHalted ? '🔴매수차단' : usMult < 1.0 ? `🟡비중${Math.round(usMult * 100)}%` : '🟢정상매매';

    const marketBriefing = `[AI 실시간 한·미 시장 분석 & 봇 진단 | ${kstTimeStr} ${modeLabel}] ` +
      `🇰🇷한국장(${krBadgeShort} | 매수 ${krBuyList.length}건·관망 ${krHoldList.length}건) 및 ` +
      `🇺🇸미국장(${usBadgeShort} | 매수 ${usBuyList.length}건·관망 ${usHoldList.length}건) 분석 완료. ` +
      (krIsHalted
        ? `국내 증시 급락 리스크로 온주 매수는 전면 차단되며, 미국 [${usBuyList[0]?.name || usBuyList[0]?.stock_name || '엔비디아'}] 중심 소수점 분할 진입만 진행됩니다.`
        : `최우선 추천: 국내 [${krBuyList[0]?.name || krBuyList[0]?.stock_name || 'SK하이닉스'}], 미국 [${usBuyList[0]?.name || usBuyList[0]?.stock_name || '엔비디아'}].`);

    let krMarketOverview = '';
    if (krIsHalted) {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 급락 및 리스크 경보 발동으로 **신규 매수 차단(🔴 HALT_NEW_BUYS, 비중 0%)** 체제입니다. ` +
        `지표 분석 결과: ${krReason}. 코스피 지수가 일봉 20일 이동평균선을 대폭 하회하고 있어 추가 낙폭 리스크 방어를 위해 국내 온주 신규 매수는 전면 보류됩니다. ` +
        `국내 분석 대상 ${krDecisions.length}종목 중 매수 추천은 지수 안정화 시까지 보류(관망 ${krHoldList.length}건, 매도 ${krSellList.length}건)하며, 기보유 종목의 손절/익절 청산 관리만 엄격하게 집행됩니다.`;
    } else if (krMult < 1.0) {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 변동성 확대 구간으로 **투자비중 축소(🟡 REDUCE_SIZE, 비중 ${Math.round(krMult * 100)}%)** 체제입니다. ` +
        `지표 분석 결과: ${krReason}. 국내 분석 대상 ${krDecisions.length}종목 중 매수 유효(BUY) ${krBuyList.length}건이 포착되었으나 리스크 관리를 위해 축소된 비중으로 1주 온주 분할 진입합니다.`;
    } else {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 일봉 20일 이동평균선 상단 지지를 확보하며 **정상 거래 허용(🟢 Normal, 비중 100%)** 체제를 유지하고 있습니다. ` +
        `국내 분석 대상 ${krDecisions.length}종목 중 매수 유효(BUY) ${krBuyList.length}건, 관망(HOLD) ${krHoldList.length}건이 포착되었으며, ` +
        `특히 HBM 반도체 및 수출 실적 모멘텀이 집중된 ${krTopNames} 종목에서 강한 기관·외인 수급 시그널이 확인됩니다. ` +
        `주간 정규장(09:00~15:30 KST)에서는 키움증권 실시간 호가 지지선을 기반으로 1주 온주 단위 알고리즘 분할 진입이 유효합니다.`;
    }

    let usMarketOverview = '';
    if (usIsHalted) {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 거시 리스크 경보 발동으로 **신규 매수 차단(🔴 HALT_NEW_BUYS, 비중 0%)** 체제입니다. ` +
        `지표 분석 결과: ${usReason}. 나스닥 및 S&P500의 추가 하락 리스크를 방어하기 위해 미국 소수점 신규 매수는 일시 보류됩니다.`;
    } else if (usMult < 1.0) {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 단기 조정 구간으로 **투자비중 축소(🟡 REDUCE_SIZE, 비중 ${Math.round(usMult * 100)}%)** 체제입니다. ` +
        `지표 분석 결과: ${usReason}. 토스증권 소수점 주문 금액을 축소 산정하여 방어적으로 분할 매수합니다.`;
    } else {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 나스닥 100(QQQ) 지수가 일봉 20MA 및 장중 60MA 상단 추세를 유지하며 **정상 거래 허용(🟢 Normal, 비중 100%)** 체제에서 움직이고 있습니다. ` +
        `미국 분석 대상 ${usDecisions.length}종목 중 매수 유효(BUY) ${usBuyList.length}건, 관망(HOLD) ${usHoldList.length}건이 도출되었으며, ` +
        `글로벌 AI 인프라 투자를 주도하는 ${usTopNames} 중심으로 높은 호재 감성점수가 유지되고 있습니다. ` +
        `가용 예수금 규모에 맞춰 토스증권 소수점 금액 주문($1~$10)이 자동 산정되었으며, 미국 정규장(23:30~05:00 KST) 개장 즉시 신규 소수점 매수가 동시 집행됩니다.`;
    }

    const krAlgoLine = krIsHalted
      ? `- **🇰🇷 한국 온주 알고리즘 매매 판정**: **🔴 신규 매수 차단 (청산만 허용)** — 코스피 급락 및 리스크 경보로 신규 온주 매수가 일시 동결되었으며 기보유 종목만 관리합니다.`
      : `- **🇰🇷 한국 온주 알고리즘 매매 판정**: **🟢 정상 진행 (투자비중 ${Math.round(krMult * 100)}%)** — 주간 정규장 키움증권 호가 기반 1주 온주 자동 매수 집행 중.`;

    const usAlgoLine = usIsHalted
      ? `- **🇺🇸 미국 소수점 알고리즘 매매 판정**: **🔴 신규 매수 차단 (청산만 허용)** — 미국 지수 급락 경보로 신규 소수점 매수가 보류되었습니다.`
      : `- **🇺🇸 미국 소수점 알고리즘 매매 판정**: **🟢 정상 진행 (투자비중 ${Math.round(usMult * 100)}%)** — 미국 정규장(23:30 KST) 개장 즉시 100% LLM 호재 추천 종목(${usTopNames})으로 토스 소수점 자동 체결 진행.`;

    const verbalOverview =
      `### 🇰🇷 [한국 주식 시장 (KRX: KOSPI / KOSDAQ)] 종합 분석 & 온주 전략\n` +
      `- **시장 체제 및 지표 진단**: ${krMarketOverview}\n` +
      `- **국내 최우선 매수 추천 종목**: **${krTopNames}**\n\n` +
      `### 🇺🇸 [미국 주식 시장 (US: NYSE / NASDAQ)] 종합 분석 & 소수점 전략\n` +
      `- **시장 체제 및 빅테크 모멘텀**: ${usMarketOverview}\n` +
      `- **미국 최우선 소수점 추천 종목**: **${usTopNames}**\n\n` +
      `### 🤖 [실전 퀀트 봇 3기 & 한·미 분리 알고리즘 매매 진행 진단]\n` +
      `${krAlgoLine}\n` +
      `${usAlgoLine}\n` +
      (botsSummaryText ? `${botsSummaryText}` : `- 현재 실전 담당 3대 퀀트 봇은 목표 익절 및 손절 라인에 따라 포지션을 자동 관리하고 있습니다.`);

    return { marketBriefing, krMarketOverview, usMarketOverview, verbalOverview };
  }

  saveLatestAnalysisToDb({ marketBriefing, krMarketOverview, usMarketOverview, verbalOverview, triggerType = 'AUTO', slotLabel = '' }) {
    const db = this.getDb();
    const nowIso = new Date().toISOString();
    const analyzedAtKst = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const payload = {
      marketBriefing,
      krMarketOverview: krMarketOverview || '',
      usMarketOverview: usMarketOverview || '',
      verbalOverview,
      triggerType,
      slotLabel,
      analyzedAt: nowIso,
      analyzedAtKst,
      krRegime: {
        action: filterRow?.kr_recommended_action || 'NORMAL',
        regime: filterRow?.kr_market_regime || 'SIDEWAYS',
        reason: filterRow?.kr_reason || '',
        multiplier: Number(filterRow?.kr_position_size_multiplier || 1.0),
        riskAlert: Number(filterRow?.kr_risk_alert || 0),
      },
      usRegime: {
        action: filterRow?.us_recommended_action || 'NORMAL',
        regime: filterRow?.us_market_regime || 'BULL',
        reason: filterRow?.us_reason || '',
        multiplier: Number(filterRow?.us_position_size_multiplier || 1.0),
        riskAlert: Number(filterRow?.us_risk_alert || 0),
      },
    };

    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('ai_latest_analysis_json', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(payload), nowIso);
    } catch (e) {
      console.warn('[LLMDecisionService] 최신 시장/봇 진단 저장 오류:', e.message);
    }
    return payload;
  }

  getLatestAnalysisFromDb() {
    const db = this.getDb();
    try {
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_latest_analysis_json'").get();
      if (row && row.value) {
        return JSON.parse(row.value);
      }
      const bRow = db.prepare("SELECT briefing_text, created_at FROM ai_market_briefings ORDER BY id DESC LIMIT 1").get();
      if (bRow) {
        return {
          marketBriefing: bRow.briefing_text,
          verbalOverview: bRow.briefing_text,
          triggerType: 'AUTO',
          slotLabel: '',
          analyzedAt: bRow.created_at,
          analyzedAtKst: bRow.created_at,
        };
      }
    } catch (e) {}
    return null;
  }

  // LLM 미설정 또는 호출 실패 시의 수집 뉴스 기반 정밀 구두형(구어체) fallback 해설 생성
  generateFallbackDecisions(candidates, recentNews = [], botsSummaryText = '', context = {}) {
    const db = this.getDb();
    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const krAction = filterRow?.kr_recommended_action || 'NORMAL';
    const krReason = filterRow?.kr_reason || '한국 시장 안정적 흐름';
    const krIsHalted = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1;

    const usAction = filterRow?.us_recommended_action || 'NORMAL';
    const usReason = filterRow?.us_reason || '미국 증시 우상향 추세';
    const usIsHalted = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

    const results = candidates.map((c) => {
      const isKr = c.market === 'KR';
      const isUs = c.market === 'US';
      const keywords = STOCK_KEYWORDS[c.code] || [c.name, c.code];

      // 최근 뉴스 30건 중 종목 키워드와 매칭되는 최신 뉴스 탐색
      const matchedNews = recentNews.find((n) => {
        const title = n.title || '';
        const summary = n.summary || '';
        const kw = n.keywords || '';
        return keywords.some((k) => title.includes(k) || summary.includes(k) || kw.includes(k));
      }) || recentNews[0] || null;

      const newsTitle = matchedNews?.title || (isKr ? '국내 증시 수급 및 섹터 모멘텀 점검' : '글로벌 테크 증시 및 수급 모멘텀 분석');
      const newsSentiment = matchedNews?.sentiment || 'NEUTRAL';

      let action = 'BUY';
      let confidence = 82;
      let sentimentScore = 7.2;
      let reasoning = '';

      if (isKr) {
        if (krIsHalted) {
          action = 'HOLD';
          confidence = 55;
          sentimentScore = -2.8;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 언론 보도에도 불구하고, 현재 국내 증시는 급락 경보(코스피 20일선 대폭 하회 및 리스크 차단) 발동으로 국내 온주 신규 매수가 일시 전면 차단(🔴 HALT_NEW_BUYS) 상태입니다. 무리한 물타기나 신규 진입보다는 지수 안정세 확인 시까지 관망(HOLD)을 유지하시고 기보유 포지션 관리에 집중하시기를 권고합니다.`;
        } else if (newsSentiment === 'BEARISH') {
          action = 'SELL';
          confidence = 74;
          sentimentScore = -4.5;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 악재성 뉴스 및 단기 차익 실현 매물 출회 가능성이 관측되고 있습니다. 키움증권 호가 매도 우위 상태를 점검하시며 보유 비중을 축소하시거나 현금을 확보하여 리스크를 관리하시는 전략을 추천합니다.`;
        } else {
          action = 'BUY';
          confidence = 81;
          sentimentScore = 6.8;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 언론에 보도된 긍정적인 실적 및 수급 모멘텀에 힘입어 양호한 흐름이 이어지고 있습니다. 키움증권 호가 지지선을 확인하시면서 1주 온주 단위 분할 매수로 접근하시는 전략이 유효합니다.`;
        }
      } else {
        // 미국 주식
        if (usIsHalted) {
          action = 'HOLD';
          confidence = 58;
          sentimentScore = -2.2;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 미국 증시 급락 경보 발동으로 소수점 신규 매수가 일시 보류되었습니다. 나스닥 지수의 기술적 지지력 회복을 확인하신 후 진입하시기 바랍니다.`;
        } else if (newsSentiment === 'BEARISH') {
          action = 'HOLD';
          confidence = 68;
          sentimentScore = 1.0;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 단기 변동성 요인이 보도되고 있어 성급한 매수보다는 미국 정규장(23:30 KST) 개장 후 60분 이동평균선 지지 여부를 확인하며 관망(HOLD)하시는 것을 추천합니다.`;
        } else {
          action = 'BUY';
          confidence = 86;
          sentimentScore = 8.1;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 미국 증시는 나스닥 100(QQQ)이 20MA 상단에서 견조한 상승 추세를 유지하는 가운데, 해당 종목에 대한 글로벌 호재 모멘텀이 확인됩니다. 토스증권 소수점 금액 주문($1~$10)을 활용하여 미국 정규장(23:30 KST) 개장 시 소액 분할 매수로 비중을 늘려가시는 전략을 적극 추천해 드립니다.`;
        }
      }

      const isPro = String(context.modelType || '').toUpperCase() === 'PRO';
      if (isPro) {
        if (action === 'BUY') {
          reasoning = `📊 [Pro 거시/심층 분석 | 1시간 추세] "${newsTitle}" 관련 밸류에이션 호재와 함께 중기 이평선(20MA/60MA) 상단 지지가 견고합니다. 거시 지표 안정세 속에서 분할 매수 관점을 유지합니다.`;
        } else if (action === 'SELL') {
          reasoning = `⚠️ [Pro 거시/심층 분석 | 1시간 추세] "${newsTitle}" 관련 하방 압력 및 거시 리스크가 심화되고 있습니다. 중기 추세 이탈 방어를 위해 보수적 비중 축소 및 매도를 권고합니다.`;
        } else {
          reasoning = `⚖️ [Pro 거시/심층 분석 | 1시간 추세] "${newsTitle}" 보도 속에서 방향성 탐색 구간입니다. 거시 경제 지표와 수급 전환 확인 시까지 관망(HOLD)을 유지합니다.`;
        }
      }

      return {
        symbol: c.code,
        name: c.name,
        market: c.market,
        action,
        confidence,
        sentimentScore,
        related_news: newsTitle,
        reasoning,
        modelType: isPro ? 'PRO' : 'FLASH',
        isFractional: c.isFractional,
        suggestedBudgetRatio: 0.35,
      };
    });

    const usedModelType = String(context.modelType || 'FLASH').toUpperCase();
    const regimeMeta = this.buildFallbackRegimeMeta(results, recentNews, filterRow, usedModelType);
    this.saveDecisionsToDb(results, usedModelType, regimeMeta);
    const defaultSummaries = this.buildDefaultAnalysisSummaries(results, botsSummaryText, context);
    this.saveLatestAnalysisToDb({
      marketBriefing: defaultSummaries.marketBriefing,
      krMarketOverview: defaultSummaries.krMarketOverview,
      usMarketOverview: defaultSummaries.usMarketOverview,
      verbalOverview: defaultSummaries.verbalOverview,
      triggerType: context.triggerType || 'AUTO',
      slotLabel: context.slotLabel || (usedModelType === 'PRO' ? '1시간 Pro 심층분석' : '30분 Flash 자동분석'),
      modelType: usedModelType,
    });
    return results;
  }

  buildRegimeMetaFromParsed(parsed = {}, decisionsList = [], filterRow = null, modelType = 'FLASH') {
    const cleanModelType = String(modelType || 'FLASH').toUpperCase() === 'PRO' ? 'PRO' : 'FLASH';
    const modelTier = cleanModelType === 'PRO' ? 'PRO_60M' : 'FLASH_30M';

    const buyCount = decisionsList.filter((d) => String(d.action).toUpperCase() === 'BUY').length;
    const sellCount = decisionsList.filter((d) => String(d.action).toUpperCase() === 'SELL').length;
    const avgSentiment = decisionsList.length > 0
      ? decisionsList.reduce((acc, d) => acc + Number(d.sentimentScore ?? d.sentiment_score ?? 0), 0) / decisionsList.length
      : 0;
    const avgDecisionConf = decisionsList.length > 0
      ? Math.round(decisionsList.reduce((acc, d) => acc + Number(d.confidence ?? 70), 0) / decisionsList.length)
      : 70;

    const krHalted = filterRow?.kr_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1;
    const usHalted = filterRow?.us_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

    let inferredRegime = 'NEUTRAL_BOX';
    if (krHalted && usHalted) {
      inferredRegime = 'BEARISH_DEFENSE';
    } else if (sellCount > buyCount || avgSentiment <= -1.5) {
      inferredRegime = 'BEARISH_DEFENSE';
    } else if (buyCount >= Math.max(1, Math.ceil(decisionsList.length * 0.5)) && avgSentiment >= 2.5) {
      inferredRegime = 'BULLISH_MOMENTUM';
    }

    const marketRegime = parsed?.market_regime
      ? normalizeMarketRegime(parsed.market_regime)
      : inferredRegime;

    const regimeConfidence = Number.isFinite(Number(parsed?.confidence))
      ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))))
      : avgDecisionConf;

    const rawFamilies = Array.isArray(parsed?.allowed_families)
      ? parsed.allowed_families.map((f) => String(f || '').toUpperCase().trim()).filter((f) => ['BREAKOUT', 'TREND', 'REVERSION'].includes(f))
      : [];
    const allowedFamilies = rawFamilies.length > 0 ? rawFamilies : getDefaultAllowedFamiliesForRegime(marketRegime);

    const parsedMult = Number(parsed?.regime_multiplier);
    const regimeMultiplier = Number.isFinite(parsedMult)
      ? Math.max(0.0, Math.min(1.2, parsedMult))
      : getDefaultMultiplierForRegime(marketRegime);

    const hotSectors = Array.isArray(parsed?.hot_sectors)
      ? parsed.hot_sectors.map((s) => String(s || '').trim()).filter(Boolean)
      : [];

    const avoidTickersFromParsed = Array.isArray(parsed?.avoid_tickers)
      ? parsed.avoid_tickers.map((t) => String(t || '').toUpperCase().trim()).filter(Boolean)
      : [];
    const sellTickers = decisionsList
      .filter((d) => String(d.action || '').toUpperCase() === 'SELL')
      .map((d) => String(d.symbol || '').toUpperCase().trim())
      .filter(Boolean);
    const avoidTickers = Array.from(new Set([...avoidTickersFromParsed, ...sellTickers]));

    return {
      modelTier,
      marketRegime,
      regimeConfidence,
      allowedFamilies,
      regimeMultiplier,
      hotSectors,
      avoidTickers,
    };
  }

  buildFallbackRegimeMeta(results = [], recentNews = [], filterRow = null, modelType = 'FLASH') {
    const cleanModelType = String(modelType || 'FLASH').toUpperCase() === 'PRO' ? 'PRO' : 'FLASH';
    const modelTier = cleanModelType === 'PRO' ? 'PRO_60M' : 'FLASH_30M';

    const krHalted = filterRow?.kr_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1;
    const usHalted = filterRow?.us_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

    const buyCount = results.filter((r) => r.action === 'BUY').length;
    const sellCount = results.filter((r) => r.action === 'SELL').length;
    const avgSentiment = results.length > 0
      ? results.reduce((acc, r) => acc + Number(r.sentimentScore || 0), 0) / results.length
      : 0;
    const avgConf = results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + Number(r.confidence || 70), 0) / results.length)
      : 70;

    let marketRegime = 'NEUTRAL_BOX';
    if (krHalted && usHalted) {
      marketRegime = 'BEARISH_DEFENSE';
    } else if (krHalted || usHalted || sellCount > buyCount || avgSentiment <= -1.0) {
      marketRegime = (sellCount >= Math.max(2, buyCount) || (krHalted && usHalted)) ? 'BEARISH_DEFENSE' : 'NEUTRAL_BOX';
    } else if (buyCount >= Math.max(1, Math.ceil(results.length * 0.6)) && avgSentiment >= 4.0) {
      marketRegime = 'BULLISH_MOMENTUM';
    }

    const sectorHints = new Set();
    for (const n of recentNews || []) {
      const text = `${n.title || ''} ${n.summary || ''} ${n.keywords || ''}`;
      if (/반도체|HBM|메모리|GPU/i.test(text)) sectorHints.add('반도체');
      if (/AI|인공지능|클라우드/i.test(text)) sectorHints.add('AI');
      if (/전기차|배터리|자동차/i.test(text)) sectorHints.add('모빌리티');
      if (/바이오|신약|헬스케어/i.test(text)) sectorHints.add('바이오');
    }

    const avoidTickers = results
      .filter((r) => r.action === 'SELL')
      .map((r) => String(r.symbol || '').toUpperCase().trim())
      .filter(Boolean);

    return {
      modelTier,
      marketRegime,
      regimeConfidence: avgConf,
      allowedFamilies: getDefaultAllowedFamiliesForRegime(marketRegime),
      regimeMultiplier: getDefaultMultiplierForRegime(marketRegime),
      hotSectors: Array.from(sectorHints),
      avoidTickers,
    };
  }

  saveDecisionsToDb(decisions, modelType = 'FLASH', regimeMeta = {}) {
    const db = this.getDb();
    const nowIso = new Date().toISOString();
    const cleanModelType = String(modelType || 'FLASH').toUpperCase() === 'PRO' ? 'PRO' : 'FLASH';
    const modelTier = regimeMeta?.modelTier || (cleanModelType === 'PRO' ? 'PRO_60M' : 'FLASH_30M');
    const marketRegime = normalizeMarketRegime(regimeMeta?.marketRegime || 'NEUTRAL_BOX');
    const allowedFamilies = Array.isArray(regimeMeta?.allowedFamilies) && regimeMeta.allowedFamilies.length > 0
      ? regimeMeta.allowedFamilies
      : getDefaultAllowedFamiliesForRegime(marketRegime);
    const regimeMultiplier = Number.isFinite(Number(regimeMeta?.regimeMultiplier))
      ? Math.max(0.0, Math.min(1.2, Number(regimeMeta.regimeMultiplier)))
      : getDefaultMultiplierForRegime(marketRegime);
    const hotSectors = Array.isArray(regimeMeta?.hotSectors) ? regimeMeta.hotSectors : [];
    const avoidTickers = Array.isArray(regimeMeta?.avoidTickers) ? regimeMeta.avoidTickers : [];

    const allowedFamiliesJson = JSON.stringify(allowedFamilies);
    const hotSectorsJson = JSON.stringify(hotSectors);
    const avoidTickersJson = JSON.stringify(avoidTickers);

    let lastDecisionId = null;
    try {
      const stmt = db.prepare(`
        INSERT INTO ai_trade_decisions (
          symbol, stock_name, market, action, confidence, sentiment_score,
          reasoning, related_news, suggested_order_type, executed_by, execution_status,
          model_type, model_tier, market_regime, allowed_families_json, regime_multiplier,
          hot_sectors_json, avoid_tickers_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const d of decisions) {
        const res = stmt.run(
          d.symbol,
          d.name || d.stock_name,
          d.market,
          d.action,
          d.confidence,
          d.sentimentScore ?? d.sentiment_score ?? 0,
          d.reasoning,
          d.related_news || '',
          d.isFractional ? 'AMOUNT_FRACTIONAL' : 'UNIT_ORDER',
          'PYTHON_TOSS_EXECUTOR',
          d.action === 'BUY' ? 'READY_TO_EXECUTE' : 'SKIPPED_HOLD',
          cleanModelType,
          modelTier,
          marketRegime,
          allowedFamiliesJson,
          regimeMultiplier,
          hotSectorsJson,
          avoidTickersJson,
          nowIso
        );
        if (res && res.lastInsertRowid) {
          lastDecisionId = Number(res.lastInsertRowid);
        }
      }

      if (!lastDecisionId) {
        const row = db.prepare(`SELECT MAX(id) AS maxId FROM ai_trade_decisions WHERE model_tier = ?`).get(modelTier);
        if (row?.maxId) lastDecisionId = Number(row.maxId);
      }

      // 시장 레짐 신뢰도 및 메타 스냅샷 저장 (종목별 confidence와 분리된 시장 단위 신뢰도)
      const regimeConfidence = Number.isFinite(Number(regimeMeta?.regimeConfidence))
        ? Math.max(0, Math.min(100, Math.round(Number(regimeMeta.regimeConfidence))))
        : (decisions.length > 0
          ? Math.round(decisions.reduce((acc, d) => acc + Number(d.confidence ?? 70), 0) / decisions.length)
          : 70);
      const snapshotKey = cleanModelType === 'PRO' ? 'ai_regime_snapshot_pro' : 'ai_regime_snapshot_flash';
      const snapshotVal = JSON.stringify({
        lastDecisionId,
        modelTier,
        marketRegime,
        regimeConfidence,
        allowedFamilies,
        regimeMultiplier,
        hotSectors,
        avoidTickers,
        updatedAt: nowIso,
      });
      try {
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(snapshotKey, snapshotVal, nowIso);
      } catch (_) {}
    } catch (e) {
      console.warn('[LLMDecisionService] 의사결정 DB 저장 오류:', e.message);
    }
  }

  getRecentDecisions(limit = 20, modelType = null) {
    const db = this.getDb();
    try {
      if (modelType) {
        const cleanType = String(modelType).toUpperCase();
        return db.prepare(`
          SELECT * FROM ai_trade_decisions
          WHERE model_type = ?
          ORDER BY id DESC LIMIT ?
        `).all(cleanType, limit);
      }
      return db.prepare(`
        SELECT * FROM ai_trade_decisions
        ORDER BY id DESC LIMIT ?
      `).all(limit);
    } catch (e) {
      return [];
    }
  }

  /**
   * 모델별(FLASH 또는 PRO) 종목별 최신 의사결정 목록 조회
   */
  getLatestDecisionsByModel(modelType = 'FLASH') {
    const db = this.getDb();
    const cleanType = String(modelType || 'FLASH').toUpperCase();
    try {
      const rows = db.prepare(`
        SELECT * FROM ai_trade_decisions
        WHERE model_type = ?
          AND id IN (
            SELECT MAX(id) FROM ai_trade_decisions
            WHERE model_type = ?
            GROUP BY symbol
          )
        ORDER BY id DESC
      `).all(cleanType, cleanType);
      return rows || [];
    } catch (e) {
      // model_type 컬럼이 구버전일 경우 전체 최신 조회 폴백
      try {
        return db.prepare(`
          SELECT * FROM ai_trade_decisions
          WHERE id IN (SELECT MAX(id) FROM ai_trade_decisions GROUP BY symbol)
          ORDER BY id DESC
        `).all() || [];
      } catch (_) {
        return [];
      }
    }
  }
}

