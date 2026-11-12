import { getDb, runTransaction, safeNum } from '../db/index.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine, BotService } from './bot_service.mjs';
import { TradeService, pythonBridge } from './trade_service.mjs';
import { evaluatePureQuantAlgorithm } from '../common/quant_algorithms.mjs';
import { AiService, llmDecisionService } from './ai_service.mjs';
import { NotificationService } from '../common/notification_service.mjs';

export class SchedulerService {
  constructor() {
    this.timer = null;
    this.aiScheduleTimer = null;
    this.intervalMs = 7000;
    this.lastLlmAnalysisTime = 0;
    // 30분 Flash 주기 (매시 00분, 30분 KST)
    this.lastFlashSlotKey = '';
    this.isFlashAnalyzing = false;
    this.isFlashRunning = false; // 3.2 30분 루프 동시 실행 방어 락
    this.lastFlashFailureMs = 0;
    this.lastFlashFactCheck = null; // 스마트 캐싱용 팩트 스냅샷

    // 60분 Pro 심층 주기 (매시 00분 정각 KST)
    this.lastProSlotKey = '';
    this.isProAnalyzing = false;
    this.isProRunning = false; // 3.2 60분 루프 동시 실행 방어 락
    this.lastProFailureMs = 0;
    this.lastProFactCheck = null; // 스마트 캐싱용 팩트 스냅샷

    // 3.2 7초 트레이딩 주기 동시 실행 방어 락 및 타이머 보호
    this.isTickRunning = false;
    this.isRunningCycle = false;
    this.lastAutoSlotKey = '';
    this.isLlmAnalyzing = false;
    this.lastScheduledAiFailureMs = 0;
    this.cachedHybridDecisions = [];
  }

  start() {
    if (this.timer || this.aiScheduleTimer) return;
    console.log('[SchedulerService] 듀얼 트랙 스케줄러 시작 (7초 거래주기, ⚡30분 Gemini Flash 시황 & 🏛️60분 Gemini Pro 심층분석)');
    
    // 시작 시 즉시 30분 Flash 및 60분 Pro 최신 분석 상태 점검 및 실행
    this.checkAndRunScheduledLlmAnalysis().catch(() => {});
    
    // 7초 주기 자율 트레이딩 엔진
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
    
    // 10초 간격으로 30분 Flash / 60분 Pro 슬롯 도달 여부 체크
    this.aiScheduleTimer = setInterval(() => {
      this.checkAndRunScheduledLlmAnalysis().catch(() => {});
    }, 10000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.aiScheduleTimer) {
      clearInterval(this.aiScheduleTimer);
      this.aiScheduleTimer = null;
    }
    this.isTickRunning = false;
    this.isRunningCycle = false;
    this.isFlashRunning = false;
    this.isProRunning = false;
    console.log('[SchedulerService] 스케줄러 정지');
  }

  /**
   * [스마트 캐싱 및 호출 스킵 조건 검사 (Smart Caching)]
   * - 시장 지표(KOSPI / QQQ 지수) 변동률이 임계치(0.3%) 미만이고,
   * - 신규 수집된 뉴스 수가 3건 미만이며, 시장 체제(Regime)에 변화가 없다면
   * 불필요한 API 호출을 스킵하고 직전 LLM 판단 결과를 재사용(TTL 캐시 연장)
   */
  shouldSkipLLMCall({ modelType = 'FLASH', currentFact, newsCount = 0 }) {
    const lastCheck = modelType === 'PRO' ? this.lastProFactCheck : this.lastFlashFactCheck;
    if (!lastCheck || !lastCheck.timestamp) {
      return { shouldSkip: false, reason: 'INITIAL_SNAPSHOT_REQUIRED' };
    }

    // 1) 한국/미국 지수 가격 변동률 계산
    const krDiffPct = lastCheck.krPrice > 0
      ? Math.abs((currentFact.krPrice - lastCheck.krPrice) / lastCheck.krPrice) * 100
      : 0;
    const usDiffPct = lastCheck.usPrice > 0
      ? Math.abs((currentFact.usPrice - lastCheck.usPrice) / lastCheck.usPrice) * 100
      : 0;
    const maxIndexDiffPct = Math.max(krDiffPct, usDiffPct);

    // 2) 신규 뉴스 증가량
    const newNewsCount = Math.max(0, newsCount - (lastCheck.newsCount || 0));

    // 3) 체제(Regime) 상태 변경 여부
    const regimeChanged = currentFact.krRegimeStatus !== lastCheck.krRegimeStatus ||
                          currentFact.usRegimeStatus !== lastCheck.usRegimeStatus;

    // 4) 임계치: 지수 0.3% 이상 변동 OR 신규 뉴스 3건 이상 OR 시장 체제 변경
    const hasMeaningfulChange = maxIndexDiffPct >= 0.3 || newNewsCount >= 3 || regimeChanged;

    if (!hasMeaningfulChange) {
      return {
        shouldSkip: true,
        reason: `지수 변동폭(${maxIndexDiffPct.toFixed(2)}% < 0.3%) 및 신규 뉴스(${newNewsCount}건 < 3건) 미미 (체제유지: ${currentFact.krRegimeStatus})`,
        maxIndexDiffPct,
        newNewsCount,
      };
    }

    return {
      shouldSkip: false,
      reason: `유의미한 시장 변동 포착 (지수변동: ${maxIndexDiffPct.toFixed(2)}%, 신규뉴스: ${newNewsCount}건, 체제변경: ${regimeChanged})`,
      maxIndexDiffPct,
      newNewsCount,
    };
  }

  /**
   * 스마트 캐시 재사용 처리: 직전 ai_trade_decisions 결과를 복사하여 execution_status = 'CACHED'로 연장
   */
  async applyCachedDecisions({ modelType = 'FLASH', slotKey = '', slotLabel = '', skipReason = '' }) {
    const db = getDb();
    if (!db) return;
    const nowIso = new Date().toISOString();
    console.log(`[SchedulerService] ⚡ [${modelType} 스마트 캐시 재사용] ${skipReason} -> Gemini API 호출 스킵 및 직전 분석 연장 적용`);

    const latestRows = db.prepare(`
      SELECT * FROM ai_trade_decisions
      WHERE model_type = ?
        AND id IN (
          SELECT MAX(id) FROM ai_trade_decisions
          WHERE model_type = ?
          GROUP BY symbol
        )
    `).all(modelType, modelType);

    if (latestRows.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO ai_trade_decisions (
          symbol, stock_name, market, action, confidence, sentiment_score,
          reasoning, related_news, suggested_order_type, executed_by, execution_status, model_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CACHED', ?, ?)
      `);

      for (const row of latestRows) {
        stmt.run(
          row.symbol,
          row.stock_name,
          row.market,
          row.action,
          row.confidence,
          row.sentiment_score,
          row.reasoning,
          row.related_news,
          row.suggested_order_type,
          row.executed_by,
          modelType,
          nowIso
        );
      }
    }

    if (modelType === 'FLASH') {
      this.lastFlashSlotKey = slotKey;
      this.lastAutoSlotKey = slotKey;
      try {
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('ai_flash_last_auto_slot', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(slotKey, nowIso);
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('ai_briefing_last_auto_slot', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(slotKey, nowIso);
      } catch (e) {}
    } else {
      this.lastProSlotKey = slotKey;
      try {
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('ai_pro_last_auto_slot', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(slotKey, nowIso);
      } catch (e) {}
    }
  }

  /**
   * 30분 Flash 주기 및 60분 Pro 주기 슬롯 동시 점검 및 트리거
   */
  async checkAndRunScheduledLlmAnalysis() {
    const db = getDb();
    if (!db) return;

    const { flashSlotKey, flashSlotLabel, proSlotKey, proSlotLabel } = AiService.getKstTimeParts();

    // 1) 30분 Flash 자동 분석 점검 (실시간 속보 뉴스 및 단기 시그널 갱신)
    await this.checkAndRunScheduledFlashAnalysis(db, flashSlotKey, flashSlotLabel);

    // 2) 60분 Pro 심층 분석 점검 (거시 경제/지표 심층 퀀트 분석 갱신)
    await this.checkAndRunScheduledProAnalysis(db, proSlotKey, proSlotLabel);
  }

  async checkAndRunScheduledFlashAnalysis(db, flashSlotKey, flashSlotLabel) {
    if (this.isFlashAnalyzing) return;
    if (this.lastFlashFailureMs > 0 && Date.now() - this.lastFlashFailureMs < 180000) {
      return; // 3분 쿨다운
    }

    if (!this.lastFlashSlotKey) {
      try {
        const row = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_flash_last_auto_slot'").get()
          || db.prepare("SELECT value FROM system_settings WHERE key = 'ai_briefing_last_auto_slot'").get();
        if (row && row.value) {
          this.lastFlashSlotKey = row.value;
        }
      } catch (e) {}
    }

    if (this.lastFlashSlotKey !== flashSlotKey) {
      await this.refreshFlashDecisions({ triggerType: 'AUTO', slotKey: flashSlotKey, slotLabel: flashSlotLabel });
    }
  }

  async checkAndRunScheduledProAnalysis(db, proSlotKey, proSlotLabel) {
    if (this.isProAnalyzing) return;
    if (this.lastProFailureMs > 0 && Date.now() - this.lastProFailureMs < 300000) {
      return; // 5분 쿨다운
    }

    if (!this.lastProSlotKey) {
      try {
        const row = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_pro_last_auto_slot'").get();
        if (row && row.value) {
          this.lastProSlotKey = row.value;
        }
      } catch (e) {}
    }

    if (this.lastProSlotKey !== proSlotKey) {
      await this.refreshProAnalysis({ triggerType: 'AUTO', slotKey: proSlotKey, slotLabel: proSlotLabel });
    }
  }

  /**
   * [30분 단위 종합 시장 판단 - Gemini Flash 적용]
   * 네이버 금융/언론사 실시간 뉴스와 빠른 시황을 입력받아 30분 단위 단기 트렌드 시그널 출력
   * (스마트 캐싱: 지수 0.3% 미만 변동 및 신규 속보 3건 미만 시 API 호출 스킵 & 캐시 연장)
   */
  async refreshFlashDecisions({ triggerType = 'AUTO', slotKey = '', slotLabel = '' } = {}) {
    if (this.isFlashAnalyzing) return;
    this.isFlashAnalyzing = true;
    this.isLlmAnalyzing = true;
    try {
      const db = getDb();
      const currentFact = await AiService.collectRealTimeFactData(db);
      const newsCount = currentFact.newsCounts?.total || 0;

      // 스마트 캐싱 조건 검사 (AUTO 모드 시 변동량이 미미하면 호출 스킵)
      if (triggerType === 'AUTO') {
        const skipCheck = this.shouldSkipLLMCall({
          modelType: 'FLASH',
          currentFact,
          newsCount,
        });

        if (skipCheck.shouldSkip) {
          await this.applyCachedDecisions({
            modelType: 'FLASH',
            slotKey,
            slotLabel,
            skipReason: skipCheck.reason,
          });
          this.lastFlashFactCheck = {
            krPrice: currentFact.krPrice,
            usPrice: currentFact.usPrice,
            krRegimeStatus: currentFact.krRegimeStatus,
            usRegimeStatus: currentFact.usRegimeStatus,
            newsCount,
            timestamp: Date.now(),
          };
          return;
        }
      }

      console.log(`[SchedulerService] ⚡ [30분 Flash 자동판단 (${slotLabel || '정기'})] 실시간 속보 뉴스 및 단기 시그널 분석 시작...`);

      // 1) 30분 마켓 브리핑 생성 (Gemini Flash)
      await AiService.generateAiMarketAnalysis({
        triggerType,
        slotKey,
      });

      // 2) 후보 종목별 Flash 단기 시그널 갱신
      const decisions = await llmDecisionService.evaluateFlashSignals(ALL_CANDIDATE_STOCKS, {
        triggerType,
        slotLabel: `30분 Flash (${slotLabel})`,
      });

      this.lastLlmAnalysisTime = Date.now();
      this.lastFlashFailureMs = 0;
      this.lastFlashSlotKey = slotKey;
      this.lastAutoSlotKey = slotKey;
      this.lastFlashFactCheck = {
        krPrice: currentFact.krPrice,
        usPrice: currentFact.usPrice,
        krRegimeStatus: currentFact.krRegimeStatus,
        usRegimeStatus: currentFact.usRegimeStatus,
        newsCount,
        timestamp: Date.now(),
      };

      if (triggerType === 'AUTO' && slotKey && db) {
        const nowIso = new Date().toISOString();
        try {
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('ai_flash_last_auto_slot', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(slotKey, nowIso);
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('ai_briefing_last_auto_slot', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(slotKey, nowIso);
        } catch (e) {}
      }

      console.log(`[SchedulerService] ✅ [30분 Flash] Gemini Flash 실시간 시장 종합 판단 완료 (슬롯: ${slotKey})`);
    } catch (err) {
      this.lastFlashFailureMs = Date.now();
      console.warn('[SchedulerService] ⚠️ 30분 Flash 분석 갱신 오류 (재시도 대기):', err.message);
    } finally {
      this.isFlashAnalyzing = false;
      this.isLlmAnalyzing = false;
    }
  }

  /**
   * [1시간 단위 심층 분석 - Gemini Pro 적용]
   * 시장 동향, 거시 경제 지표, 종목별 심층 데이터를 기반으로 한 심층 분석 로직
   * (스마트 캐싱: 지수 0.3% 미만 변동 및 신규 속보 3건 미만 시 API 호출 스킵 & 캐시 연장)
   */
  async refreshProAnalysis({ triggerType = 'AUTO', slotKey = '', slotLabel = '' } = {}) {
    if (this.isProAnalyzing) return;
    this.isProAnalyzing = true;
    try {
      const db = getDb();
      const currentFact = await AiService.collectRealTimeFactData(db);
      const newsCount = currentFact.newsCounts?.total || 0;

      // 스마트 캐싱 조건 검사 (AUTO 모드 시 변동량이 미미하면 호출 스킵)
      if (triggerType === 'AUTO') {
        const skipCheck = this.shouldSkipLLMCall({
          modelType: 'PRO',
          currentFact,
          newsCount,
        });

        if (skipCheck.shouldSkip) {
          await this.applyCachedDecisions({
            modelType: 'PRO',
            slotKey,
            slotLabel,
            skipReason: skipCheck.reason,
          });
          this.lastProFactCheck = {
            krPrice: currentFact.krPrice,
            usPrice: currentFact.usPrice,
            krRegimeStatus: currentFact.krRegimeStatus,
            usRegimeStatus: currentFact.usRegimeStatus,
            newsCount,
            timestamp: Date.now(),
          };
          return;
        }
      }

      console.log(`[SchedulerService] 🏛️ [1시간 Pro 심층분석 (${slotLabel || '정기'})] 거시 경제 및 종목 심층 퀀트 분석 시작...`);

      // 1) 1시간 심층 마켓 리포트 생성 (Gemini Pro)
      await AiService.generateAiDeepAnalysis({
        triggerType,
        slotKey,
      });

      // 2) 후보 종목별 Pro 심층 시그널 갱신
      const decisions = await llmDecisionService.evaluateProDeepAnalysis(ALL_CANDIDATE_STOCKS, {
        triggerType,
        slotLabel: `1시간 Pro (${slotLabel})`,
      });

      this.lastProFailureMs = 0;
      this.lastProSlotKey = slotKey;
      this.lastProFactCheck = {
        krPrice: currentFact.krPrice,
        usPrice: currentFact.usPrice,
        krRegimeStatus: currentFact.krRegimeStatus,
        usRegimeStatus: currentFact.usRegimeStatus,
        newsCount,
        timestamp: Date.now(),
      };

      if (triggerType === 'AUTO' && slotKey && db) {
        const nowIso = new Date().toISOString();
        try {
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('ai_pro_last_auto_slot', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(slotKey, nowIso);
        } catch (e) {}
      }

      console.log(`[SchedulerService] ✅ [1시간 Pro] Gemini Pro 심층 퀀트 분석 완료 (슬롯: ${slotKey})`);
    } catch (err) {
      this.lastProFailureMs = Date.now();
      console.warn('[SchedulerService] ⚠️ 1시간 Pro 심층 분석 갱신 오류 (재시도 대기):', err.message);
    } finally {
      this.isProAnalyzing = false;
    }
  }

  /**
   * 하위 호환용 단일 리프레시 호출
   */
  async refreshLlmDecisions(params = {}) {
    await this.refreshFlashDecisions(params);
  }

  /**
   * 하이브리드(Flash + Pro) 크로스체크 종합 의사결정 목록 조회
   */
  getLatestHybridDecisions(db) {
    try {
      const hybrid = TradeService.evaluateWithHybridLLM(ALL_CANDIDATE_STOCKS, { db });
      if (Array.isArray(hybrid) && hybrid.length > 0) {
        this.cachedHybridDecisions = hybrid;
        return hybrid;
      }
    } catch (e) {
      console.warn('[SchedulerService] 하이브리드 의사결정 평가 오류:', e.message);
    }
    return this.cachedHybridDecisions || [];
  }

  getLatestLlmDecisions(db) {
    return this.getLatestHybridDecisions(db);
  }

  async runCycle() {
    if (this.isRunningCycle) return;
    this.isRunningCycle = true;
    try {
      const db = getDb();
      if (!db) return;

      // 1. 가상 경쟁 모드는 10개 봇 전체 상시 가동 강제 유지
      db.prepare(`UPDATE bots SET is_virtual_running = 1, is_running = 1 WHERE is_virtual_running != 1 OR is_running != 1`).run();

      const allBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
      if (allBots.length === 0) return;

      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      // 시세 캐시 맵 구축 (국내 및 해외)
      const candidateQuotes = [];
      const usCandidateStocks = ALL_CANDIDATE_STOCKS.filter((s) => s.market === 'US');
      if (usCandidateStocks.length > 0) {
        try {
          await tossClient.getMultiplePrices(usCandidateStocks.map((s) => s.code));
        } catch (e) {}
      }

      for (const stock of ALL_CANDIDATE_STOCKS) {
        try {
          const isUs = stock.market === 'US';
          const pInfo = isUs ? await tossClient.getCurrentPrice(stock.code) : await kiwoomClient.getCurrentPrice(stock.code);
          candidateQuotes.push({
            code: stock.code,
            symbol: stock.code,
            name: stock.name,
            market: stock.market,
            isFractional: !!stock.isFractional,
            current_price: pInfo.currentPrice,
            price: pInfo.currentPrice,
            change_pct: pInfo.changeRate || 0,
            open: pInfo.openPrice || (pInfo.currentPrice * (1 - (pInfo.changeRate || 0) / 100)),
            high: pInfo.highPrice || (pInfo.currentPrice * 1.01),
            low: pInfo.lowPrice || (pInfo.currentPrice * 0.99),
            askPrice1: pInfo.askPrice1 || pInfo.currentPrice,
            bidPrice1: pInfo.bidPrice1 || pInfo.currentPrice,
            currentPriceUsd: pInfo.currentPriceUsd,
            exchangeRate: pInfo.exchangeRate,
          });
        } catch (e) {}
      }

      // ===========================================================================
      // [TRACK A] 10대 퀀트 봇 상시 가상 경쟁 아레나 (Always-On | 순수 알고리즘 | LLM 미사용)
      // ===========================================================================
      for (const bot of allBots) {
        await this.runPureVirtualArenaCycle(db, bot, candidateQuotes);
      }

      // ===========================================================================
      // [TRACK B] 실전 거래 (사용자가 선택한 1~3개 봇 중 실전 가동 ON인 봇만 실행)
      // 다중 LLM(Flash 30분 + Pro 1시간) 하이브리드 교차검증 ⨉ Python Core Executor ⨉ 구매 우선순위 100% 연동
      // ===========================================================================
      // 30분 Flash 및 60분 Pro 도래 시 자동 AI 분석 실행
      this.checkAndRunScheduledLlmAnalysis().catch(() => {});

      // 30분 Flash + 1시간 Pro 최신 결과를 종합한 하이브리드 최종 의사결정 도출
      const latestHybridDecisions = this.getLatestHybridDecisions(db);

      const activeRealBots = allBots.filter(
        (b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1
      );

      if (activeRealBots.length > 0) {
        await this.runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo, latestHybridDecisions);
      }
    } catch (err) {
      console.error('[SchedulerService] Error in runCycle:', err);
    } finally {
      this.isRunningCycle = false;
    }
  }

  // ---------------------------------------------------------------------------
  // [TRACK A: 내부 실행 함수] 가상 아레나 순수 퀀트 봇 사이클
  // ---------------------------------------------------------------------------
  async runPureVirtualArenaCycle(db, bot, candidateQuotes) {
    try {
      const nowMs = Date.now();
      const nowIso = new Date().toISOString();

      // 2.1 system_settings의 virtual_fast_cycle_mode 확인
      // '0' (기본값): 정밀 전략 검증 모드 (무작위 진입/초단기 청산 비활성화, 순수 퀀트 수식 및 고유 익절/손절만 적용)
      // '1': 고속 순환/데모 모드 (Math.random < 0.65 탐색 진입 및 25초/75초 강제 청산 허용)
      const fastCycleSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_fast_cycle_mode'").get();
      const isFastCycleMode = fastCycleSetting?.value === '1' || fastCycleSetting?.value === 'true';

      // 1) 보유 가상 포지션 동적 청산 검사
      const vPositions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").all(bot.bot_id);

      for (const pos of vPositions) {
        const quote = candidateQuotes.find((c) => c.code === pos.stock_code);
        const curPrice = quote ? quote.current_price : pos.avg_buy_price;
        const returnPct = ((curPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100;
        const heldTimeMs = nowMs - new Date(pos.created_at).getTime();

        let shouldExit = false;
        let exitReason = '';

        if (returnPct <= -Math.abs(bot.stop_loss_pct)) {
          shouldExit = true;
          exitReason = `손절 기준 도달 (-${Math.abs(bot.stop_loss_pct)}% 설정, 현재 ${returnPct.toFixed(2)}%)`;
        } else if (returnPct >= Number(bot.take_profit_pct)) {
          shouldExit = true;
          exitReason = `익절 기준 도달 (+${bot.take_profit_pct}% 설정, 현재 +${returnPct.toFixed(2)}%)`;
        } else if (isFastCycleMode && heldTimeMs >= 25000 && (returnPct >= 0.5 || returnPct <= -1.0)) {
          shouldExit = true;
          exitReason = returnPct >= 0.5
            ? `가상 단기 목표 수익 달성 (+${returnPct.toFixed(2)}%)`
            : `가상 리스크 관리 조기 손절 (${returnPct.toFixed(2)}%)`;
        } else if (isFastCycleMode && heldTimeMs >= 75000) {
          shouldExit = true;
          exitReason = `가상 포지션 순환 리밸런싱 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
        }

        if (shouldExit) {
          await virtualEngine.executeVirtualSell({ positionId: pos.id, reason: exitReason });
        }
      }

      // 2) 신규 가상 포지션 진입 판정 (최대 3개 종목 분산 보유)
      const currentOpenCount = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").get(bot.bot_id).cnt;
      if (currentOpenCount >= 3) return;

      // 0.001초 로컬 DB LLM 거시 시장 체제 판정서 조회 (한국 KR과 미국 US 분리 평가)
      const filterRow = db.prepare("SELECT * FROM market_regime_filter WHERE id = 1").get();
      const krAction = filterRow?.kr_recommended_action || filterRow?.recommended_action || 'NORMAL';
      const krMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.kr_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
      const krHalt = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1;

      const usAction = filterRow?.us_recommended_action || filterRow?.recommended_action || 'NORMAL';
      const usMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.us_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
      const usHalt = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

      if (krHalt && usHalt) {
        return; // 양대 시장 모두 전면 차단 시 신규 가상 매수 스킵
      }

      let krBlacklist = [];
      let usBlacklist = [];
      try {
        krBlacklist = JSON.parse(filterRow?.kr_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
        usBlacklist = JSON.parse(filterRow?.us_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
      } catch (e) {}

      const heldCodes = db.prepare("SELECT stock_code FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").all(bot.bot_id).map((p) => p.stock_code);
      const pool = candidateQuotes.filter((c) => {
        if (heldCodes.includes(c.code)) return false;
        if (c.market === 'KR' && (krHalt || krBlacklist.includes(c.code))) return false;
        if (c.market === 'US' && (usHalt || usBlacklist.includes(c.code))) return false;
        return true;
      });
      if (pool.length === 0) return;

      let bestStock = null;
      let bestSignal = null;

      for (const stock of pool) {
        const sig = evaluatePureQuantAlgorithm(bot, stock);
        if (sig.shouldBuy && (!bestSignal || sig.score > bestSignal.score)) {
          bestStock = stock;
          bestSignal = sig;
        }
      }

      // 2.1 정밀 전략 검증 모드(fastCycle = 0)에서는 무작위 진입을 비활성화하고,
      // 오직 evaluatePureQuantAlgorithm(bot, stock)의 순수 퀀트 수식 시그널로만 매매
      if (isFastCycleMode && !bestStock && currentOpenCount === 0 && Math.random() < 0.65) {
        bestStock = pool[Math.floor(Math.random() * pool.length)];
        bestSignal = {
          shouldBuy: true,
          score: 75,
          reason: `[순수알고리즘] ${bot.nickname} 상시 시뮬레이션 탐색 진입`
        };
      }

      const virtualKrw = Number(bot.virtual_krw || 0);
      const stockMarket = bestStock?.market === 'US' ? 'US' : 'KR';
      const multiplier = stockMarket === 'US' ? (usMult > 0 ? usMult : 1.0) : (krMult > 0 ? krMult : 1.0);
      const investAmount = Math.floor(Math.min(virtualKrw, Math.floor(virtualKrw * 0.32)) * multiplier);

      if (bestStock && bestSignal && investAmount >= 10000) {
        await virtualEngine.executeVirtualBuy({
          botId: bot.bot_id,
          stockCode: bestStock.code,
          stockName: bestStock.name,
          requestedBudget: investAmount,
          isFractional: bestStock.isFractional,
        });

        db.prepare(`
          UPDATE bots
          SET virtual_status_msg = ?,
              last_status_msg = ?,
              updated_at = ?
          WHERE bot_id = ?
        `).run(
          `[⚡가상매수] ${bestStock.name} (이유: ${bestSignal.reason})`,
          `[⚡가상매수] ${bestStock.name} (순수 알고리즘 체결)`,
          nowIso,
          bot.bot_id
        );
      }
    } catch (vErr) {
      // Ignore individual bot virtual loop errors to prevent interrupting others
    }
  }

  // ---------------------------------------------------------------------------
  // 토스 실계좌 보유 주식(Holdings) ↔ 로컬 DB(bot_positions) 자동 동기화
  // ---------------------------------------------------------------------------
  syncRealHoldingsWithDb(db, activeRealBots, tossBal, nowIso) {
    if (!tossBal || tossBal.isMock || !Array.isArray(tossBal.holdings) || activeRealBots.length === 0) {
      return;
    }

    const openRealPositions = db.prepare("SELECT * FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'").all();
    const heldSymbolsInToss = new Set(tossBal.holdings.filter((h) => Number(h.qty) > 0).map((h) => h.stockCode));

    // 1) 토스 실계좌에서 이미 전량 매도되어 잔고가 0인 DB 포지션은 CLOSED 정리
    for (const pos of openRealPositions) {
      if (!heldSymbolsInToss.has(pos.stock_code)) {
        db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, pos.id);
      }
    }

    // 2) 토스 실계좌에 보유 중이나 DB(bot_positions)에 OPEN으로 등록되지 않은 종목을 실전 봇에 자동 매핑
    for (const holding of tossBal.holdings) {
      const qty = Number(holding.qty || 0);
      if (qty <= 0) continue;

      const existing = db.prepare("SELECT * FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN' AND stock_code = ?").get(holding.stockCode);
      if (existing) {
        // 수량 또는 평균단가 최신화
        const buyAmt = Math.max(1, Math.round(holding.avgBuyPrice * qty));
        db.prepare("UPDATE bot_positions SET qty = ?, avg_buy_price = ?, buy_amount = ? WHERE id = ?")
          .run(qty, holding.avgBuyPrice, buyAmt, existing.id);
        continue;
      }

      // 가장 보유 포지션 수가 적은 활성 실전 봇 선택
      const botCounts = activeRealBots.map((b) => {
        const cnt = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").get(b.bot_id).cnt;
        return { bot: b, cnt };
      }).sort((a, b) => a.cnt - b.cnt);

      const targetBot = botCounts[0].bot;
      const buyAmt = Math.max(1, Math.round(holding.avgBuyPrice * qty));
      const syncOrderNo = `TOSS_SYNC_${holding.stockCode}`;

      // 이미 동일 order_no가 CLOSED로 존재하는지 확인
      const oldSyncPos = db.prepare("SELECT * FROM bot_positions WHERE order_no = ?").get(syncOrderNo);
      if (oldSyncPos) {
        db.prepare(`
          UPDATE bot_positions
          SET bot_id = ?, qty = ?, avg_buy_price = ?, buy_amount = ?, status = 'OPEN', closed_at = NULL
          WHERE id = ?
        `).run(targetBot.bot_id, qty, holding.avgBuyPrice, buyAmt, oldSyncPos.id);
      } else {
        const insTrade = db.prepare(`
          INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
          VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
        `).run(targetBot.bot_id, holding.stockCode, holding.stockName, syncOrderNo, holding.avgBuyPrice, qty, buyAmt, nowIso);

        db.prepare(`
          INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
          VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, 0, ?, 'OPEN', ?)
        `).run(targetBot.bot_id, holding.stockCode, holding.stockName, syncOrderNo, qty, holding.avgBuyPrice, buyAmt, insTrade.lastInsertRowid, nowIso);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // [TRACK B: 내부 실행 함수] 실전 거래 사이클 (선택된 1~3개 실전봇 전용)
  // Gemini LLM 뉴스 감성 분석 ⨉ Python Core Executor ⨉ 구매 우선순위 100% 연동
  // ---------------------------------------------------------------------------
  async runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo, latestLlmDecisions = []) {
    const nowIso = new Date().toISOString();
    const tossBal = await tossClient.getAccountBalance();
    const usMarket = await tossClient.getUsMarketStatus();

    // 토스 실시간 주문가능 예수금의 90%를 총 실전 운영원금으로 동적 산출 및 봇 배분 실시간 동기화
    try {
      BotService.syncDynamicRealBudget(db, tossBal);
    } catch (bErr) {}

    // 0) 토스 실계좌 보유 포지션과 로컬 DB 동기화
    try {
      this.syncRealHoldingsWithDb(db, activeRealBots, tossBal, nowIso);
    } catch (syncErr) {
      console.warn('[SchedulerService] 실계좌 포지션 동기화 오류:', syncErr.message);
    }

    // 1.2 선택 해제된 봇의 미청산 실전 포지션이 고아 상태로 방치되지 않도록 활성 실전 봇으로 자동 승계 및 청산 감시 대상 유지
    try {
      const activeBotIds = activeRealBots.map((b) => b.bot_id);
      if (activeBotIds.length > 0) {
        const notInPlaceholders = activeBotIds.map(() => '?').join(', ');
        const orphanPositions = db.prepare(`
          SELECT * FROM bot_positions
          WHERE trade_mode = 'REAL' AND status = 'OPEN' AND bot_id NOT IN (${notInPlaceholders})
        `).all(...activeBotIds);

        if (orphanPositions.length > 0) {
          for (let i = 0; i < orphanPositions.length; i++) {
            const orphan = orphanPositions[i];
            const targetBot = activeRealBots[i % activeRealBots.length];
            db.prepare(`
              UPDATE bot_positions
              SET origin_bot_id = COALESCE(origin_bot_id, bot_id),
                  bot_id = ?
              WHERE id = ?
            `).run(targetBot.bot_id, orphan.id);
            if (orphan.trade_id) {
              db.prepare(`
                UPDATE trades
                SET origin_bot_id = COALESCE(origin_bot_id, bot_id),
                    bot_id = ?
                WHERE id = ?
              `).run(targetBot.bot_id, orphan.trade_id);
            }
          }
          console.log(`[SchedulerService] 🛡️ 미청산 고아 실전 포지션 ${orphanPositions.length}건을 활성 실전 봇으로 인계하여 청산 감시 유지`);
        }
      }
    } catch (orphanErr) {
      console.warn('[SchedulerService] 고아 포지션 인계 오류:', orphanErr.message);
    }

    const pendingBotSellMsgs = new Map();

    // 1) 실전 포지션 청산 검사 (손절/익절/15:15장마감 및 Gemini LLM 뉴스 악재 SELL 신호)
    for (const bot of activeRealBots) {
      const realPositions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").all(bot.bot_id);

      for (const pos of realPositions) {
        const quote = candidateQuotes.find((c) => c.code === pos.stock_code);
        const holdingItem = tossBal?.holdings?.find((h) => h.stockCode === pos.stock_code);
        const curPrice = holdingItem?.currentPrice || (quote ? quote.current_price : pos.avg_buy_price);
        const returnPct = holdingItem?.unrealizedProfitPct !== undefined
          ? Number(holdingItem.unrealizedProfitPct)
          : (pos.avg_buy_price > 0 ? ((curPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100 : 0);

        let shouldSell = false;
        let sellReason = '';

        if (returnPct <= -Math.abs(bot.stop_loss_pct)) {
          shouldSell = true;
          sellReason = `실전 손절 기준 도달 (-${Math.abs(bot.stop_loss_pct)}% 설정, 현재 ${returnPct.toFixed(2)}%)`;
        } else if (returnPct >= Number(bot.take_profit_pct)) {
          shouldSell = true;
          sellReason = `실전 익절 기준 도달 (+${bot.take_profit_pct}% 설정, 현재 +${returnPct.toFixed(2)}%)`;
        } else if (bot.strategy_type === 'VOLATILITY_BREAKOUT' && marketStatus?.kr?.phase === 'REGULAR') {
          const now = new Date();
          const nowMin = (now.getUTCHours() + 9) * 60 + now.getUTCMinutes();
          if (nowMin >= 15 * 60 + 15) {
            shouldSell = true;
            sellReason = '15:15 당일 장마감 동시호가 전 실전 시간청산 (오버나잇 배제)';
          }
        } else {
          // 다중 LLM(Flash+Pro) 하이브리드 교차검증 악재 SELL 신호 발생 시 긴급 청산
          const llmSignal = latestLlmDecisions.find((d) => d.symbol === pos.stock_code);
          if (llmSignal && llmSignal.action === 'SELL') {
            shouldSell = true;
            sellReason = `[🎙️ 하이브리드 LLM(${llmSignal.consensusType || 'SELL'}) 매도권고] ${llmSignal.reasoning || 'Flash 속보 악재 또는 Pro 거시 추세 이탈 감지로 인한 긴급 리스크 관리 매도'}`;
          }
        }

        if (shouldSell) {
          const isKr = /^[0-9]/.test(pos.stock_code);
          const isFractionalPos = !isKr && (Number(pos.qty) < 1 || (Number(pos.qty) % 1 !== 0));

          // 미국 소수점 수량 매도는 미국 정규장(종료 1시간 전까지)에만 토스 API 접수 가능
          if (isFractionalPos && !usMarket?.isFractionalOrderable) {
            const waitSellText = `청산대기: ${pos.stock_name} ${pos.qty}주 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
            pendingBotSellMsgs.set(bot.bot_id, waitSellText);
            continue;
          }

          // 국내 주식도 정규장 외 시간이면 대기
          const krPhase = marketStatus?.kr?.phase || marketStatus?.phase;
          if (isKr && krPhase !== 'REGULAR') {
            const waitSellText = `청산대기: ${pos.stock_name} ${pos.qty}주 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
            pendingBotSellMsgs.set(bot.bot_id, waitSellText);
            continue;
          }

          try {
            const posQty = Number(pos.qty || 0);
            const posBuyAmt = Number(pos.buy_amount || 0);
            const orderRes = await pythonBridge.executeOrder({
              symbol: pos.stock_code,
              side: 'SELL',
              orderType: 'MARKET',
              market: isKr ? 'KR' : 'US',
              quantity: posQty,
              price: 0,
              reason: sellReason,
            });

            const executionPrice = curPrice;
            const sellAmount = Math.round(executionPrice * posQty);
            const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + Number(pos.buy_fee || 0);
            const profitKrw = (sellAmount - posBuyAmt) - feeAndTax;
            const profitPct = posBuyAmt > 0 ? parseFloat(((profitKrw / posBuyAmt) * 100).toFixed(2)) : 0;

            runTransaction(() => {
              db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, pos.id);
              if (pos.trade_id) {
                db.prepare(`
                  UPDATE trades
                  SET sell_order_no = ?,
                      sell_price = ?,
                      sell_qty = ?,
                      sell_amount = ?,
                      sell_date = ?,
                      fee_and_tax = ?,
                      profit_krw = ?,
                      profit_pct = ?,
                      status = 'CLOSED'
                  WHERE id = ?
                `).run(
                  orderRes.orderId || `TORD_S_${Date.now()}`,
                  executionPrice,
                  posQty,
                  sellAmount,
                  nowIso,
                  feeAndTax,
                  profitKrw,
                  profitPct,
                  pos.trade_id
                );
              }
            });

            // 4.3 실전 매도 체결 알림 발송
            NotificationService.notifyRealTrade({
              botName: bot.name,
              botNickname: bot.nickname,
              side: 'SELL',
              stockName: pos.stock_name,
              stockCode: pos.stock_code,
              price: executionPrice,
              qty: posQty,
              amount: sellAmount,
              profitKrw,
              profitPct,
              reason: sellReason,
              orderId: orderRes.orderId,
            });

            db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
              `[🐍 Python 실전매도] ${pos.stock_name} ${posQty}주 @ ${executionPrice.toLocaleString()}원 (${profitPct >= 0 ? '+' : ''}${profitPct}%, 이유: ${sellReason})`,
              `[🐍 Python 실전매도] ${pos.stock_name} 매도 완료`,
              nowIso,
              bot.bot_id
            );

            // AI 의사결정 상태도 EXECUTED_REAL_SELL로 갱신
            try {
              db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL_SELL' WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)").run(pos.stock_code);
            } catch (e) {}
          } catch (err) {
            console.error('[SchedulerService] Python 실전 매도 에러:', err.message);
            const errMsg = String(err.message || '');
            // 장외 시간(422 outside-regular-hours) 또는 일시적 호출 제한(429)은 실제 보유 중인 주식이므로 닫지 않고 유지
            if (errMsg.includes('outside-regular-hours') || errMsg.includes('422') || errMsg.includes('429')) {
              const waitSellText = `청산대기: ${pos.stock_name} (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
              pendingBotSellMsgs.set(bot.bot_id, waitSellText);
            } else if (errMsg.includes('잔고') || errMsg.includes('보유') || errMsg.includes('404')) {
              console.warn(`[SchedulerService] 실전 미보유 포지션(${pos.stock_name}, 사유: ${errMsg}) 자동 닫힘 처리`);
              db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, pos.id);
            }
          }
        }
      }
    }

    // 1. DB에서 최신 LLM 시장 체제 판정서 조회 (한국 KR과 미국 US 분리 평가)
    const filterRow = db.prepare("SELECT * FROM market_regime_filter WHERE id = 1").get();

    // 1.3 🇰🇷 한국 시장 체제 판정 및 매매 지침 (KOSPI 20MA / KOSDAQ 60MA 체제는 국내 주식에만 적용)
    const krAction = filterRow?.kr_recommended_action || filterRow?.recommended_action || 'NORMAL';
    const krMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.kr_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
    const krHalt = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1 || regimeInfo?.isKrHalt || regimeInfo?.regime === 'HOLD_CASH';

    // 1.3 🇺🇸 미국 시장 체제 판정 및 매매 지침 (국내 지수 이동평균선에 의해 차단되지 않고 미국 장세로 독립 분리)
    const usAction = filterRow?.us_recommended_action || filterRow?.recommended_action || 'NORMAL';
    const usMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.us_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
    const usHalt = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

    // 만약 양대 시장 모두 전면 매수 차단(HALT) 상태라면 전체 신규 매수 스킵
    if (krHalt && usHalt) {
      console.log(`[LLM 방어 작동] 한·미 양대 시장 신규 매수 전면 차단 (🇰🇷KR: ${krAction}, 🇺🇸US: ${usAction})`);
      return;
    }

    let krBlacklist = [];
    let usBlacklist = [];
    try {
      krBlacklist = JSON.parse(filterRow?.kr_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
      usBlacklist = JSON.parse(filterRow?.us_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
    } catch (e) {}

    // 2) 실전 신규 매수 진입 판정 (Gemini LLM 추천 종목 ⨉ 국가별 독립 체제 필터 ⨉ 사용자 구매 우선순위 엔진)
    // - 서킷 브레이커 차단(OPEN) 또는 Fallback 모드 시: 실전 봇의 evaluatePureQuantAlgorithm() 순수 퀀트 점수로 매매 판단 & 50% 예산 축소
    // - 정상 시: Gemini LLM Flash 30분 + Pro 1시간 하이브리드 교차검증 추천 종목 & 정상 배정 예산 집행
    const isCircuitBlocked = Boolean(
      latestLlmDecisions?.isCircuitOpen ||
      latestLlmDecisions?.isFallback ||
      llmDecisionService.isCircuitOpen('FLASH') ||
      llmDecisionService.isCircuitOpen('PRO')
    );

    const normalBuySignals = !isCircuitBlocked
      ? latestLlmDecisions
          .filter((d) => {
            if (d.action !== 'BUY' || (d.confidence || 0) < 65) return false;
            if (d.market === 'KR' && (krHalt || krBlacklist.includes(d.symbol))) return false;
            if (d.market === 'US' && (usHalt || usBlacklist.includes(d.symbol))) return false;
            return true;
          })
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.sentimentScore || 0) - (a.sentimentScore || 0))
      : [];

    if (!isCircuitBlocked && normalBuySignals.length === 0) {
      return;
    }

    const defaultUsdRate = usMarket?.exchangeRate || (await tossClient.getExchangeRate()) || 1345;
    const minFractionalKrw = await tossClient.getMinFractionalOrderBudgetKrw(); // 1.1: 토스 실시간 USD/KRW 연동 소수점 최소 주문($10) 원화 기준
    const reservedSymbolsInCycle = new Set();

    for (const bot of activeRealBots) {
      const botPositions = db.prepare("SELECT stock_code, trade_mode FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").all(bot.bot_id);
      const openCount = botPositions.length;
      if (openCount >= 3) continue;

      // 1.1: 봇당 최대 3개 종목 제한에서 국내(KR)와 미국(US) 포지션 슬롯 분리 (주간 국내장에서 슬롯 전량 소진 방어)
      const krHeldCount = botPositions.filter((p) => p.stock_code && p.stock_code.length === 6 && /^\d+$/.test(p.stock_code)).length;
      const usHeldCount = botPositions.filter((p) => !(p.stock_code && p.stock_code.length === 6 && /^\d+$/.test(p.stock_code))).length;
      const MAX_KR_SLOTS = 2;
      const MAX_US_SLOTS = 2;

      const isBotFallback = isCircuitBlocked;
      const budgetMultiplier = isBotFallback ? 0.5 : 1.0;

      let candidateBuySignals = [];
      if (isBotFallback) {
        // [서킷 브레이커 차단 Fallback] 실전 담당 봇의 evaluatePureQuantAlgorithm() 순수 퀀트 시그널만으로 ACTION 분기
        const pureSignals = TradeService.evaluatePureQuantFallback({
          bot,
          candidateQuotes,
          budgetMultiplier,
        });

        candidateBuySignals = pureSignals
          .filter((s) => {
            if (s.action !== 'BUY') return false;
            if (s.market === 'KR' && (krHalt || krBlacklist.includes(s.symbol))) return false;
            if (s.market === 'US' && (usHalt || usBlacklist.includes(s.symbol))) return false;
            return true;
          })
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      } else {
        candidateBuySignals = normalBuySignals;
      }

      if (candidateBuySignals.length === 0) continue;

      const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
      let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
      if (prioRow && prioRow.value) {
        try {
          const parsed = JSON.parse(prioRow.value);
          if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
        } catch (e) {}
      }

      try {
        const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
        const realTotalBudget = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;
        const botCap = bot.real_allocated_capital || Math.floor(realTotalBudget * ((bot.real_allocation_ratio || 33.3) / 100));

        // 기보유 동기화분(TOSS_SYNC_)은 이미 현금 예수금(availableCash) 외의 주식이므로 신규 매수 예산 차감에서 제외
        const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)").get(bot.bot_id);
        const usedCap = usedCapRow ? usedCapRow.used : 0;

        // 현재 실전 계좌(전체 봇)가 이미 보유 중인 종목 제외 (중복 종목 편입 방지)
        const heldCodes = db.prepare("SELECT stock_code FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'").all().map((p) => p.stock_code);
        const allAvailableSignals = candidateBuySignals.filter((s) => !heldCodes.includes(s.symbol));
        const unreservedSignals = allAvailableSignals.filter((s) => !reservedSymbolsInCycle.has(s.symbol));
        const availableBuySignals = unreservedSignals.length > 0 ? unreservedSignals : allAvailableSignals;
        if (availableBuySignals.length === 0) continue;

        let realExecuted = false;
        for (const priority of priorityList) {
          if (realExecuted) break;

          if (priority === 'KR_UNIT') {
            // 1순위: 🇰🇷 한국 주식 1주 온주 매수 (한국 LLM 판단 로직 및 krMult / budgetMultiplier 배율 적용)
            if (krHalt || krHeldCount >= MAX_KR_SLOTS) continue; // 한국 시장 리스크 경보/차단 또는 KR 슬롯 한도 도달 시 폴백

            const krScaledBotCap = Math.floor(botCap * (krMult > 0 ? krMult : 1.0) * budgetMultiplier);
            const krRemainingCap = Math.max(0, krScaledBotCap - usedCap);
            const availableKrCash = Math.min(tossBal?.availableCash || 0, krRemainingCap);
            if (availableKrCash <= 0) continue; // 예산 부족 시 다음 우선순위(미국 주식/소수점)로 폴백

            const candidateSignal = availableBuySignals.find((s) => s.market === 'KR');
            if (!candidateSignal) continue;

            const priceInfo = await kiwoomClient.getCurrentPrice(candidateSignal.symbol);
            const unitPrice = priceInfo.currentPrice;

            if (availableKrCash >= unitPrice && unitPrice > 0) {
              reservedSymbolsInCycle.add(candidateSignal.symbol);
              if (marketStatus?.phase !== 'REGULAR') {
                const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
                const fallbackPrefix = isBotFallback ? '🛡️순수퀀트 Fallback(50%) | ' : '';
                const waitMsg = `[⏳ 국내장 개장대기] ${sellPrefix}${fallbackPrefix}매수예정: ${candidateSignal.name} 1주 (${unitPrice.toLocaleString()}원, 🇰🇷KR배율: ${Math.round(krMult * budgetMultiplier * 100)}%) — 정규장(09:00) 자동 집행`;
                if (bot.real_status_msg !== waitMsg) {
                  db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
                    .run(waitMsg, waitMsg, nowIso, bot.bot_id);
                }
                continue;
              }

              const execReason = isBotFallback
                ? `[${bot.nickname}] 🛡️순수퀀트 Fallback 매수(예산 50%): ${candidateSignal.reasoning || candidateSignal.name + ' 기술적 지표 돌파'}`
                : `[${bot.nickname}] Gemini AI 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 매수'}`;
              
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidateSignal.symbol,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'KR',
                quantity: 1,
                reason: execReason,
              });

              if (!orderRes || orderRes.success === false) {
                throw new Error(orderRes?.message || '한국 주식 실전 매수 주문 실행 실패');
              }

              const fee = Math.round(unitPrice * 0.00015);
              const botLogPrefix = isBotFallback ? '[🐍 Python 실전매수(순수퀀트 Fallback 50%)]' : '[🐍 Python 실전매수]';

              // 3.2 & 3.3 트랜잭션 보호 및 원장 정합성 보장
              runTransaction(() => {
                const insTrade = db.prepare(`
                  INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                  VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
                `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, unitPrice, unitPrice, nowIso);

                db.prepare(`
                  INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                  VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
                `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPrice, unitPrice, fee, insTrade.lastInsertRowid, nowIso);

                db.prepare(`
                  UPDATE bots 
                  SET real_available_krw = MAX(0, real_available_krw - ?),
                      real_status_msg = ?, 
                      last_status_msg = ?, 
                      updated_at = ? 
                  WHERE bot_id = ?
                `).run(
                  unitPrice + fee,
                  `${botLogPrefix} ${candidateSignal.name} (${unitPrice.toLocaleString()}원, 점수 ${candidateSignal.confidence}%)`,
                  `${botLogPrefix} 매수: ${candidateSignal.name}`,
                  nowIso,
                  bot.bot_id
                );

                try {
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                    .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
                } catch (e) {}
              });

              // 4.3 실시간 텔레그램/디스코드 웹훅 알림
              NotificationService.notifyRealTrade({
                botName: bot.nickname,
                market: 'KR',
                symbol: candidateSignal.symbol,
                name: candidateSignal.name,
                action: 'BUY',
                qty: 1,
                price: unitPrice,
                totalAmount: unitPrice,
                reason: execReason,
              });

              if (tossBal) {
                tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - unitPrice - fee);
              }
              realExecuted = true;
            }
          } else if (priority === 'US_UNIT') {
            // 2순위: 🇺🇸 미국 주식 1주 온주 매수 (미국 LLM 판단 로직 및 usMult / budgetMultiplier 배율 적용)
            if (usHalt || usHeldCount >= MAX_US_SLOTS) continue; // 미국 시장 리스크 경보/차단 또는 US 슬롯 한도 도달 시 폴백

            const usScaledBotCap = Math.max(minFractionalKrw, Math.floor(botCap * (usMult > 0 ? usMult : 1.0) * budgetMultiplier));
            const usRemainingCap = Math.max(0, usScaledBotCap - usedCap);
            const accountPurchasingPowerKrw = Number(tossBal?.availableCash || 0) + (Number(tossBal?.availableUsd || 0) * defaultUsdRate);
            const availableUsCash = Math.min(accountPurchasingPowerKrw, usRemainingCap);
            if (availableUsCash <= 0) continue; // 가용 예산 부족 시 미국 소수점($10)으로 폴백

            const candidateSignal = availableBuySignals.find((s) => s.market === 'US');
            if (!candidateSignal) continue;

            const priceInfo = await tossClient.getCurrentPrice(candidateSignal.symbol);
            const unitPriceKrw = priceInfo.currentPrice;
            const unitPriceUsd = priceInfo.currentPriceUsd;

            if (availableUsCash >= unitPriceKrw && unitPriceKrw > 0) {
              reservedSymbolsInCycle.add(candidateSignal.symbol);
              if (!usMarket?.isOpen) {
                const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
                const fallbackPrefix = isBotFallback ? '🛡️순수퀀트 Fallback(50%) | ' : '';
                const waitMsg = `[⏳ 미국장 개장대기] ${sellPrefix}${fallbackPrefix}매수예정: ${candidateSignal.name} 1주 ($${unitPriceUsd}, 🇺🇸US배율: ${Math.round(usMult * budgetMultiplier * 100)}%) — 미국장 개장 즉시 자동 집행`;
                if (bot.real_status_msg !== waitMsg) {
                  db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
                    .run(waitMsg, waitMsg, nowIso, bot.bot_id);
                }
                continue;
              }

              const execReason = isBotFallback
                ? `[${bot.nickname}] 🛡️순수퀀트 Fallback 미국 1주 매수(예산 50%): ${candidateSignal.reasoning || candidateSignal.name + ' 기술적 지표 돌파'}`
                : `[${bot.nickname}] Gemini AI 미국 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 미국 1주 온주 매수'}`;
              
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidateSignal.symbol,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'US',
                quantity: 1,
                reason: execReason,
              });

              if (!orderRes || orderRes.success === false) {
                throw new Error(orderRes?.message || '미국 1주 온주 실전 매수 주문 실행 실패');
              }

              const fee = Math.round(unitPriceKrw * 0.0025);
              const botLogPrefix = isBotFallback ? '[🐍 Python 실전매수(순수퀀트 Fallback 50%)]' : '[🐍 Python 실전매수]';

              // 3.2 & 3.3 트랜잭션 보호 및 원장 정합성 보장
              runTransaction(() => {
                const insTrade = db.prepare(`
                  INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                  VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
                `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, unitPriceKrw, unitPriceKrw, nowIso);

                db.prepare(`
                  INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                  VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
                `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

                db.prepare(`
                  UPDATE bots 
                  SET real_available_krw = MAX(0, real_available_krw - ?),
                      real_status_msg = ?, 
                      last_status_msg = ?, 
                      updated_at = ? 
                  WHERE bot_id = ?
                `).run(
                  unitPriceKrw + fee,
                  `${botLogPrefix} 미국 1주: ${candidateSignal.name} ($${unitPriceUsd}, 점수 ${candidateSignal.confidence}%)`,
                  `${botLogPrefix} 1주 매수: ${candidateSignal.name}`,
                  nowIso,
                  bot.bot_id
                );

                try {
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                    .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
                } catch (e) {}
              });

              // 4.3 실시간 텔레그램/디스코드 웹훅 알림
              NotificationService.notifyRealTrade({
                botName: bot.nickname,
                market: 'US',
                symbol: candidateSignal.symbol,
                name: candidateSignal.name,
                action: 'BUY',
                qty: 1,
                price: unitPriceKrw,
                totalAmount: unitPriceKrw,
                reason: execReason,
              });

              if (tossBal) {
                tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - unitPriceKrw - fee);
              }
              realExecuted = true;
            }
          } else if (priority === 'US_FRACTIONAL') {
            // 3순위: 🇺🇸 미국 주식 소수점 금액 구매 (미국 LLM 판단 로직 및 $10 소수점 단위 동적 폴백)
            if (usHalt || usHeldCount >= MAX_US_SLOTS) continue; // 미국 시장 리스크 경보/차단 또는 US 슬롯 한도 도달 시 스킵

            const candidateSignal = availableBuySignals.find((s) => s.market === 'US');
            if (!candidateSignal) continue;

            const priceInfo = await tossClient.getCurrentPrice(candidateSignal.symbol);
            const usdRate = priceInfo.exchangeRate || defaultUsdRate || 1345;

            // 1.1: 토스증권 소수점 최소 주문 단위인 $10 상당 원화 금액만 충족하면 동적 구매 집행
            const targetUsd = 10.0;
            const targetKrw = Math.round(targetUsd * usdRate);

            const usScaledBotCap = Math.max(minFractionalKrw, Math.floor(botCap * (usMult > 0 ? usMult : 1.0) * budgetMultiplier));
            const usRemainingCap = Math.max(0, usScaledBotCap - usedCap);

            // 계좌 전체 구매력: 원화 예수금 + 달러 예수금 (원화 자동 환전 주문 지원)
            const actualUsd = tossBal?.availableUsd !== undefined ? Number(tossBal.availableUsd) : 0;
            const actualKrw = tossBal?.availableCash !== undefined ? Number(tossBal.availableCash) : 0;
            const accountTotalPurchasingPowerKrw = actualKrw + (actualUsd * usdRate);

            if (accountTotalPurchasingPowerKrw < targetKrw || (usRemainingCap < targetKrw && botCap < targetKrw)) {
              // 계좌 잔고 부족 시에만 알림 갱신 후 루프 계속 진행
              continue;
            }

            reservedSymbolsInCycle.add(candidateSignal.symbol);

            // 토스증권 소수점 금액 주문은 미국 정규장(개장 ~ 종료 1시간 전, 23:30~05:00 KST)에만 접수 가능
            if (!usMarket?.isFractionalOrderable) {
              const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
              const fallbackPrefix = isBotFallback ? '🛡️순수퀀트 Fallback(50%) | ' : '';
              const waitMsg = `[⏳ 소수점 예약대기] ${sellPrefix}${fallbackPrefix}매수예정: ${candidateSignal.name} $${targetUsd.toFixed(2)} (약 ${targetKrw.toLocaleString()}원, 점수 ${candidateSignal.confidence}%) — 미국 정규장(${usMarket?.nextFractionalTime || '23:30'}) 개장 즉시 자동 체결`;
              if (bot.real_status_msg !== waitMsg) {
                db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                  waitMsg,
                  `[⏳ 소수점 예약대기] ${candidateSignal.name} $${targetUsd.toFixed(2)} (${usMarket?.nextFractionalTime || '23:30'} 개장 시 자동 주문)`,
                  nowIso,
                  bot.bot_id
                );
              }
              realExecuted = true;
              continue;
            }

            const execReason = isBotFallback
              ? `[${bot.nickname}] 🛡️순수퀀트 Fallback 소수점 매수(예산 50%): ${candidateSignal.reasoning || candidateSignal.name + ' 기술적 지표 돌파'}`
              : `[${bot.nickname}] Gemini AI 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 소수점 매수'}`;
            
            const orderRes = await pythonBridge.executeOrder({
              symbol: candidateSignal.symbol,
              side: 'BUY',
              orderType: 'MARKET',
              market: 'US',
              orderAmount: targetUsd,
              reason: execReason,
            });

            if (!orderRes || orderRes.success === false) {
              throw new Error(orderRes?.message || '미국 소수점 실전 매수 주문 실행 실패');
            }

            const fractionalQty = parseFloat((targetKrw / priceInfo.currentPrice).toFixed(6));
            const fee = Math.round(targetKrw * 0.0025);
            const botLogPrefix = isBotFallback ? '[🐍 Python 실전매수(순수퀀트 Fallback 50%)]' : '[🐍 Python 실전매수]';

            // 3.2 & 3.3 트랜잭션 보호 및 원장 정합성 보장
            runTransaction(() => {
              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, priceInfo.currentPrice, fractionalQty, targetKrw, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, fractionalQty, priceInfo.currentPrice, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare(`
                UPDATE bots 
                SET real_available_krw = MAX(0, real_available_krw - ?),
                    real_status_msg = ?, 
                    last_status_msg = ?, 
                    updated_at = ? 
                WHERE bot_id = ?
              `).run(
                targetKrw + fee,
                `${botLogPrefix} 미국 소수점: ${candidateSignal.name} $${targetUsd.toFixed(2)} (${fractionalQty}주, 점수 ${candidateSignal.confidence}%)`,
                `${botLogPrefix} 소수점 매수: ${candidateSignal.name} ($${targetUsd.toFixed(2)})`,
                nowIso,
                bot.bot_id
              );

              try {
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
                  .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
              } catch (e) {}
            });

            // 4.3 실시간 텔레그램/디스코드 웹훅 알림
            NotificationService.notifyRealTrade({
              botName: bot.nickname,
              market: 'US',
              symbol: candidateSignal.symbol,
              name: candidateSignal.name,
              action: 'BUY',
              qty: fractionalQty,
              price: priceInfo.currentPrice,
              totalAmount: targetKrw,
              reason: execReason,
            });

            if (tossBal) {
              if (tossBal.availableUsd !== undefined && Number(tossBal.availableUsd) >= targetUsd) {
                tossBal.availableUsd = Math.max(0, parseFloat((Number(tossBal.availableUsd || 0) - targetUsd).toFixed(2)));
              } else {
                tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - targetKrw - fee);
              }
            }
            realExecuted = true;
          }
        }
      } catch (rErr) {
        console.error('[SchedulerService] Python 실전 매수 에러:', rErr.message);
        const errMsg = String(rErr?.message || '');
        if (errMsg.includes('insufficient-buying-power') || errMsg.includes('주문가능 달러')) {
          const failMsg = `[⚠️ 달러부족 실패] 토스증권 주문가능 달러 부족 — 토스 앱에서 달러(USD) 환전 필요`;
          try {
            db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
              .run(failMsg, failMsg, nowIso, bot.bot_id);
          } catch (e) {}
        }
      }
    }
  }
}

export const schedulerService = new SchedulerService();
