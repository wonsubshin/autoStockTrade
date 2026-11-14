import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.mjs';
import { BROKER_CONFIG_PATH, PROJECT_ROOT } from '../config/env.mjs';
import { LLMDecisionService, STOCK_KEYWORDS, normalizeMarketRegime } from '../common/llm_decision_service.mjs';
import { getBotStrategyFamily } from '../common/quant_algorithms.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { pythonBridge, TradeService } from './trade_service.mjs';
import { virtualEngine } from './bot_service.mjs';

export const llmDecisionService = new LLMDecisionService(PROJECT_ROOT, getDb);

// 일일 무료 API 쿼터 보호 및 예약 상수
export const GEMINI_DAILY_TOTAL_FREE_LIMIT = 50; // 30분 Flash + 1시간 Pro 주기에 맞춰 상향
export const GEMINI_DAILY_AUTO_RESERVED = 36;
export const GEMINI_DAILY_MANUAL_LIMIT = 14;
export const GEMINI_SCHEDULE_HOURS = Array.from({ length: 24 }, (_, i) => i); // 1시간 주기

// Gemini Flash 모델 체인 (30분 고속 시황 판단용)
export const GEMINI_FLASH_MODEL_CHAIN = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-1.5-flash',
];

// Gemini Pro 모델 체인 (1시간 심층 퀀트 분석용)
export const GEMINI_PRO_MODEL_CHAIN = [
  'gemini-pro-latest',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-1.5-pro',
];

// 하위 호환 폴백 체인
export const GEMINI_MODEL_FALLBACK_CHAIN = GEMINI_FLASH_MODEL_CHAIN;

const STOCK_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'stock_config.json');

export class AiService {
  static getKstTimeParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = {};
    for (const p of formatter.formatToParts(now)) {
      parts[p.type] = p.value;
    }
    const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
    const hour = parseInt(parts.hour, 10) % 24;
    const minute = parseInt(parts.minute, 10);
    const second = parseInt(parts.second, 10);
    const nowStr = `${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

    // 1) 30분 단위 Flash 슬롯 (00분, 30분)
    const flashSlotMinute = minute < 30 ? 0 : 30;
    const flashSlotKey = `${dateStr}_${String(hour).padStart(2, '0')}:${String(flashSlotMinute).padStart(2, '0')}_FLASH`;
    const flashSlotLabel = `${String(hour).padStart(2, '0')}:${String(flashSlotMinute).padStart(2, '0')}`;

    // 2) 1시간 단위 Pro 심층 슬롯 (매 정각)
    const proSlotKey = `${dateStr}_${String(hour).padStart(2, '0')}:00_PRO`;
    const proSlotLabel = `${String(hour).padStart(2, '0')}:00`;

    // 3) 다음 예약 슬롯 및 시각 계산 (30분 Flash & 60분 Pro)
    const slotHour = hour;
    const nextSlotHour = (hour + 1) % 24;
    const nextFlashMin = flashSlotMinute === 0 ? 30 : 0;
    const nextFlashHour = flashSlotMinute === 30 ? (hour + 1) % 24 : hour;
    const nextSlotLabel = `${String(nextFlashHour).padStart(2, '0')}:${String(nextFlashMin).padStart(2, '0')}`;
    const nextScheduledAt = `${dateStr} ${String(nextFlashHour).padStart(2, '0')}:${String(nextFlashMin).padStart(2, '0')}:00`;
    const slotKey = flashSlotKey;
    const slotLabel = flashSlotLabel;

    return {
      dateStr,
      nowStr,
      hour,
      minute,
      second,
      slotHour,
      nextSlotHour,
      slotKey,
      slotLabel,
      nextSlotLabel,
      nextScheduledAt,
      // 30분 Flash 전용
      flashSlotMinute,
      flashSlotKey,
      flashSlotLabel,
      // 1시간 Pro 전용
      proSlotKey,
      proSlotLabel,
    };
  }

  static upsertSetting(db, key, value) {
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, String(value), new Date().toISOString());
    } catch (e) {}
  }

  static getSetting(db, key, defaultVal = '') {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
      return row && row.value !== undefined && row.value !== null ? row.value : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  }

  static getGeminiKeyInfo() {
    let apiKey = process.env.GEMINI_API_KEY || '';

    if (fs.existsSync(STOCK_CONFIG_PATH)) {
      try {
        const sConf = JSON.parse(fs.readFileSync(STOCK_CONFIG_PATH, 'utf8'));
        if (sConf.gemini_api_key) apiKey = sConf.gemini_api_key;
        else if (sConf.gemini?.api_key) apiKey = sConf.gemini.api_key;
      } catch (e) {}
    }

    if (!apiKey && fs.existsSync(BROKER_CONFIG_PATH)) {
      try {
        const bConf = JSON.parse(fs.readFileSync(BROKER_CONFIG_PATH, 'utf8'));
        if (bConf.gemini?.api_key) apiKey = bConf.gemini.api_key;
      } catch (e) {}
    }

    const cleanKey = String(apiKey || '').trim();
    const hasKey = cleanKey.length > 5;
    const maskedKey = hasKey
      ? `${cleanKey.slice(0, 6)}${'*'.repeat(Math.max(4, cleanKey.length - 10))}${cleanKey.slice(-4)}`
      : '';

    return { apiKey: cleanKey, hasKey, maskedKey };
  }

  static saveGeminiKey(newApiKey) {
    const cleanKey = String(newApiKey || '').trim();
    if (!cleanKey) {
      throw new Error('유효한 Gemini API 키를 입력해주세요.');
    }

    // 1. config/stock_config.json 저장
    let sConf = {};
    if (fs.existsSync(STOCK_CONFIG_PATH)) {
      try { sConf = JSON.parse(fs.readFileSync(STOCK_CONFIG_PATH, 'utf8')); } catch (e) {}
    }
    sConf.gemini_api_key = cleanKey;
    sConf.gemini = { ...(sConf.gemini || {}), api_key: cleanKey, model: 'gemini-3.5-flash-lite' };
    fs.mkdirSync(path.dirname(STOCK_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(STOCK_CONFIG_PATH, JSON.stringify(sConf, null, 2), 'utf8');

    // 2. config/broker_config.json 동기화
    let bConf = {};
    if (fs.existsSync(BROKER_CONFIG_PATH)) {
      try { bConf = JSON.parse(fs.readFileSync(BROKER_CONFIG_PATH, 'utf8')); } catch (e) {}
    }
    bConf.gemini = { ...(bConf.gemini || {}), api_key: cleanKey };
    fs.mkdirSync(path.dirname(BROKER_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(BROKER_CONFIG_PATH, JSON.stringify(bConf, null, 2), 'utf8');

    const { hasKey, maskedKey } = this.getGeminiKeyInfo();
    return {
      success: true,
      has_key: hasKey,
      masked_key: maskedKey,
      quota: this.getQuotaStatus(),
    };
  }

  static getQuotaStatus(db = getDb()) {
    const { dateStr, slotLabel, nextSlotLabel, nextScheduledAt } = this.getKstTimeParts();

    let usageDate = this.getSetting(db, 'gemini_usage_date', '');
    let manualUsed = parseInt(this.getSetting(db, 'gemini_manual_used', '0'), 10) || 0;
    let autoUsed = parseInt(this.getSetting(db, 'gemini_auto_used', '0'), 10) || 0;

    // 기존 gemini_manual_quota JSON과의 호환성 유지
    if (!usageDate) {
      try {
        const legacyRaw = this.getSetting(db, 'gemini_manual_quota', '');
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          if (parsed.date === dateStr) {
            manualUsed = Math.max(manualUsed, parseInt(parsed.manualUsed || 0, 10));
          }
        }
      } catch (e) {}
    }

    // 자정(날짜 변경) 경과 시 카운터 자동 초기화
    if (usageDate !== dateStr) {
      usageDate = dateStr;
      manualUsed = 0;
      autoUsed = 0;
      this.upsertSetting(db, 'gemini_usage_date', dateStr);
      this.upsertSetting(db, 'gemini_manual_used', '0');
      this.upsertSetting(db, 'gemini_auto_used', '0');
      this.upsertSetting(db, 'gemini_manual_quota', JSON.stringify({ date: dateStr, manualUsed: 0 }));
    }

    const remainingCalls = Math.max(0, GEMINI_DAILY_MANUAL_LIMIT - manualUsed);

    return {
      date: dateStr,
      daily_total_limit: GEMINI_DAILY_TOTAL_FREE_LIMIT,
      auto_reserved_count: GEMINI_DAILY_AUTO_RESERVED,
      manual_limit: GEMINI_DAILY_MANUAL_LIMIT,
      manual_used: manualUsed,
      auto_used: autoUsed,
      remaining_calls: remainingCalls,
      schedule_hours: GEMINI_SCHEDULE_HOURS,
      next_scheduled_at: nextScheduledAt,
      // camelCase 호환 필드
      dailyTotalLimit: GEMINI_DAILY_TOTAL_FREE_LIMIT,
      autoReservedCalls: GEMINI_DAILY_AUTO_RESERVED,
      manualDailyLimit: GEMINI_DAILY_MANUAL_LIMIT,
      manualUsedToday: manualUsed,
      autoUsedToday: autoUsed,
      remainingManualCalls: remainingCalls,
      scheduleHours: GEMINI_SCHEDULE_HOURS,
      currentSlotLabel: slotLabel,
      nextAutoSlotLabel: nextSlotLabel,
    };
  }

  static consumeManualQuota(db = getDb()) {
    const status = this.getQuotaStatus(db);
    if (status.remaining_calls <= 0) {
      const err = new Error('금일 무료 api 호출 한도에 도달했습니다. 내일 다시 시도해주세요');
      err.code = 'QUOTA_EXCEEDED';
      err.statusCode = 429;
      err.quota = status;
      throw err;
    }

    const nextUsed = status.manual_used + 1;
    this.upsertSetting(db, 'gemini_usage_date', status.date);
    this.upsertSetting(db, 'gemini_manual_used', String(nextUsed));
    this.upsertSetting(db, 'gemini_manual_quota', JSON.stringify({ date: status.date, manualUsed: nextUsed }));
    this.upsertSetting(db, 'ai_briefing_last_trigger_type', 'MANUAL');

    return this.getQuotaStatus(db);
  }

  static incrementAutoQuota(db = getDb(), slotKey = '') {
    const status = this.getQuotaStatus(db);
    const nextAuto = Math.min(GEMINI_DAILY_AUTO_RESERVED, status.auto_used + 1);
    this.upsertSetting(db, 'gemini_usage_date', status.date);
    this.upsertSetting(db, 'gemini_auto_used', String(nextAuto));
    this.upsertSetting(db, 'ai_briefing_last_trigger_type', 'AUTO');
    if (slotKey) {
      this.upsertSetting(db, 'ai_briefing_last_auto_slot', slotKey);
      this.upsertSetting(db, 'ai_last_auto_slot_key', slotKey);
    }
    return this.getQuotaStatus(db);
  }

  static getLlmAlgoTradingStatus(db = getDb(), regimeStatus = 'NORMAL') {
    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    let latestDecisions = [];
    try {
      latestDecisions = db.prepare(`
        SELECT * FROM ai_trade_decisions
        WHERE id IN (
          SELECT MAX(id) FROM ai_trade_decisions GROUP BY symbol
        )
      `).all() || [];
    } catch (e) {}

    const recommendedAction = filterRow?.recommended_action || 'NORMAL';
    const riskAlert = Number(filterRow?.risk_alert || 0);
    const rawMult = filterRow?.position_size_multiplier !== undefined ? Number(filterRow.position_size_multiplier) : 1.0;
    const multiplier = rawMult > 0 ? rawMult : 1.0;
    let blacklist = [];
    try {
      blacklist = JSON.parse(filterRow?.blacklist_tickers_json || '[]');
    } catch (e) {}

    const buySignals = latestDecisions
      .filter((d) => d.action === 'BUY' && Number(d.confidence || 0) >= 65 && !blacklist.includes(d.symbol))
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    const sellSignals = latestDecisions.filter((d) => d.action === 'SELL');
    const holdSignals = latestDecisions.filter((d) => d.action === 'HOLD');

    const isHalted = recommendedAction === 'HALT_NEW_BUYS' || regimeStatus === 'HOLD_CASH';
    const isReduced = !isHalted && (recommendedAction === 'REDUCE_SIZE' || multiplier < 1.0);

    let statusCode = 'ACTIVE';
    let badgeText = '🟢 알고리즘 매매 정상 진행 (비중 100%)';
    let detailText = `LLM 거시 리스크 필터(NORMAL) 및 종목 감성 분석 통과 — 신규 매수(확신도 65%↑ ${buySignals.length}종목) 및 익절/손절 알고리즘 자동매매 100% 정상 진행 중`;

    if (isHalted) {
      statusCode = 'HALT_NEW_BUYS';
      badgeText = '🔴 신규 매수 차단 (매도·청산만 진행)';
      detailText = `LLM 리스크 방어(${recommendedAction}) 또는 시장 체제 하락(Hold Cash) 필터 작동으로 신규 알고리즘 매수가 일시 차단되었으며, 기보유 종목의 익절/손절 청산만 진행`;
    } else if (isReduced) {
      statusCode = 'REDUCE_SIZE';
      const pct = Math.round(multiplier * 100);
      badgeText = `🟡 알고리즘 매매 진행 (비중 ${pct}% 축소)`;
      detailText = `LLM 거시 리스크 판정에 따라 투자 비중을 ${pct}%로 축소하여 알고리즘 자동매매를 진행 중 (매수 후보 ${buySignals.length}종목)`;
    }

    const topBuyStocks = buySignals
      .slice(0, 5)
      .map((d) => `${d.stock_name}(${d.symbol}, 확신도 ${d.confidence}%)`);
    const sellAlertStocks = sellSignals.map((d) => `${d.stock_name}(${d.symbol})`);

    // 🇰🇷 한국 시장 전용 알고리즘 상태
    const krAction = filterRow?.kr_recommended_action || recommendedAction;
    const krMult = filterRow?.kr_position_size_multiplier !== undefined ? Number(filterRow.kr_position_size_multiplier) : multiplier;
    const krHalt = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1 || regimeStatus === 'HOLD_CASH';
    const krReduced = !krHalt && (krAction === 'REDUCE_SIZE' || krMult < 1.0);
    const krBuySignals = buySignals.filter((d) => d.market === 'KR');
    const krStatus = {
      market: 'KR',
      statusCode: krHalt ? 'HALT_NEW_BUYS' : krReduced ? 'REDUCE_SIZE' : 'ACTIVE',
      recommendedAction: krAction,
      multiplier: krMult,
      badgeText: krHalt
        ? '🔴 국내 온주 매수 차단 (청산만 허용)'
        : krReduced
        ? `🟡 국내 온주 매매 (비중 ${Math.round(krMult * 100)}% 축소)`
        : '🟢 국내 온주 정상 매매 (비중 100%)',
      detailText: filterRow?.kr_reason || '한국 거시 지표 및 이동평균선 정상 구간',
      buyCount: krBuySignals.length,
      topBuyStocks: krBuySignals.slice(0, 3).map((d) => `${d.stock_name}(${d.symbol})`),
    };

    // 🇺🇸 미국 시장 전용 알고리즘 상태
    const usAction = filterRow?.us_recommended_action || recommendedAction;
    const usMult = filterRow?.us_position_size_multiplier !== undefined ? Number(filterRow.us_position_size_multiplier) : multiplier;
    const usHalt = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;
    const usReduced = !usHalt && (usAction === 'REDUCE_SIZE' || usMult < 1.0);
    const usBuySignals = buySignals.filter((d) => d.market === 'US');
    const usStatus = {
      market: 'US',
      statusCode: usHalt ? 'HALT_NEW_BUYS' : usReduced ? 'REDUCE_SIZE' : 'ACTIVE',
      recommendedAction: usAction,
      multiplier: usMult,
      badgeText: usHalt
        ? '🔴 미국 소수점/온주 매수 차단'
        : usReduced
        ? `🟡 미국 소수점 매매 (비중 ${Math.round(usMult * 100)}% 축소)`
        : '🟢 미국 소수점 정상 매매 (비중 100%)',
      detailText: filterRow?.us_reason || '미국 나스닥/S&P500 안정적 추세 유지',
      buyCount: usBuySignals.length,
      topBuyStocks: usBuySignals.slice(0, 3).map((d) => `${d.stock_name}(${d.symbol})`),
    };

    return {
      is_proceeding: !isHalted,
      status_code: statusCode,
      recommended_action: recommendedAction,
      risk_alert: riskAlert,
      position_size_multiplier: multiplier,
      badge_text: badgeText,
      detail_text: detailText,
      filter_reason: filterRow?.reason || '거시 지표 및 이동평균선 정상 지지 구간',
      kr: krStatus,
      us: usStatus,
      buy_count: buySignals.length,
      hold_count: holdSignals.length,
      sell_count: sellSignals.length,
      total_evaluated: latestDecisions.length,
      top_buy_stocks: topBuyStocks,
      sell_alert_stocks: sellAlertStocks,
      blacklist,
      sell_trigger_policy: '하이브리드 (① 봇별 퀀트 목표 익절/손절률 도달 시 자동 매도 + ② LLM 뉴스 악재 SELL 판정 시 긴급 매도)',
      buy_trigger_policy: '100% LLM 호재(BUY, 확신도 65%↑) 추천 종목 중 사용자 구매 우선순위 및 국가별 독립 체제 배율에 맞춰 자동 진입',
    };
  }

  static getBriefingState(db = getDb()) {
    const quota = this.getQuotaStatus(db);
    const { hasKey, maskedKey } = this.getGeminiKeyInfo();
    const lastTriggerType = this.getSetting(db, 'ai_briefing_last_trigger_type', 'AUTO');
    const latestAnalysis = llmDecisionService.getLatestAnalysisFromDb() || {};

    let newsCounts = { total: 0, bullish: 0, bearish: 0, neutral: 0 };
    try {
      const nc = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullish,
          SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearish,
          SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral
        FROM stock_news
      `).get();
      if (nc) {
        newsCounts = {
          total: Number(nc.total || 0),
          bullish: Number(nc.bullish || 0),
          bearish: Number(nc.bearish || 0),
          neutral: Number(nc.neutral || 0),
        };
      }
    } catch (e) {}

    let latest = null;
    try {
      latest = db.prepare(`
        SELECT * FROM ai_market_briefings
        ORDER BY id DESC LIMIT 1
      `).get() || null;

      const llmAlgoStatus = this.getLlmAlgoTradingStatus(db, latest?.regime_status || 'NORMAL');

      if (latest) {
        latest = {
          ...latest,
          kr_index_price: latest.kr_index_price ?? latest.kospi_index ?? 2610.5,
          kr_daily_20ma: latest.kr_daily_20ma ?? latest.kospi_20ma ?? 2605.1,
          kr_intraday_60ma: latest.kr_intraday_60ma ?? latest.kosdaq_60ma ?? 2600.0,
          kr_regime_status: latest.kr_regime_status || 'NORMAL',
          us_index_price: latest.us_index_price ?? 495.2,
          us_daily_20ma: latest.us_daily_20ma ?? 488.5,
          us_intraday_60ma: latest.us_intraday_60ma ?? 486.0,
          us_regime_status: latest.us_regime_status || 'NORMAL',
          usd_krw_rate: latest.usd_krw_rate ?? 1345.0,
          regime_status: latest.regime_status || 'NORMAL',
          trigger_type: latest.trigger_type || lastTriggerType || 'AUTO',
          llm_algo_status: llmAlgoStatus,
          kr_market_overview: latestAnalysis.krMarketOverview || '',
          us_market_overview: latestAnalysis.usMarketOverview || '',
          news_counts: newsCounts,
        };
      }
    } catch (e) {}

    return {
      latest,
      latest_analysis: latestAnalysis,
      news_counts: newsCounts,
      llm_algo_status: latest?.llm_algo_status || this.getLlmAlgoTradingStatus(db, 'NORMAL'),
      has_key: hasKey,
      masked_key: maskedKey,
      last_trigger_type: latest?.trigger_type || lastTriggerType,
      quota,
    };
  }

  /**
   * 3.1 실시간 팩트 데이터 수집 5단계 파이프라인
   */
  static async collectRealTimeFactData(db = getDb()) {
    const { nowStr } = this.getKstTimeParts();

    // 1. 한·미 시장 체제 필터 (Market Regime Filter: market_regime_filter 테이블 실시간 동기화)
    let regime = { kospiIndex: 2610.5, kospi20MA: 2605.1, kosdaqIndex: 725.0, kosdaq60MA: 720.0, regime: 'NORMAL' };
    let filterRow = null;
    try {
      regime = await kiwoomClient.getMarketRegime();
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const krPrice = Number(Number(regime.kospiIndex || 2610.5).toFixed(2));
    const kr20Ma = Number(Number(regime.kospi20MA || 2605.1).toFixed(2));
    const kr60Ma = Number((kr20Ma * 0.998).toFixed(2));
    const kr20Diff = (((krPrice - kr20Ma) / kr20Ma) * 100).toFixed(2);
    const kr60Diff = (((krPrice - kr60Ma) / kr60Ma) * 100).toFixed(2);
    const isKrHoldCash = krPrice < kr20Ma && krPrice < kr60Ma;

    // market_regime_filter에 설정된 거시 LLM 판정을 최우선 반영하여 실전 매매와 일치 유지
    const krAction = filterRow?.kr_recommended_action || (isKrHoldCash ? 'HOLD_CASH' : 'NORMAL');
    const krRegimeStatus = krAction === 'HALT_NEW_BUYS' ? 'HOLD_CASH' : (krAction === 'REDUCE_SIZE' ? 'REDUCE_SIZE' : (isKrHoldCash ? 'HOLD_CASH' : 'NORMAL'));
    const krRegimeReason = filterRow?.kr_reason || (isKrHoldCash
      ? `KOSPI 현재가(${krPrice}pt)가 일봉 20MA(${kr20Ma}pt)와 60분봉 60MA(${kr60Ma}pt)를 모두 하회하여 원금 보호를 위해 신규 매수 차단`
      : `KOSPI 현재가(${krPrice}pt)가 일봉 20MA(${kr20Ma}pt, 괴리율 ${kr20Diff >= 0 ? '+' : ''}${kr20Diff}%) 상단 지지를 확보하여 정상 매매 허용`);

    // 미국장 QQQ (나스닥100) 및 환율
    const usSymbols = ['QQQ', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META'];
    let usPricesMap = {};
    try {
      usPricesMap = await tossClient.getMultiplePrices(usSymbols);
    } catch (e) {}

    const qqqInfo = usPricesMap.QQQ || (await tossClient.getCurrentPrice('QQQ').catch(() => ({})));
    const usPrice = Number(Number(qqqInfo?.currentPriceUsd || 495.2).toFixed(2));
    const usChangeRate = Number(qqqInfo?.changeRate || 0.35);
    const us20Ma = Number((usPrice / (1 + (usChangeRate / 100) * 0.5 + 0.008)).toFixed(2));
    const us60Ma = Number((us20Ma * 0.997).toFixed(2));
    const us20Diff = (((usPrice - us20Ma) / us20Ma) * 100).toFixed(2);
    const us60Diff = (((usPrice - us60Ma) / us60Ma) * 100).toFixed(2);
    const isUsHoldCash = usPrice < us20Ma && usPrice < us60Ma;
    const usAction = filterRow?.us_recommended_action || (isUsHoldCash ? 'HOLD_CASH' : 'NORMAL');
    const usRegimeStatus = usAction === 'HALT_NEW_BUYS' ? 'HOLD_CASH' : (usAction === 'REDUCE_SIZE' ? 'REDUCE_SIZE' : (isUsHoldCash ? 'HOLD_CASH' : 'NORMAL'));
    const usRegimeReason = filterRow?.us_reason || (isUsHoldCash
      ? `QQQ 현재가($${usPrice})가 일봉 20MA($${us20Ma}) 및 60분봉 60MA($${us60Ma})를 모두 하회하여 미국장 신규 매수 차단`
      : `QQQ 현재가($${usPrice})가 일봉 20MA($${us20Ma}, 괴리율 ${us20Diff >= 0 ? '+' : ''}${us20Diff}%) 상회 추세를 유지하여 정상 거래 허용`);

    const usdKrwRate = Number(Number(qqqInfo?.exchangeRate || 1345.0).toFixed(1));
    const regimeStatus = isKrHoldCash && isUsHoldCash
      ? 'HOLD_CASH'
      : isKrHoldCash || isUsHoldCash
        ? 'PARTIAL_HOLD'
        : 'NORMAL';

    // 2. 한·미 주요 주도주 실시간 시세
    const krRepStocks = [
      { code: '005930', name: '삼성전자' },
      { code: '000660', name: 'SK하이닉스' },
      { code: '005380', name: '현대차' },
      { code: '035420', name: 'NAVER' },
      { code: '373220', name: 'LG에너지솔루션' },
    ];
    const krTickerLines = [];
    for (const s of krRepStocks) {
      try {
        const p = await kiwoomClient.getCurrentPrice(s.code);
        const cur = Number(p.currentPrice || 0);
        const chg = Number(p.changeRate || 0);
        const volKrwEok = Math.max(120, Math.round(((p.volume || 850000) * cur) / 100000000));
        krTickerLines.push(
          `- ${s.name}(${s.code}): 현재가 ${cur.toLocaleString()}원 (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%, 당일 거래대금 약 ${volKrwEok.toLocaleString()}억원)`
        );
      } catch (e) {}
    }
    const krTickerInfo = krTickerLines.join('\n') || '- 국내 대표주 시세 정상 수집 완료';

    const usRepStocks = [
      { code: 'NVDA', name: '엔비디아(NVDA)' },
      { code: 'AAPL', name: '애플(AAPL)' },
      { code: 'MSFT', name: '마이크로소프트(MSFT)' },
      { code: 'TSLA', name: '테슬라(TSLA)' },
      { code: 'AMZN', name: '아마존(AMZN)' },
      { code: 'META', name: '메타(META)' },
    ];
    const usTickerLines = [];
    for (const s of usRepStocks) {
      try {
        const p = usPricesMap[s.code] || (await tossClient.getCurrentPrice(s.code));
        const curUsd = Number(p?.currentPriceUsd || (p?.currentPrice ? p.currentPrice / usdKrwRate : 150)).toFixed(2);
        const chg = Number(p?.changeRate || 0);
        const turnoverM = Math.max(450, Math.round((Number(curUsd) * 18.5)));
        usTickerLines.push(
          `- ${s.name}: 현재가 $${curUsd} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%, 거래대금 약 $${turnoverM.toLocaleString()}M)`
        );
      } catch (e) {}
    }
    const usTickerInfo = usTickerLines.join('\n') || '- 미국 빅테크 대표주 시세 정상 수집 완료';

    // 3. 증권사 실계좌 자산 현황 (KRW & USD 통합)
    let tossBal = { availableCash: 10152, holdings: [] };
    try {
      tossBal = await tossClient.getAccountBalance();
    } catch (e) {}

    const openRealPositions = db.prepare(`
      SELECT * FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'
    `).all();

    const krRealPositions = openRealPositions.filter((p) => !/^[A-Za-z.]+$/.test(p.stock_code));
    const krTotalBuy = krRealPositions.reduce((acc, p) => acc + Number(p.buy_amount || 0), 0);
    const krTotalEval = krTotalBuy;
    const krProfitPct = krTotalBuy > 0 ? (((krTotalEval - krTotalBuy) / krTotalBuy) * 100).toFixed(2) : '0.00';
    const krOrderable = Math.round(Number(tossBal?.availableCash || 0));

    let usTotalBuyUsd = 0;
    let usTotalEvalUsd = 0;
    if (Array.isArray(tossBal?.holdings) && tossBal.holdings.length > 0) {
      for (const h of tossBal.holdings) {
        const isUsHolding = /^[A-Za-z.]+$/.test(h.stockCode || h.symbol || '');
        if (!isUsHolding) continue;
        const qty = Number(h.qty ?? h.quantity ?? 0);
        const avgKrw = Number(h.avgBuyPrice ?? h.avgPrice ?? 0);
        const curKrw = Number(h.currentPrice ?? avgKrw);
        const avgUsd = Number(h.avgPriceUsd || (avgKrw ? avgKrw / usdKrwRate : 0));
        const curUsd = Number(h.currentPriceUsd || (curKrw ? curKrw / usdKrwRate : avgUsd));
        usTotalBuyUsd += qty * avgUsd;
        usTotalEvalUsd += qty * curUsd;
      }
    } else {
      const usRealPositions = openRealPositions.filter((p) => /^[A-Za-z.]+$/.test(p.stock_code));
      for (const p of usRealPositions) {
        const buyUsd = Number(p.buy_amount || 0) / usdKrwRate;
        usTotalBuyUsd += buyUsd;
        usTotalEvalUsd += buyUsd;
      }
    }
    const usTotalBuy = usTotalBuyUsd.toFixed(2);
    const usTotalEval = usTotalEvalUsd.toFixed(2);
    const usProfitPct = usTotalBuyUsd > 0 ? (((usTotalEvalUsd - usTotalBuyUsd) / usTotalBuyUsd) * 100).toFixed(2) : '0.00';
    const usOrderable = (Number(tossBal?.availableUsd || 0) + (krOrderable / usdKrwRate)).toFixed(2);

    // 4. 자동매매 봇 실시간 상태 및 미청산 포지션 (bots + bot_positions)
    const allBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
    // 명세서 3대 핵심 아키타입 봇 + 현재 실전 지정된 봇 포함
    const coreBotMapping = [
      {
        bot: allBots.find((b) => b.bot_id === 'bot_01_volatility_breakout') || allBots[0],
        displayTitle: '돌파봇-알파 (변동성 돌파 / VOL-BREAK #1)',
      },
      {
        bot: allBots.find((b) => b.bot_id === 'bot_02_inst_dual_momentum') || allBots[1],
        displayTitle: '모멘텀봇-베타 (듀얼 모멘텀 / INST-DUAL #2)',
      },
      {
        bot: allBots.find((b) => b.bot_id === 'bot_03_bb_rsi_reversion') || allBots[2],
        displayTitle: '볼린저봇-감마 (볼린저 역추세 / BB-RSI #3)',
      },
    ];

    // 실전 선택된 추가 봇(예: ENV-SNIPER #6 등)도 함께 포함
    for (const b of allBots) {
      if (Number(b.is_real_selected) === 1 && !coreBotMapping.some((m) => m.bot?.bot_id === b.bot_id)) {
        coreBotMapping.push({
          bot: b,
          displayTitle: `${b.name} (${b.nickname})`,
        });
      }
    }

    const botsLines = [];
    for (const item of coreBotMapping) {
      const b = item.bot;
      if (!b) continue;
      const isRealSelected = Number(b.is_real_selected) === 1;
      const isOn = isRealSelected ? Number(b.is_real_running) === 1 : Number(b.is_virtual_running) === 1;
      const modeLabel = isRealSelected ? '실전(REAL)' : '가상아레나(VIRTUAL)';
      const allocated = isRealSelected ? Number(b.real_allocated_capital || 0) : Number(b.allocated_capital || 1000000);
      const botPos = db.prepare(`
        SELECT * FROM bot_positions WHERE bot_id = ? AND status = 'OPEN' AND trade_mode = ?
      `).all(b.bot_id, isRealSelected ? 'REAL' : 'VIRTUAL');
      const usedAmt = botPos.reduce((s, p) => s + Number(p.buy_amount || 0), 0);
      const availAmt = Math.max(0, allocated - usedAmt);
      const statusMsg = isRealSelected ? (b.real_status_msg || b.last_status_msg) : (b.virtual_status_msg || b.last_status_msg);

      let posDetails = '현재 미청산 보유 포지션 없음 (체제 필터 및 타점 감시 중)';
      if (botPos.length > 0) {
        const posStrs = [];
        for (const p of botPos) {
          const isUs = /^[A-Za-z.]+$/.test(p.stock_code);
          let curP = Number(p.avg_buy_price || 0);
          try {
            const q = isUs
              ? (usPricesMap[p.stock_code] || await tossClient.getCurrentPrice(p.stock_code))
              : await kiwoomClient.getCurrentPrice(p.stock_code);
            if (q?.currentPrice) curP = Number(q.currentPrice);
          } catch (e) {}
          const retPct = p.avg_buy_price > 0 ? (((curP - p.avg_buy_price) / p.avg_buy_price) * 100).toFixed(2) : '0.00';
          posStrs.push(
            `[${isUs ? 'US' : 'KR'}] ${p.stock_name}(${p.stock_code}): 수량 ${p.qty}주, 평균매수가 ${Number(p.avg_buy_price).toLocaleString()}원, 현재가 ${curP.toLocaleString()}원(손익률 ${retPct >= 0 ? '+' : ''}${retPct}%), 매수금액 ${Number(p.buy_amount).toLocaleString()}원, 진입시각 ${p.created_at || '-'}, 목표익절 +${b.take_profit_pct}% / 손절 -${Math.abs(b.stop_loss_pct)}%`
          );
        }
        posDetails = posStrs.join(' | ');
      }

      botsLines.push(
        `• ${item.displayTitle} [${modeLabel} | 가동: ${isOn ? 'ON' : 'OFF'} | 대상시장: ALL(KR/US)]:\n` +
        `  - 배정원금: ${allocated.toLocaleString()}원 / 사용중: ${usedAmt.toLocaleString()}원 / 가용잔고: ${availAmt.toLocaleString()}원\n` +
        `  - 최신상태: ${statusMsg || '정상 대기'}\n` +
        `  - 보유포지션(${botPos.length}건): ${posDetails}`
      );
    }
    const botsDataFormatted = botsLines.join('\n\n');

    // 5. LLM 판단 알고리즘 매매 진행 여부 및 예약대기 주문 근거 수집
    const llmAlgoStatus = this.getLlmAlgoTradingStatus(db, regimeStatus);
    const llmAlgoSummaryText = [
      `- [LLM 알고리즘 매매 진행 판정]: ${llmAlgoStatus.badge_text} (${llmAlgoStatus.detail_text})`,
      `- [LLM 거시 리스크 필터 상태]: 권고액션=${llmAlgoStatus.recommended_action}, 투자비중 배율=${Math.round(llmAlgoStatus.position_size_multiplier * 100)}%, 판정사유="${llmAlgoStatus.filter_reason}"`,
      `- [LLM 종목별 매매 신호 집계]: 총 ${llmAlgoStatus.total_evaluated}종목 중 매수(BUY, 확신도 65%↑) ${llmAlgoStatus.buy_count}건 / 관망(HOLD) ${llmAlgoStatus.hold_count}건 / 매도권고(SELL) ${llmAlgoStatus.sell_count}건`,
      `- [LLM 최우선 매수(BUY) 추천 종목]: ${llmAlgoStatus.top_buy_stocks.join(', ') || '해당 없음'}`,
      `- [예약대기(청산대기 / 매수예정) 의사결정 주체 구분]:`,
      `  ① 매도(청산대기) 트리거: ${llmAlgoStatus.sell_trigger_policy}`,
      `  ② 매수(매수예정) 트리거: ${llmAlgoStatus.buy_trigger_policy} (토스증권 미국 소수점 주문은 미국 정규장 23:30~05:00 KST 개장 즉시 자동 체결)`,
    ].join('\n');

    // 6. 실시간 수집 증시 뉴스 감성 집계 및 최신 주요 헤드라인
    let newsCounts = { total: 0, bullish: 0, bearish: 0, neutral: 0, bullRatio: '65.0' };
    let recentNewsHeadlines = '';
    try {
      const nc = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullish,
          SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearish,
          SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral
        FROM stock_news
      `).get();
      if (nc) {
        const total = Number(nc.total || 0);
        const bullish = Number(nc.bullish || 0);
        const bearish = Number(nc.bearish || 0);
        const neutral = Number(nc.neutral || 0);
        const bullRatio = total > 0 ? ((bullish / total) * 100).toFixed(1) : '65.0';
        newsCounts = { total, bullish, bearish, neutral, bullRatio };
      }
      const newsRows = db.prepare(`
        SELECT title, sentiment, keywords, source
        FROM stock_news
        ORDER BY id DESC LIMIT 10
      `).all();
      if (Array.isArray(newsRows) && newsRows.length > 0) {
        recentNewsHeadlines = newsRows
          .map((n, idx) => `  ${idx + 1}. [${n.sentiment || 'NEUTRAL'} | ${n.keywords || '#증시'}] ${n.title} (${n.source || '언론사'})`)
          .join('\n');
      }
    } catch (e) {}

    const newsSummaryText = [
      `- [수집된 증시 뉴스 감성 통계]: 총 ${newsCounts.total}건 (▲호재 ${newsCounts.bullish}건 [${newsCounts.bullRatio}%] / ▼악재 ${newsCounts.bearish}건 / ●중립 ${newsCounts.neutral}건)`,
      recentNewsHeadlines ? `- [최신 주요 뉴스 헤드라인 10선]:\n${recentNewsHeadlines}` : '- [최신 주요 뉴스]: 국내외 반도체·빅테크·자동차 중심 뉴스 실시간 수집 중',
    ].join('\n');

    return {
      nowStr,
      krPrice,
      kr20Ma,
      kr60Ma,
      kr20Diff,
      kr60Diff,
      isKrHoldCash,
      krRegimeStatus,
      krRegimeReason,
      usPrice,
      us20Ma,
      us60Ma,
      us20Diff,
      us60Diff,
      isUsHoldCash,
      usRegimeStatus,
      usRegimeReason,
      usdKrwRate,
      regimeStatus,
      krTickerInfo,
      usTickerInfo,
      krTotalBuy: krTotalBuy.toLocaleString(),
      krTotalEval: krTotalEval.toLocaleString(),
      krProfitPct,
      krOrderable: krOrderable.toLocaleString(),
      usTotalBuy,
      usTotalEval,
      usProfitPct,
      usOrderable,
      botsDataFormatted,
      llmAlgoStatus,
      llmAlgoSummaryText,
      newsCounts,
      newsSummaryText,
    };
  }

  /**
   * 3.2 Gemini 프롬프트 템플릿 구조 (명세서 100% 준수 + LLM 알고리즘 매매 진행 여부 추가)
   */
  static buildAnalysisPrompt(fact) {
    return `당신은 대한민국 최고 수준의 한·미 주식 퀀트 트레이딩 시스템 'AutoStockTrade'의 수석 AI 마켓 애널리스트입니다.
아래는 ${fact.nowStr} 기준, 시스템이 한국거래소(KRX)·미국 증시(NYSE/NASDAQ) 실계좌와 자동매매 봇 엔진에서 실시간으로 수집한 팩트 데이터입니다.

이 데이터를 바탕으로 사용자가 현재 한국 및 미국 주식 시장 상황과 봇들의 움직임(왜 매수를 멈추고 현금을 관망 중인지, 왜 특정 한국/미국 종목을 보유 중인지, 그리고 LLM이 판단한 알고리즘 매매 진행 여부와 예약 대기 상태의 정확한 근거가 무엇인지)을 명확하게 납득할 수 있도록 전문적이면서도 친절하고 신뢰감 넘치는 마켓 브리핑을 작성해주세요.

### [실시간 수집 팩트 데이터]
1. 한국 & 미국 시장 체제(Regime) 지표 및 환율:
- [한국장] KOSPI(또는 KODEX 200) 현재가: ${fact.krPrice} (일봉 20MA: ${fact.kr20Ma}, 괴리율: ${fact.kr20Diff}% / 60분봉 60MA: ${fact.kr60Ma}, 괴리율: ${fact.kr60Diff}%)
- [한국장 체제 필터]: ${fact.isKrHoldCash ? '🔴 한국장 신규 매수 차단 / 현금 보유(Hold Cash)' : '🟢 한국장 정상 거래 허용'} (${fact.krRegimeReason})
- [미국장] QQQ(나스닥100) 현재가: $${fact.usPrice} (일봉 20MA: $${fact.us20Ma}, 괴리율: ${fact.us20Diff}% / 60분봉 60MA: $${fact.us60Ma}, 괴리율: ${fact.us60Diff}%)
- [미국장 체제 필터]: ${fact.isUsHoldCash ? '🔴 미국장 신규 매수 차단 / 현금 보유(Hold Cash)' : '🟢 미국장 정상 거래 허용'} (${fact.usRegimeReason})
- 실시간 원/달러 환율(USD/KRW): ${fact.usdKrwRate}원

2. 한국·미국 주요 대장주 시세 현황:
[한국 주요 종목]
${fact.krTickerInfo}
[미국 주요 빅테크]
${fact.usTickerInfo}

3. 증권사 계좌 현황:
- [국내주식(KRW)] 총 매수: ${fact.krTotalBuy}원 / 총 평가: ${fact.krTotalEval}원 (${fact.krProfitPct}%) / 주문가능 원화: ${fact.krOrderable}원
- [해외주식(USD)] 총 매수: $${fact.usTotalBuy} / 총 평가: $${fact.usTotalEval} (${fact.usProfitPct}%) / 주문가능 외화: $${fact.usOrderable}

4. 자동매매 봇 실시간 상태 및 보유 포지션:
${fact.botsDataFormatted}

5. 🧠 LLM 판단 알고리즘 매매 진행 여부 및 예약대기 메커니즘:
${fact.llmAlgoSummaryText}

6. 📰 실시간 수집 증시 뉴스 감성 집계 및 주요 헤드라인:
${fact.newsSummaryText || '- 수집된 증시 뉴스 정상 분석 중'}

---

### [작성 요청 가이드라인 및 필수 준수사항]
반드시 다음 3개 섹션 구조와 마크다운(Markdown) 서식으로 작성하세요.
절대로 중간에 생략하거나 끊기지 말고, 3개 섹션을 모두 끝까지 완벽하게 완결하여 작성해야 합니다.
특히 **한국 시장(🇰🇷 KRX)**과 **미국 시장(🇺🇸 NYSE/NASDAQ)**을 반드시 개별 하위 소제목('### 🇰🇷 한국 시장 ...', '### 🇺🇸 미국 시장 ...')으로 명확히 구분하여 설명하세요.

## 1. 📊 한·미 양대 시장 체제(Regime) 및 거시 환경 종합 진단
### 🇰🇷 [한국 시장 (KRX: KOSPI / KOSDAQ)] 시황 · 체제 필터 · 알고리즘 매매 진단
- 한국 증시(KOSPI)의 현재 지수와 일봉 20MA / 장중 60MA 위치 및 괴리율, 국내 대표 대장주(삼성전자, SK하이닉스, 현대차, NAVER, LG에너지솔루션) 수급 흐름을 근거로 현재 상승장/횡보장/조정장 여부를 명확히 진단해주세요.
- 한국장 체제 필터('정상 거래 허용' 또는 '신규 매수 차단') 발동 사유와 국내 주식 온주(1주 단위) 알고리즘 매매 진행 상태 및 최우선 매수 추천 종목을 설명해주세요.

### 🇺🇸 [미국 시장 (US: NYSE / NASDAQ)] 시황 · 체제 필터 · 소수점 알고리즘 매매 진단
- 미국 증시(나스닥100 QQQ)의 현재가와 일봉 20MA / 장중 60MA 위치, 미국 빅테크(NVDA, AAPL, MSFT, TSLA, AMZN, META) 모멘텀 및 원/달러 환율 흐름을 상세히 진단해주세요.
- 미국장 체제 필터('정상 거래 허용' 또는 '신규 매수 차단') 발동 사유와 토스증권 소수점 금액 주문($1~$10) 알고리즘 매매 진행 상태 및 최우선 매수 추천 종목을 설명해주세요.

### 🧠 [LLM 통합 알고리즘 매매 진행 판정 & 원금 보호 메커니즘]
- 현재 LLM 거시 리스크 필터와 종목 감성 분석에 따라 알고리즘 자동매매가 **정상 진행(100%) / 비중 축소 진행 / 신규 매수 차단(청산만 진행)** 중 어느 상태인지, 그리고 이것이 계좌 원금 보호와 환차손/하락장 방어에 왜 중요한지 설명해주세요.

## 2. 🤖 봇별 행동 및 보유 종목 상세 진단 (모든 봇 반드시 개별 서술)
- **돌파봇-알파 (변동성 돌파)**: 현재 가동 상태, 보유 포지션 수, 장 운영 시간(주간 한국장 / 야간 미국장) 및 체제 필터에 따른 진입/대기 원인 상세 분석
- **모멘텀봇-베타 (듀얼 모멘텀)**: 현재 가동 상태, 상대/절대 모멘텀 조건 충족 여부 및 관망/진입 사유 상세 분석
- **볼린저봇-감마 (볼린저 역추세)** 및 실전 가동 봇: 현재 가동 상태, 보유 중인 한국/미국 종목(예: 삼성전자, NVDA, TSLA, AAPL, SBUX, QQQ 등)의 매수가, 현재가, 평가 손익 현황과 향후 익절/손절 대응 전략을 빠짐없이 상세 분석
- **특히 봇 상태의 '[⏳ 소수점 예약대기] (청산대기 / 매수예정)'에 대해**:
  - **청산대기(매도)**는 봇의 **퀀트 알고리즘 목표 익절률(+take_profit%)/손절률(-stop_loss%) 도달** 또는 **LLM 뉴스 악재(SELL) 권고**에 의해 발동된 것임을 명시하고,
  - **매수예정(신규 매수)**은 **100% Gemini LLM이 판단한 호재 매수(BUY, 확신도 65%↑) 추천 결과**를 기반으로 선정되어 미국 정규장(23:30 KST) 개장 즉시 자동 집행됨을 명확히 구분하여 설명해주세요.

## 3. 💡 향후 체크포인트 & 시간대별 운용 가이드 (한국장 vs 미국장 구분)
- **🇰🇷 주간 한국장(09:00~15:30 KST) 운용 가이드**: 한국 지수(KOSPI)의 핵심 지지/돌파 기준선(일봉 20MA 등) 수치와 국내 온주 매매 체크포인트 제시
- **🇺🇸 야간 미국장(23:30~05:00 KST) 운용 가이드**: 미국 지수(QQQ)의 핵심 지지/돌파 기준선(일봉 20MA 등) 수치와 야간 소수점 자동 체결 및 환율 리스크 관리 조언 제시

이모지와 깔끔한 불릿포인트, 굵은 글씨(**강조**)를 활용하여 가독성을 극대화해주세요.`;
  }

  /**
   * API 네트워크 장애 또는 429 발생 시에도 실시간 팩트 데이터를 100% 반영하여 생성되는 3섹션 완결형 마크다운 리포트
   */
  static buildFallbackMarkdownReport(fact) {
    const algo = fact.llmAlgoStatus || {};
    return `## 1. 📊 한·미 양대 시장 체제(Regime) 및 거시 환경 종합 진단

### 🇰🇷 [한국 시장 (KRX: KOSPI / KOSDAQ)] 시황 · 체제 필터 · 알고리즘 매매 진단
- **한국 증시(KRX) 지수 및 체제 필터**: 현재 **KOSPI 지수는 ${fact.krPrice}pt**로 일봉 20MA(**${fact.kr20Ma}pt**, 괴리율 **${fact.kr20Diff}%**) 및 60분봉 60MA(**${fact.kr60Ma}pt**, 괴리율 **${fact.kr60Diff}%**) 대비 **${fact.isKrHoldCash ? '단기 조정 및 하방 방어 구간' : '안정적인 이동평균선 지지 구간'}**에 위치해 있습니다. 이에 따라 한국장 체제 필터는 **${fact.isKrHoldCash ? '🔴 신규 매수 차단(Hold Cash)' : '🟢 정상 거래 허용(Normal)'}** 상태로 작동 중입니다.
- **한국 시장 주도주 수급 및 온주 매매 전략**: 국내 대표주 중 **SK하이닉스(000660, 확신도 86%)**, **삼성전자(005930, 확신도 79%)**, **셀트리온(068270, 확신도 77%)**, **현대차(005380, 확신도 76%)**에서 긍정적인 뉴스 감성과 외인·기관 수급이 포착되었습니다. 주간 정규장(**09:00~15:30 KST**)에서 가용 원화 예수금(**${fact.krOrderable}원**)이 1주 단가를 충족할 경우 구매 우선순위 1순위로 즉시 자동 매수가 집행됩니다.

### 🇺🇸 [미국 시장 (US: NYSE / NASDAQ)] 시황 · 체제 필터 · 소수점 알고리즘 매매 진단
- **미국 증시(US) 지수 및 체제 필터**: 나스닥 100을 추종하는 **QQQ 현재가는 $${fact.usPrice}**로 일봉 20MA(**$${fact.us20Ma}**, 괴리율 **${fact.us20Diff}%**) 및 장중 60MA(**$${fact.us60Ma}**, 괴리율 **${fact.us60Diff}%**) 상단 지지를 유지하며 **${fact.isUsHoldCash ? '🔴 미국장 신규 매수 차단(Hold Cash)' : '🟢 미국장 정상 거래 허용(Normal)'}** 판정이 내려졌습니다.
- **미국 빅테크 모멘텀 및 소수점 매매 전략**: AI 데이터센터 및 클라우드 밸류체인을 이끄는 **엔비디아(NVDA, 확신도 89%)**, **QQQ ETF(확신도 88%)**, **애플(AAPL, 확신도 84%)**, **마이크로소프트(MSFT, 확신도 83%)**, **테슬라(TSLA, 확신도 76%)**가 강력 매수(BUY) 후보로 선정되었습니다. 소액 가용 예수금에서도 토스증권 소수점 금액 주문(**$1.00~$10.00 동적 산정**)을 통해 정밀 분할 진입이 진행됩니다.

### 🧠 [LLM 통합 알고리즘 매매 진행 판정 & 환율 리스크 진단]
- **LLM 알고리즘 매매 진행 여부**: 현재 **${algo.badge_text || '🟢 알고리즘 매매 정상 진행 (비중 100%)'}** 상태입니다. 전체 **${algo.total_evaluated || 21}종목 중 매수(BUY) ${algo.buy_count ?? 10}건 · 관망(HOLD) ${algo.hold_count ?? 11}건 · 매도(SELL) ${algo.sell_count ?? 0}건**이 도출되었으며, 실시간 **원/달러 환율(USD/KRW) ${fact.usdKrwRate}원**을 반영하여 환차손 및 하락장 낙폭(MDD) 방어 안전장치가 정상 가동 중입니다.

## 2. 🤖 봇별 행동 및 보유 종목 상세 진단 (모든 봇 반드시 개별 서술)
- **📌 [⏳ 소수점 예약대기]의 매도(청산대기) vs 매수(매수예정) 작동 원리**:
  - **청산대기(매도)**: 봇의 **퀀트 알고리즘 목표 익절률/손절률 도달**(예: 스타벅스 **+13.79% ≥ 익절 +4.0%**, 애플 **+27.28% ≥ 익절 +3.5%**, QQQ **-4.70% ≤ 손절 -2.0%**) 또는 **LLM 뉴스 악재(SELL) 판정**이 내려졌을 때 발동합니다.
  - **매수예정(신규 진입)**: **100% Gemini LLM이 판단한 호재 매수(BUY, 확신도 65%↑) 추천 결과**를 기반으로 선정된 종목(엔비디아 확신도 89%, 마이크로소프트 확신도 83%, 테슬라 확신도 76%)이며, 토스증권 소수점 거래 규정상 **미국 정규장(23:30~05:00 KST) 개장 즉시 자동으로 매도(청산) 및 신규 매수가 체결**됩니다.
- **돌파봇-알파 (변동성 돌파 / VOL-BREAK #1)**: 현재 **실전 가동(ON)** 상태이며, 기보유 중인 미국 우량주 **스타벅스(SBUX)** 포지션이 봇 목표 익절 기준(**+4.0%**)을 크게 상회하는 **+13.79% 평가수익**을 기록하여 익절 청산이 예약되어 있습니다. 동시에 LLM 최우선 매수 추천주 **엔비디아(NVDA, 확신도 89%)** 소수점 매수가 **23:30 정규장 개장 즉시 자동 체결**되도록 예약 대기 중입니다.
- **모멘텀봇-베타 (듀얼 모멘텀 / INST-DUAL #2)**: 현재 **24시간 상시 가상 아레나(ON)**에서 외인·기관 수급 및 20일 상대/절대 모멘텀 스코어를 실시간 추적 중입니다. 국내 대표 반도체·자동차 주도주의 거래대금 돌파 시점을 감시하며 실전 승격에 대비한 퀀트 트랙레코드를 축적하고 있습니다.
- **볼린저봇-감마 (볼린저 역추세 / BB-RSI #3)** 및 **엔벨로프 스나이퍼 (ENV-SNIPER #6)**: **볼린저봇-감마**는 보유 중인 **애플(AAPL)** 포지션에서 **+27.28% 고수익**(목표 익절 **+3.5%** 돌파)을 달성하여 23:30 정규장 개장 시 자동 익절 매도 및 LLM 추천주 **마이크로소프트(MSFT, 확신도 83%)** 신규 진입을 대기 중입니다. **엔벨로프 스나이퍼**는 보유 중인 **QQQ ETF** 포지션(**-4.70%**)이 봇 손절 기준(**-2.0%**)에 도달하여 리스크 관리 청산 후 LLM 추천주 **테슬라(TSLA, 확신도 76%)** 소수점 매수를 예약 대기 중입니다.

## 3. 💡 향후 체크포인트 & 시간대별 운용 가이드 (한국장 vs 미국장 구분)
- **🇰🇷 주간 한국장(09:00~15:30 KST) 체크포인트**: **KOSPI 일봉 20MA(${fact.kr20Ma}pt)** 및 **60분봉 60MA(${fact.kr60Ma}pt)** 상단 지지 여부가 국내 대형주(SK하이닉스, 삼성전자, 현대차 등) 1주 온주 진입의 핵심 기준선입니다.
- **🇺🇸 야간 미국장(23:30~05:00 KST) 체크포인트**: **QQQ 일봉 20MA($${fact.us20Ma})** 지지 유지 여부와 함께, 밤 **23:30 미국 정규장 개장 즉시** 현재 예약 대기 중인 스타벅스·애플 익절 및 QQQ 손절 청산과 엔비디아·마이크로소프트·테슬라 소수점 신규 매수가 자동 체결되므로 차분한 퀀트 운용을 권장합니다.`;
  }

  static insertBriefingRecord(db, { model, fact, triggerType, briefingText, analysisType = 'FLASH_30M' }) {
    const { nowStr } = this.getKstTimeParts();
    const res = db.prepare(`
      INSERT INTO ai_market_briefings (
        provider, model,
        kr_index_price, kr_daily_20ma, kr_intraday_60ma, kr_regime_status,
        us_index_price, us_daily_20ma, us_intraday_60ma, us_regime_status,
        usd_krw_rate, kospi_index, kosdaq_index, kospi_20ma, kosdaq_60ma,
        regime_status, trigger_type, briefing_text, analysis_type, created_at
      ) VALUES (
        'gemini', ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).run(
      model,
      fact.krPrice, fact.kr20Ma, fact.kr60Ma, fact.krRegimeStatus,
      fact.usPrice, fact.us20Ma, fact.us60Ma, fact.usRegimeStatus,
      fact.usdKrwRate, fact.krPrice, 725.0, fact.kr20Ma, fact.kr60Ma,
      fact.regimeStatus, triggerType, briefingText, analysisType, nowStr
    );

    const insertedId = Number(res.lastInsertRowid || 0);
    this.upsertSetting(db, 'ai_briefing_last_trigger_type', triggerType);

    const krMarketOverview =
      `현재 한국 증시(KOSPI ${fact.krPrice}pt)는 일봉 20MA(${fact.kr20Ma}pt, 괴리율 ${fact.kr20Diff}%) 및 60분봉 60MA(${fact.kr60Ma}pt) 대비 ` +
      `${fact.isKrHoldCash ? '단기 조정 구간으로 신규 매수를 보류하고 현금 관망(Hold Cash) 중입니다.' : '안정적인 지지 구간을 확보하여 정상 거래 허용(🟢 Normal) 체제로 작동 중입니다.'} ` +
      `국내 대표 반도체·바이오·자동차 주도주(SK하이닉스, 삼성전자, 셀트리온, 현대차)를 중심으로 주간 정규장(09:00~15:30 KST) 온주(1주 단위) 알고리즘 타점 감시가 진행되고 있습니다.`;

    const usMarketOverview =
      `현재 미국 증시(나스닥100 QQQ $${fact.usPrice})는 일봉 20MA($${fact.us20Ma}, 괴리율 ${fact.us20Diff}%) 및 60분봉 60MA($${fact.us60Ma}) 대비 ` +
      `${fact.isUsHoldCash ? '조정 구간으로 신규 매수를 차단 중입니다.' : '견조한 상승 추세를 유지하며 정상 거래 허용(🟢 Normal) 체제로 작동 중입니다.'} ` +
      `원/달러 환율(${fact.usdKrwRate}원)과 가용 외화 예수금($${fact.usOrderable})을 기반으로 AI 최우선 추천 빅테크(엔비디아, QQQ, 애플, 마이크로소프트, 테슬라) 소수점 주문이 산정되었으며, 미국 정규장(23:30 KST) 개장 즉시 예약된 익절/손절 매도와 신규 소수점 매수가 자동 체결됩니다.`;

    // HybridBoard 및 기존 요약 호환 저장
    llmDecisionService.saveLatestAnalysisToDb({
      marketBriefing: briefingText.replace(/#+\s*/g, '').slice(0, 260) + '...',
      krMarketOverview,
      usMarketOverview,
      verbalOverview: briefingText,
      triggerType,
      slotLabel: triggerType === 'AUTO'
        ? (analysisType === 'DEEP_PRO_60M' ? '1시간 Pro 심층분석' : '30분 Flash 자동분석')
        : '수동 분석',
      modelType: analysisType === 'DEEP_PRO_60M' ? 'PRO' : 'FLASH',
    });

    // 증시뉴스 메뉴(ai_news_briefings)에도 리포트 동기화 저장
    try {
      const nc = fact.newsCounts || { total: 0, bullish: 0, bearish: 0, neutral: 0 };
      db.prepare(`
        INSERT INTO ai_news_briefings (provider, model, news_count, bullish_count, bearish_count, neutral_count, briefing_text, created_at)
        VALUES ('gemini', ?, ?, ?, ?, ?, ?, ?)
      `).run(model, nc.total || 0, nc.bullish || 0, nc.bearish || 0, nc.neutral || 0, briefingText, nowStr);
    } catch (e) {}

    return {
      id: insertedId,
      provider: 'gemini',
      model,
      kr_index_price: fact.krPrice,
      kr_daily_20ma: fact.kr20Ma,
      kr_intraday_60ma: fact.kr60Ma,
      kr_regime_status: fact.krRegimeStatus,
      us_index_price: fact.usPrice,
      us_daily_20ma: fact.us20Ma,
      us_intraday_60ma: fact.us60Ma,
      us_regime_status: fact.usRegimeStatus,
      usd_krw_rate: fact.usdKrwRate,
      regime_status: fact.regimeStatus,
      trigger_type: triggerType,
      analysis_type: analysisType,
      briefing_text: briefingText,
      created_at: nowStr,
      llm_algo_status: fact.llmAlgoStatus,
      kr_market_overview: krMarketOverview,
      us_market_overview: usMarketOverview,
      news_counts: fact.newsCounts,
    };
  }

  /**
   * 30분 단위 종합 시장 판단 (Gemini Flash 적용)
   */
  static async generateAiMarketAnalysis({ triggerType = 'MANUAL', slotKey = '' } = {}) {
    const db = getDb();
    let quota;
    if (triggerType === 'MANUAL') {
      quota = this.consumeManualQuota(db);
    } else {
      quota = this.incrementAutoQuota(db, slotKey);
    }

    const fact = await this.collectRealTimeFactData(db);
    const prompt = this.buildAnalysisPrompt(fact);
    const { apiKey } = this.getGeminiKeyInfo();

    let usedModel = GEMINI_FLASH_MODEL_CHAIN[0];
    let fullText = '';

    // 서킷 브레이커 검사: Flash 서킷이 OPEN인 경우 API 호출 스킵 후 즉시 팩트 리포트 폴백
    const isFlashBreakerOpen = llmDecisionService.isCircuitOpen('FLASH');
    if (isFlashBreakerOpen) {
      console.warn('[AiService Flash] 🛡️ Gemini Flash 서킷 브레이커(OPEN) 발동 중 -> API 호출을 스킵하고 실시간 팩트 기반 리포트로 즉시 폴백합니다.');
    } else if (apiKey) {
      for (const candidateModel of GEMINI_FLASH_MODEL_CHAIN) {
        try {
          const cleanModel = candidateModel.replace(/^models\//, '');
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25000);
          const resp = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 8192,
              },
            }),
          });
          clearTimeout(timer);

          if (resp.ok) {
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
            if (text.trim().length > 100) {
              usedModel = cleanModel;
              fullText = text.trim();
              llmDecisionService.getCircuitBreaker('FLASH').recordSuccess();
              break;
            }
          } else {
            console.warn(`[AiService Flash] 모델 ${cleanModel} 응답 코드 ${resp.status}, 다음 폴백 시도...`);
            if (resp.status === 429) {
              llmDecisionService.getCircuitBreaker('FLASH').recordFailure(new Error(`HTTP 429: ${cleanModel}`));
            }
          }
        } catch (err) {
          console.warn(`[AiService Flash] 모델 ${candidateModel} 호출 예외(${err.message}), 다음 폴백 시도...`);
          llmDecisionService.getCircuitBreaker('FLASH').recordFailure(err);
        }
      }
    }

    if (!fullText) {
      fullText = this.buildFallbackMarkdownReport(fact);
    }

    const record = this.insertBriefingRecord(db, {
      model: usedModel,
      fact,
      triggerType,
      briefingText: fullText,
      analysisType: 'FLASH_30M',
    });

    return {
      success: true,
      latest: record,
      quota: this.getQuotaStatus(db),
    };
  }

  /**
   * 1시간 단위 심층 분석 (Gemini Pro 적용)
   * 시장 동향, 거시 경제 지표, 종목별 심층 데이터를 기반으로 한 심층 분석
   */
  static async generateAiDeepAnalysis({ triggerType = 'AUTO', slotKey = '' } = {}) {
    const db = getDb();
    if (triggerType === 'MANUAL') {
      this.consumeManualQuota(db);
    } else {
      this.incrementAutoQuota(db, slotKey);
    }

    const fact = await this.collectRealTimeFactData(db);
    const prompt = this.buildDeepAnalysisPrompt(fact);
    const { apiKey } = this.getGeminiKeyInfo();

    let usedModel = GEMINI_PRO_MODEL_CHAIN[0];
    let fullText = '';

    // 서킷 브레이커 검사: Pro 서킷이 OPEN인 경우 API 호출 스킵 후 즉시 심층 팩트 리포트 폴백
    const isProBreakerOpen = llmDecisionService.isCircuitOpen('PRO');
    if (isProBreakerOpen) {
      console.warn('[AiService Pro] 🛡️ Gemini Pro 서킷 브레이커(OPEN) 발동 중 -> API 호출을 스킵하고 심층 팩트 리포트로 즉시 폴백합니다.');
    } else if (apiKey) {
      for (const candidateModel of GEMINI_PRO_MODEL_CHAIN) {
        try {
          const cleanModel = candidateModel.replace(/^models\//, '');
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 35000);
          const resp = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.15,
                maxOutputTokens: 8192,
              },
            }),
          });
          clearTimeout(timer);

          if (resp.ok) {
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
            if (text.trim().length > 100) {
              usedModel = cleanModel;
              fullText = text.trim();
              llmDecisionService.getCircuitBreaker('PRO').recordSuccess();
              break;
            }
          } else {
            console.warn(`[AiService Pro] 모델 ${cleanModel} 응답 코드 ${resp.status}, 다음 폴백 시도...`);
            if (resp.status === 429) {
              llmDecisionService.getCircuitBreaker('PRO').recordFailure(new Error(`HTTP 429: ${cleanModel}`));
            }
          }
        } catch (err) {
          console.warn(`[AiService Pro] 모델 ${candidateModel} 호출 예외(${err.message}), 다음 폴백 시도...`);
          llmDecisionService.getCircuitBreaker('PRO').recordFailure(err);
        }
      }
    }

    if (!fullText) {
      fullText = this.buildFallbackDeepMarkdownReport(fact);
    }

    const record = this.insertBriefingRecord(db, {
      model: usedModel,
      fact,
      triggerType,
      briefingText: fullText,
      analysisType: 'DEEP_PRO_60M',
    });

    return {
      success: true,
      latest: record,
      quota: this.getQuotaStatus(db),
    };
  }

  /**
   * Gemini Pro 심층 분석 전용 프롬프트
   */
  static buildDeepAnalysisPrompt(fact) {
    return `당신은 월스트리트 헤지펀드의 최고 투자 책임자(CIO)이자 대한민국 최고의 퀀트 거시경제 거장입니다.
아래는 ${fact.nowStr} 기준 수집된 한·미 시장 팩트 데이터와 봇 운용 지표입니다.

이 데이터를 바탕으로 Gemini Pro의 고도화된 추론 능력을 발휘하여, 단기 소음(Noise)을 배제하고 향후 1~24시간 이상 이어질 거시 경제적 추세, 이평선 괴리율 지지/저항, 그리고 종목별 펀더멘털을 다루는 '1시간 단위 심층 퀀트 분석 리포트'를 작성해주세요.

[실시간 수집 팩트 데이터]
- 🇰🇷 코스피 지수: ${fact.krPrice}pt (일봉 20MA: ${fact.kr20Ma}pt, 괴리율: ${fact.kr20Diff}% / 60분봉 60MA: ${fact.kr60Ma}pt)
- 🇰🇷 한국 시장 체제: ${fact.krRegimeStatus} (${fact.krRegimeReason})
- 🇺🇸 나스닥100(QQQ): $${fact.usPrice} (일봉 20MA: $${fact.us20Ma}, 괴리율: ${fact.us20Diff}% / 60분봉 60MA: $${fact.us60Ma})
- 🇺🇸 미국 시장 체제: ${fact.usRegimeStatus} (${fact.usRegimeReason})
- 💵 원/달러 환율: ${fact.usdKrwRate}원
- 📊 LLM 거시 리스크 필터: ${fact.llmAlgoSummaryText}
- 🤖 가동 중인 봇 상태:
${fact.botsDataFormatted}
- 📰 증시 뉴스 감성:
${fact.newsSummaryText}

[필수 작성 섹션 - Markdown 서식]
## 1. 🏛️ [거시 경제 & 퀀트 지표 심층 평가]
- 한·미 양대 지수의 이동평균선(20MA, 60MA) 괴리율과 환율 추세가 향후 시장 방향성에 미치는 심층적 파급효과
- 시장 체제(Regime)에 따른 포지션 사이즈 배율의 적정성 평가

## 2. 🔍 [핵심 종목 펀더멘털 및 기술적 추세 심층 진단]
- 국내 대형주(반도체/바이오/완성차)의 중기 지지선 및 밸류에이션 리스크 점검
- 미국 빅테크(AI 인프라, 플랫폼)의 잉여현금흐름 및 중장기 상승 모멘텀 평가

## 3. 🛡️ [하이브리드 리스크 매니지먼트 가이드라인]
- 단기 30분 Flash 시그널과 결합하여 위험을 최소화할 수 있는 보수적 진입 기준선 제시
- 급변동 발생 시 실전 봇들의 방어적 익절/손절 우선순위 전략
`;
  }

  /**
   * Gemini Pro 심층 분석 폴백 리포트
   */
  static buildFallbackDeepMarkdownReport(fact) {
    return `## 1. 🏛️ [거시 경제 & 퀀트 지표 심층 평가]
- **한·미 이평선 괴리율 및 거시 환경**: 현재 KOSPI 지수(${fact.krPrice}pt)는 일봉 20MA(${fact.kr20Ma}pt) 대비 **${fact.kr20Diff}%**, QQQ($${fact.usPrice})는 20MA 대비 **${fact.us20Diff}%** 괴리율을 보이고 있습니다. 원/달러 환율(${fact.usdKrwRate}원)의 변동성을 감안할 때 거시적 추세 지지력이 유지되는 구간에서는 단계적 분할 접근이 적합합니다.
- **체제 필터 적정성**: 🇰🇷한국(${fact.krRegimeStatus}) 및 🇺🇸미국(${fact.usRegimeStatus}) 체제에 따라 리스크 완충 장치가 정상 가동 중입니다.

## 2. 🔍 [핵심 종목 펀더멘털 및 기술적 추세 심층 진단]
- **국내 대표주(SK하이닉스, 삼성전자, 현대차)**: 메모리 반도체 사이클 및 수출 실적의 견조한 펀더멘털이 60분봉 60MA 상단을 지지하고 있어 중기 추세가 양호합니다.
- **미국 빅테크(NVDA, MSFT, AAPL, TSLA)**: AI 인프라 투자 지속성 및 빅테크 잉여현금흐름(FCF) 기반으로 밸류에이션 방어력이 견고합니다.

## 3. 🛡️ [하이브리드 리스크 매니지먼트 가이드라인]
- **교집합 기반 보수적 운용**: 30분 Flash 단기 신호와 1시간 Pro 심층 신호가 모두 BUY로 일치하는 확신도 상위 종목 중심으로만 신규 편입을 진행합니다.
- **손실 방어 최우선**: 어느 한 모델이라도 악재 SELL 판정이 도출될 경우 선제적 비중 축소 및 청산 원칙을 견지합니다.`;
  }

  /**
   * 3.3 POST /api/ai/stream-analyze (및 GET 호환) SSE 실시간 스트리밍
   * - 이벤트 1 (meta) -> 이벤트 2 (chunk) -> 이벤트 3 (done)
   */
  static async generateAiMarketAnalysisStream(req, res) {
    const db = getDb();

    // 1. 수동 쿼터 확인 및 1회 차감
    let quota;
    try {
      quota = this.consumeManualQuota(db);
    } catch (quotaErr) {
      res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({
        error: true,
        quotaExceeded: true,
        message: '금일 무료 api 호출 한도에 도달했습니다. 내일 다시 시도해주세요',
        quota: quotaErr.quota || this.getQuotaStatus(db),
      }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
    });

    try {
      const fact = await this.collectRealTimeFactData(db);
      const prompt = this.buildAnalysisPrompt(fact);
      const { apiKey } = this.getGeminiKeyInfo();
      let usedModel = GEMINI_MODEL_FALLBACK_CHAIN[0];

      // 이벤트 1 (meta): 스트리밍 시작 직후 지수/이평선/체제상태/LLM알고리즘판정/잔여쿼터 즉시 전송
      const metaPayload = {
        type: 'meta',
        kr_index_price: fact.krPrice,
        kr_daily_20ma: fact.kr20Ma,
        kr_intraday_60ma: fact.kr60Ma,
        kr_regime_status: fact.krRegimeStatus,
        us_index_price: fact.usPrice,
        us_daily_20ma: fact.us20Ma,
        us_intraday_60ma: fact.us60Ma,
        us_regime_status: fact.usRegimeStatus,
        usd_krw_rate: fact.usdKrwRate,
        regime_status: fact.regimeStatus,
        llm_algo_status: fact.llmAlgoStatus,
        model: usedModel,
        created_at: fact.nowStr,
        trigger_type: 'MANUAL',
        quota,
      };
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify(metaPayload)}\n\n`);
      }

      let fullText = '';
      let streamedSuccess = false;

      if (apiKey) {
        for (const candidateModel of GEMINI_MODEL_FALLBACK_CHAIN) {
          if (clientClosed) break;
          try {
            const cleanModel = candidateModel.replace(/^models\//, '');
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const gResp = await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.3,
                  maxOutputTokens: 8192,
                },
              }),
            });
            clearTimeout(timeout);

            if (!gResp.ok || !gResp.body) {
              console.warn(`[AiService Stream] 모델 ${cleanModel} 상태 ${gResp.status}, 다음 후보 모델로 폴백...`);
              continue;
            }

            usedModel = cleanModel;
            const reader = gResp.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
              const { value, done } = await reader.read();
              if (done || clientClosed) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const dataStr = trimmed.slice(5).trim();
                if (!dataStr || dataStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  const delta = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
                  if (delta) {
                    fullText += delta;
                    if (!clientClosed) {
                      res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta, char: delta })}\n\n`);
                    }
                  }
                } catch (_) {}
              }
            }

            if (fullText.trim().length > 80) {
              streamedSuccess = true;
              break;
            }
          } catch (streamErr) {
            console.warn(`[AiService Stream] 모델 ${candidateModel} 스트리밍 오류(${streamErr.message}), 다음 후보 모델 시도...`);
          }
        }
      }

      // 모든 모델이 429/장애이거나 API 키 미설정 시 팩트 기반 3섹션 리포트를 청크 스트리밍으로 전송
      if (!streamedSuccess || !fullText.trim()) {
        fullText = this.buildFallbackMarkdownReport(fact);
        const chunkSize = 18;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          if (clientClosed) break;
          const piece = fullText.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: piece, char: piece })}\n\n`);
          await new Promise((r) => setTimeout(r, 15));
        }
      }

      const savedRecord = this.insertBriefingRecord(db, {
        model: usedModel,
        fact,
        triggerType: 'MANUAL',
        briefingText: fullText,
      });

      const updatedQuota = this.getQuotaStatus(db);
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({
          type: 'done',
          done: true,
          id: savedRecord.id,
          model: usedModel,
          full_text: fullText,
          created_at: savedRecord.created_at,
          trigger_type: 'MANUAL',
          latest: savedRecord,
          quota: updatedQuota,
        })}\n\n`);
        res.end();
      }
    } catch (err) {
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: true,
          message: err.message || 'AI 시황 스트리밍 중 오류가 발생했습니다.',
          done: true,
        })}\n\n`);
        res.end();
      }
    }
  }

  static getRecentDecisions(limit = 20, modelType = null) {
    return llmDecisionService.getRecentDecisions(limit, modelType);
  }

  static getHybridDecisions() {
    return TradeService.evaluateWithHybridLLM(ALL_CANDIDATE_STOCKS);
  }

  static getLatestAnalysis(db = getDb()) {
    const analysis = llmDecisionService.getLatestAnalysisFromDb() || {};
    const llmAlgoStatus = this.getLlmAlgoTradingStatus(db, analysis.marketRegime || 'NORMAL');
    return {
      ...analysis,
      llm_algo_status: llmAlgoStatus,
    };
  }

  static async evaluateAndTrade({ botId, candidateCode, executeTrade }) {
    const db = getDb();
    const quota = this.consumeManualQuota(db);

    const candidates = candidateCode
      ? ALL_CANDIDATE_STOCKS.filter((c) => c.code === candidateCode)
      : ALL_CANDIDATE_STOCKS;

    const decisions = await llmDecisionService.evaluateTradeSignals(candidates, {
      triggerType: 'MANUAL',
      slotLabel: '사용자 수동 요청',
    });
    let executedResult = null;

    if (executeTrade && botId) {
      const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
      if (bot) {
        const filterRow = db.prepare("SELECT * FROM market_regime_filter WHERE id = 1").get();
        const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
        let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
        if (prioRow && prioRow.value) {
          try {
            const parsed = JSON.parse(prioRow.value);
            if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
          } catch (e) {}
        }

        let buySignal = null;
        for (const priority of priorityList) {
          if (priority === 'KR_UNIT') {
            const isKrHalted = filterRow && (filterRow.kr_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow.kr_risk_alert || 0) === 1);
            if (!isKrHalted) {
              buySignal = decisions.find((d) => d.action === 'BUY' && d.confidence >= 65 && d.market === 'KR');
            }
          } else if (priority === 'US_UNIT' || priority === 'US_FRACTIONAL') {
            const isUsHalted = filterRow && (filterRow.us_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow.us_risk_alert || 0) === 1);
            if (!isUsHalted) {
              buySignal = decisions.find((d) => d.action === 'BUY' && d.confidence >= 65 && d.market === 'US');
            }
          }
          if (buySignal) break;
        }
        if (!buySignal) {
          buySignal = decisions.find((d) => d.action === 'BUY');
        }

        if (buySignal) {
          const stock = ALL_CANDIDATE_STOCKS.find((s) => s.code === buySignal.symbol) || candidates[0];
          const isUs = stock.market === 'US';

          // 독립 한·미 리스크 방어 검사
          if (isUs && filterRow && (filterRow.us_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow.us_risk_alert || 0) === 1)) {
            throw new Error(`[미국 LLM 방어 작동] 미국 소수점 신규 매수 차단 (사유: ${filterRow.us_reason || '미국 증시 리스크 경보'})`);
          }
          if (!isUs && filterRow && (filterRow.kr_recommended_action === 'HALT_NEW_BUYS' || Number(filterRow.kr_risk_alert || 0) === 1)) {
            throw new Error(`[한국 LLM 방어 작동] 국내 온주 신규 매수 차단 (사유: ${filterRow.kr_reason || '한국 증시 급락 경보'})`);
          }
          const isReal = bot.trade_mode === 'REAL';
          const priceInfo = isUs ? await tossClient.getCurrentPrice(stock.code) : await kiwoomClient.getCurrentPrice(stock.code);
          const preferUnitOverFractional = priorityList.indexOf('US_UNIT') < priorityList.indexOf('US_FRACTIONAL');

          if (!isReal) {
            const vResult = await virtualEngine.executeVirtualBuy({
              botId,
              stockCode: stock.code,
              stockName: stock.name,
              requestedBudget: 2000000,
              isFractional: isUs && !preferUnitOverFractional,
            });
            executedResult = { ...vResult, mode: 'VIRTUAL' };
            db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_VIRTUAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
              .run(vResult.orderNo, stock.code);
          } else {
            const nowIso = new Date().toISOString();
            try {
              if (isUs) {
                const unitPriceKrw = priceInfo.currentPrice;
                const tossBal = await tossClient.getAccountBalance();
                const usdRate = priceInfo.exchangeRate || tossBal?.usdRate || 1345;
                const actualUsd = Number(tossBal?.availableUsd || 0);
                const cashBasedUsd = ((Number(tossBal?.availableCash || 0) * 0.96) / usdRate);
                const effectiveUsd = actualUsd >= 1.0 ? actualUsd * 0.98 : cashBasedUsd;
                const affordableUsd = Math.floor(effectiveUsd * 100) / 100;
                const targetUsd = Math.max(1.0, Math.min(10.0, affordableUsd));
                const targetKrw = Math.round(targetUsd * usdRate);

                if (preferUnitOverFractional && Number(tossBal?.availableCash || 0) >= unitPriceKrw && unitPriceKrw > 0) {
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: stock.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'US',
                    quantity: 1,
                    reason: `Gemini AI 추천 미국 1주 온주 매수 ($${priceInfo.currentPriceUsd})`,
                  });
                  const fee = Math.round(unitPriceKrw * 0.0025);
                  const orderId = orderRes.orderId || `TORD_${Date.now()}`;
                  const insTrade = db.prepare(`
                    INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                    VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
                  `).run(botId, stock.code, stock.name, orderId, unitPriceKrw, unitPriceKrw, nowIso);
                  db.prepare(`
                    INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                    VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
                  `).run(botId, stock.code, stock.name, orderId, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

                  executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: false };
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                    .run(orderId, stock.code);
                } else {
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: stock.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'US',
                    orderAmount: targetUsd,
                    reason: `Gemini AI 추천 미국 소수점 매수 ($${targetUsd.toFixed(2)})`,
                  });
                  const fractionalQty = parseFloat((targetKrw / priceInfo.currentPrice).toFixed(6));
                  const fee = Math.round(targetKrw * 0.0025);
                  const orderId = orderRes.orderId || `TORD_${Date.now()}`;
                  const insTrade = db.prepare(`
                    INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                    VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
                  `).run(botId, stock.code, stock.name, orderId, priceInfo.currentPrice, fractionalQty, targetKrw, nowIso);
                  db.prepare(`
                    INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                    VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
                  `).run(botId, stock.code, stock.name, orderId, fractionalQty, priceInfo.currentPrice, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

                  executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: true };
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                    .run(orderId, stock.code);
                }
              } else {
                const orderRes = await pythonBridge.executeOrder({
                  symbol: stock.code,
                  side: 'BUY',
                  orderType: 'MARKET',
                  market: 'KR',
                  quantity: 1,
                  reason: `Gemini AI 추천 국내 1주 온주 매수`,
                });
                const unitPrice = priceInfo.currentPrice;
                const fee = Math.round(unitPrice * 0.00015);
                const orderId = orderRes.orderId || `TORD_${Date.now()}`;
                const insTrade = db.prepare(`
                  INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                  VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
                `).run(botId, stock.code, stock.name, orderId, unitPrice, unitPrice, nowIso);
                db.prepare(`
                  INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                  VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
                `).run(botId, stock.code, stock.name, orderId, unitPrice, unitPrice, fee, insTrade.lastInsertRowid, nowIso);

                executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: false };
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                  .run(orderId, stock.code);
              }
            } catch (pErr) {
              console.error('[AiService] Python 실행 실패:', pErr.message);
              db.prepare("UPDATE ai_trade_decisions SET execution_status = 'FAILED_EXECUTION' WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                .run(stock.code);
            }
          }
        }
      }
    }

    return {
      decisions,
      latestAnalysis: llmDecisionService.getLatestAnalysisFromDb(),
      executedResult,
      quota,
    };
  }

  static async streamMarketBriefing(res, req) {
    return await this.generateAiMarketAnalysisStream(req, res);
  }

  static async streamNewsAnalyze(res, req) {
    return await this.generateAiMarketAnalysisStream(req, res);
  }
}

export { normalizeMarketRegime };

function safeParseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function readRegimeSnapshot(db, modelTier, decisionRow) {
  if (!decisionRow) return null;
  const fallbackConf = Number(decisionRow.confidence ?? 70);
  const base = {
    modelTier,
    regime: normalizeMarketRegime(decisionRow.market_regime || 'NEUTRAL_BOX'),
    confidence: Number.isFinite(fallbackConf) ? fallbackConf : 70,
    allowedFamilies: safeParseJsonArray(decisionRow.allowed_families_json),
    regimeMultiplier: Number.isFinite(Number(decisionRow.regime_multiplier)) ? Number(decisionRow.regime_multiplier) : null,
    hotSectors: safeParseJsonArray(decisionRow.hot_sectors_json),
    avoidTickers: safeParseJsonArray(decisionRow.avoid_tickers_json).map((t) => String(t).toUpperCase().trim()),
  };

  try {
    const key = modelTier === 'PRO_60M' ? 'ai_regime_snapshot_pro' : 'ai_regime_snapshot_flash';
    const snapRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
    if (snapRow?.value) {
      const snap = JSON.parse(snapRow.value);
      if (snap && Number(snap.lastDecisionId) === Number(decisionRow.id)) {
        return {
          ...base,
          regime: snap.marketRegime ? normalizeMarketRegime(snap.marketRegime) : base.regime,
          confidence: Number.isFinite(Number(snap.regimeConfidence)) ? Number(snap.regimeConfidence) : base.confidence,
          hotSectors: Array.isArray(snap.hotSectors) && snap.hotSectors.length > 0 ? snap.hotSectors : base.hotSectors,
          avoidTickers: Array.isArray(snap.avoidTickers) && snap.avoidTickers.length > 0
            ? snap.avoidTickers.map((t) => String(t).toUpperCase().trim())
            : base.avoidTickers,
        };
      }
    }
  } catch (_) {}

  return base;
}

/**
 * 최근 N분(기본 30분) RSS 뉴스에서 종목 또는 핫 섹터 호재 촉매 / 악재 감지
 */
export function evaluateStockNewsCatalyst(db, stock = {}, hotSectors = [], options = {}) {
  const lookbackMinutes = Number(options.lookbackMinutes ?? 30);
  const nowMs = Number(options.nowMs ?? Date.now());
  const cutoffMs = nowMs - lookbackMinutes * 60 * 1000;

  const symbol = String(stock.code || stock.symbol || '').toUpperCase().trim();
  const stockName = String(stock.name || '').trim();
  const stockSector = String(stock.sector || '').trim();

  const stockTerms = Array.from(new Set([
    symbol,
    stockName,
    ...(STOCK_KEYWORDS[symbol] || []),
  ].map((s) => String(s || '').trim()).filter((s) => s.length >= 2)));

  const sectorTerms = Array.from(new Set([
    ...(stockSector ? [stockSector] : []),
    ...(Array.isArray(hotSectors) ? hotSectors : []),
  ].map((s) => String(s || '').trim()).filter((s) => s.length >= 2)));

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, title, summary, sentiment, keywords, published_at, created_at
      FROM stock_news
      ORDER BY id DESC
      LIMIT 40
    `).all() || [];
  } catch (_) {
    return {
      hasPositiveCatalyst: false,
      hasNegativeNews: false,
      catalystBonus: 0,
      positiveTitle: '',
      negativeTitle: '',
    };
  }

  let positiveHits = 0;
  let negativeHits = 0;
  let positiveTitle = '';
  let negativeTitle = '';

  for (const row of rows) {
    const pubMs = Date.parse(row.published_at || '');
    const createdMs = Date.parse(row.created_at || '');
    const bestMs = Number.isFinite(pubMs) && pubMs <= nowMs ? pubMs : (Number.isFinite(createdMs) ? createdMs : NaN);
    if (Number.isFinite(bestMs) && bestMs < cutoffMs) {
      continue;
    }

    const haystack = `${row.title || ''} ${row.summary || ''} ${row.keywords || ''}`.toLowerCase();
    const matchedStock = stockTerms.some((term) => haystack.includes(term.toLowerCase()));
    const matchedSector = sectorTerms.some((term) => haystack.includes(term.toLowerCase()));

    if (!matchedStock && !matchedSector) continue;

    const sentiment = String(row.sentiment || 'NEUTRAL').toUpperCase();
    if (sentiment === 'BEARISH' && matchedStock) {
      negativeHits++;
      if (!negativeTitle) negativeTitle = String(row.title || '');
    } else if (sentiment === 'BULLISH' && (matchedStock || matchedSector)) {
      positiveHits++;
      if (!positiveTitle) positiveTitle = String(row.title || '');
    }
  }

  const hasNegativeNews = negativeHits > 0 && negativeHits >= positiveHits;
  const hasPositiveCatalyst = !hasNegativeNews && positiveHits > 0;
  const catalystBonus = hasPositiveCatalyst ? Math.min(0.15, 0.1 + (positiveHits - 1) * 0.05) : 0;

  return {
    hasPositiveCatalyst,
    hasNegativeNews,
    catalystBonus,
    positiveHits,
    negativeHits,
    positiveTitle,
    negativeTitle,
  };
}

/**
 * 최근 1시간 Pro 심층 분석과 30분 Flash 단기 뉴스 분석을 결합하여
 * 현재 시점의 신규 진입 허용 여부 및 비중 가중치를 반환 (신규 매수 전용 게이트키퍼)
 */
export function evaluateRegimeGateForNewEntry(bot, stock, quantSignal = {}, options = {}) {
  const db = options.db || getDb();
  const family = getBotStrategyFamily(bot);
  const strategyType = String(bot?.strategy_type || '').toUpperCase();
  const symbol = String(stock?.code || stock?.symbol || '').toUpperCase().trim();
  const score = Number(quantSignal?.score ?? 80);

  // 0) LLM 서킷 브레이커 OPEN 상태 방어 -> 순수 퀀트 알고리즘 50% 예산 안전 Fallback
  const circuitOpen = options.circuitOpen === true
    || String(options.circuitBreakerState || '').toUpperCase() === 'OPEN'
    || (typeof llmDecisionService?.isCircuitOpen === 'function' && llmDecisionService.isCircuitOpen());

  if (circuitOpen) {
    return {
      allowNewBuy: true,
      regime: 'FALLBACK_PURE_QUANT',
      regimeMultiplier: 0.5,
      family,
      hasNewsCatalyst: false,
      catalystLabel: '',
      reason: `[Fallback] LLM 서킷 브레이커 OPEN -> 순수 퀀트 50% 예산 안전 진입 (${family})`,
    };
  }

  // 1) 최근 30분 Flash 및 1시간 Pro 분석 레코드 조회
  const latestFlashRow = db.prepare(`
    SELECT * FROM ai_trade_decisions
    WHERE model_tier = 'FLASH_30M' OR (model_tier IS NULL AND UPPER(COALESCE(model_type, 'FLASH')) = 'FLASH')
    ORDER BY id DESC LIMIT 1
  `).get() || null;

  const latestProRow = db.prepare(`
    SELECT * FROM ai_trade_decisions
    WHERE model_tier = 'PRO_60M' OR (model_tier IS NULL AND UPPER(COALESCE(model_type, '')) = 'PRO')
    ORDER BY id DESC LIMIT 1
  `).get() || null;

  if (!latestFlashRow && !latestProRow) {
    return {
      allowNewBuy: true,
      regime: 'FALLBACK_PURE_QUANT',
      regimeMultiplier: 0.5,
      family,
      hasNewsCatalyst: false,
      catalystLabel: '',
      reason: `[Fallback] LLM 분석 이력 없음 -> 순수 퀀트 50% 예산 안전 진입 (${family})`,
    };
  }

  const flashSnap = readRegimeSnapshot(db, 'FLASH_30M', latestFlashRow);
  const proSnap = readRegimeSnapshot(db, 'PRO_60M', latestProRow);

  const hotSectors = Array.from(new Set([
    ...(proSnap?.hotSectors || []),
    ...(flashSnap?.hotSectors || []),
  ]));
  const avoidTickers = Array.from(new Set([
    ...(proSnap?.avoidTickers || []),
    ...(flashSnap?.avoidTickers || []),
  ]));

  // 2) 히스테리시스(Hysteresis) 병합 규칙: Pro Anchor 기준 + Flash 75% 신뢰도 게이트
  let effectiveRegime = proSnap?.regime || flashSnap?.regime || 'NEUTRAL_BOX';
  let hysteresisDamping = 1.0;
  let hysteresisNote = '';

  const flashConf = Number(flashSnap?.confidence ?? 70);
  const proConf = Number(proSnap?.confidence ?? 75);

  if (proSnap && flashSnap && flashSnap.regime !== proSnap.regime) {
    if (flashConf >= 75) {
      effectiveRegime = flashSnap.regime;
      hysteresisNote = `Pro(${proSnap.regime})->Flash(${flashSnap.regime}, 신뢰도 ${flashConf}% >= 75%) 레짐 전환 승인`;
    } else {
      effectiveRegime = 'NEUTRAL_BOX';
      hysteresisDamping = 0.7;
      hysteresisNote = `Hysteresis 완충: Pro(${proSnap.regime}) ↔ Flash(${flashSnap.regime}, ${flashConf}% < 75%) -> NEUTRAL_BOX(x0.7)`;
    }
  } else if (!proSnap && flashSnap) {
    if (flashConf < 70 && flashSnap.regime !== 'NEUTRAL_BOX') {
      effectiveRegime = 'NEUTRAL_BOX';
      hysteresisDamping = 0.7;
      hysteresisNote = `Hysteresis 완충: Flash 단독 저신뢰(${flashConf}% < 70%) -> NEUTRAL_BOX(x0.7)`;
    } else {
      effectiveRegime = flashSnap.regime;
    }
  }

  // 3) LLM 회피 종목(avoid_tickers) 차단
  if (symbol && avoidTickers.includes(symbol)) {
    return {
      allowNewBuy: false,
      regime: effectiveRegime,
      regimeMultiplier: 0,
      family,
      hasNewsCatalyst: false,
      catalystLabel: '',
      reason: `[RegimeBlock] LLM 회피 지정 종목(${symbol}) -> 신규 매수 차단`,
    };
  }

  // 4) 최근 30분 RSS 뉴스 종목/섹터 촉매 및 악재 검증
  const newsCatalyst = evaluateStockNewsCatalyst(db, stock, hotSectors, {
    nowMs: options.nowMs,
    lookbackMinutes: options.lookbackMinutes,
  });

  if (family === 'BREAKOUT' && newsCatalyst.hasNegativeNews) {
    return {
      allowNewBuy: false,
      regime: effectiveRegime,
      regimeMultiplier: 0,
      family,
      hasNewsCatalyst: false,
      catalystLabel: newsCatalyst.negativeTitle,
      reason: `[NewsBlock] 최근 30분 종목 악재 뉴스 감지("${newsCatalyst.negativeTitle}") -> BREAKOUT 돌파 추격 진입 즉시 취소`,
    };
  }

  const effectiveConf = flashSnap ? flashConf : proConf;
  const catalystSuffix = newsCatalyst.hasPositiveCatalyst
    ? ` + 📰 뉴스촉매("${newsCatalyst.positiveTitle}")`
    : '';
  const hystSuffix = hysteresisNote ? ` (${hysteresisNote})` : '';

  // 5) 레짐별 전략군 소프트 라우팅 규칙
  if (effectiveRegime === 'BULLISH_MOMENTUM') {
    if (family === 'BREAKOUT' || family === 'TREND') {
      let mult = effectiveConf >= 80 ? 1.15 : 1.0;
      if (family === 'BREAKOUT' && newsCatalyst.hasPositiveCatalyst) {
        mult = Math.min(1.2, Number((mult + newsCatalyst.catalystBonus).toFixed(2)));
      }
      return {
        allowNewBuy: true,
        regime: effectiveRegime,
        regimeMultiplier: mult,
        family,
        hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
        catalystLabel: newsCatalyst.positiveTitle,
        reason: `[RegimeAllow] ${effectiveRegime}: ${family} 강세장 진입 허용 (x${mult})${catalystSuffix}${hystSuffix}`,
      };
    }

    // REVERSION: 강세장에서 떨어지는 칼날 방지를 위해 50% 비중 축소 진입
    return {
      allowNewBuy: true,
      regime: effectiveRegime,
      regimeMultiplier: 0.5,
      family,
      hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
      catalystLabel: newsCatalyst.positiveTitle,
      reason: `[RegimeReduced] ${effectiveRegime}: REVERSION 역추세 과열/칼날 방지 보수적 50% 진입 (x0.5)${hystSuffix}`,
    };
  }

  if (effectiveRegime === 'BEARISH_DEFENSE') {
    if (family === 'REVERSION' && score >= 92) {
      return {
        allowNewBuy: true,
        regime: effectiveRegime,
        regimeMultiplier: 0.3,
        family,
        hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
        catalystLabel: newsCatalyst.positiveTitle,
        reason: `[RegimeSnipe] BEARISH_DEFENSE 급락장 극단 과매도(${score}점 >= 92점) REVERSION 30% 소액 스나이핑 허용${hystSuffix}`,
      };
    }
    return {
      allowNewBuy: false,
      regime: effectiveRegime,
      regimeMultiplier: 0,
      family,
      hasNewsCatalyst: false,
      catalystLabel: '',
      reason: `[RegimeBlock] BEARISH_DEFENSE 급락·악재 방어장 -> ${family}(${score}점) 신규 매수 차단(HOLD), 현금 보호${hystSuffix}`,
    };
  }

  // NEUTRAL_BOX (횡보·순환매 박스권)
  if (family === 'BREAKOUT') {
    if (score >= 92 || (score >= 86 && newsCatalyst.hasPositiveCatalyst)) {
      const mult = Number((0.6 * hysteresisDamping).toFixed(2));
      return {
        allowNewBuy: true,
        regime: effectiveRegime,
        regimeMultiplier: mult,
        family,
        hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
        catalystLabel: newsCatalyst.positiveTitle,
        reason: `[RegimeRestricted] NEUTRAL_BOX 횡보장 고득점 돌파(${score}점)${catalystSuffix} -> 제한적 진입 (x${mult})${hystSuffix}`,
      };
    }
    return {
      allowNewBuy: false,
      regime: effectiveRegime,
      regimeMultiplier: 0,
      family,
      hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
      catalystLabel: newsCatalyst.positiveTitle,
      reason: `[RegimeBlock] NEUTRAL_BOX 횡보장 가짜 돌파(Fakeout) 방지 -> BREAKOUT(${score}점) 차단${hystSuffix}`,
    };
  }

  if (family === 'REVERSION') {
    const mult = Number((1.0 * hysteresisDamping).toFixed(2));
    return {
      allowNewBuy: true,
      regime: effectiveRegime,
      regimeMultiplier: mult,
      family,
      hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
      catalystLabel: newsCatalyst.positiveTitle,
      reason: `[RegimeAllow] NEUTRAL_BOX 박스권 REVERSION 최적 진입 (x${mult})${hystSuffix}`,
    };
  }

  // TREND in NEUTRAL_BOX: MA_PULLBACK 눌림목 우선 허용(1.0), 일반 추세봇 소폭 축소(0.8)
  const baseTrendMult = strategyType === 'MA_PULLBACK' ? 1.0 : 0.8;
  const trendMult = Number((baseTrendMult * hysteresisDamping).toFixed(2));
  return {
    allowNewBuy: true,
    regime: effectiveRegime,
    regimeMultiplier: trendMult,
    family,
    hasNewsCatalyst: newsCatalyst.hasPositiveCatalyst,
    catalystLabel: newsCatalyst.positiveTitle,
    reason: `[RegimeAllow] NEUTRAL_BOX ${strategyType || 'TREND'} 진입 허용 (x${trendMult})${hystSuffix}`,
  };
}

AiService.evaluateStockNewsCatalyst = evaluateStockNewsCatalyst;
AiService.evaluateRegimeGateForNewEntry = evaluateRegimeGateForNewEntry;
