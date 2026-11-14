import { getDb, runTransaction, safeNum } from '../db/index.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import {
  virtualEngine,
  BotService,
  rotateWeeklyTopBotsByFamily,
  syncActiveRealBotsAvailableKrw,
} from './bot_service.mjs';
import { TradeService, pythonBridge } from './trade_service.mjs';
import { evaluatePureQuantAlgorithm, evaluatePureQuantExit, calculateDynamicPositionSize } from '../common/quant_algorithms.mjs';
import { enrichStockWithIndicators } from '../common/indicator_calculator.mjs';
import { AiService, llmDecisionService, evaluateRegimeGateForNewEntry } from './ai_service.mjs';
import { NotificationService } from '../common/notification_service.mjs';

function withDbTransaction(db, fn) {
  if (db && typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  return runTransaction(fn);
}
import { AssetSnapshotService } from './asset_snapshot_service.mjs';

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
    this.lastCandidateQuotes = [];
    this.isWeeklyRotating = false;
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

    const fallbackTier = modelType === 'PRO' ? 'PRO_60M' : 'FLASH_30M';
    if (latestRows.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO ai_trade_decisions (
          symbol, stock_name, market, action, confidence, sentiment_score,
          reasoning, related_news, suggested_order_type, executed_by, execution_status,
          model_type, model_tier, market_regime, allowed_families_json, regime_multiplier,
          hot_sectors_json, avoid_tickers_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CACHED', ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let lastInsertedId = null;
      for (const row of latestRows) {
        const res = stmt.run(
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
          row.model_tier || fallbackTier,
          row.market_regime || 'NEUTRAL_BOX',
          row.allowed_families_json || '["BREAKOUT","TREND","REVERSION"]',
          row.regime_multiplier ?? 1.0,
          row.hot_sectors_json || '[]',
          row.avoid_tickers_json || '[]',
          nowIso
        );
        if (res?.lastInsertRowid) lastInsertedId = Number(res.lastInsertRowid);
      }

      if (lastInsertedId) {
        const snapKey = modelType === 'PRO' ? 'ai_regime_snapshot_pro' : 'ai_regime_snapshot_flash';
        try {
          const snapRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(snapKey);
          if (snapRow?.value) {
            const snap = JSON.parse(snapRow.value);
            snap.lastDecisionId = lastInsertedId;
            snap.updatedAt = nowIso;
            db.prepare(`
              INSERT INTO system_settings (key, value, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).run(snapKey, JSON.stringify(snap), nowIso);
          }
        } catch (_) {}
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
    if (this.isRunningCycle || this.isTickRunning) return;
    this.isRunningCycle = true;
    this.isTickRunning = true;
    try {
      const db = getDb();
      if (!db) return;

      // 1. 가상 경쟁 모드는 11개 봇 전체 상시 가동 강제 유지
      db.prepare(`UPDATE bots SET is_virtual_running = 1, is_running = 1 WHERE is_virtual_running != 1 OR is_running != 1`).run();

      const allBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
      if (allBots.length === 0) return;

      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      // 시세 캐시 맵 구축 (국내 및 해외)
      const rawCandidateQuotes = [];
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
          rawCandidateQuotes.push({
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
            candles: pInfo.candles || [],
          });
        } catch (e) {}
      }

      // 시계열 기술적 지표 계산 모듈을 통해 보조지표(SMA/EMA, RSI, BB, MACD, ATR, ADX 등) 일괄 주입
      const candidateQuotes = rawCandidateQuotes.map((q) => enrichStockWithIndicators(q, q.candles || []));
      this.lastCandidateQuotes = candidateQuotes;

      // ===========================================================================
      // [TRACK A] 11대 퀀트 봇 상시 가상 경쟁 아레나 (Always-On | 순수 알고리즘 | LLM 미사용)
      // ===========================================================================
      for (const bot of allBots) {
        await this.runPureVirtualArenaCycle(db, bot, candidateQuotes);
      }

      // 매주 월요일 08:30 KST 자동 전략군별 주간 1위 로테이션 체크 및 무중단 교체
      let currentAllBots = allBots;
      if (!this.isWeeklyRotating) {
        this.isWeeklyRotating = true;
        try {
          const rotCheck = await checkAndRunWeeklyAutoRotation(candidateQuotes, (rotRes) => {
            const summaryLines = (rotRes.winners || [])
              .map((w) => `• [${w.strategy_family}] ${w.nickname || w.name}: 주간 ${w.weekly_return_pct >= 0 ? '+' : ''}${w.weekly_return_pct}% (비중 ${w.ratio}%)`)
              .join('\n');
            NotificationService.broadcast(
              `<b>🏆 [autoStockTrader] 매주 월요일 08:30 전략군별 주간 1위 자동 로테이션 완료</b>\n` +
              `${summaryLines}\n` +
              `🛡️ 탈락 봇 미청산 포지션: ${rotRes.stickinessCount || 0}건 끝까지 책임 청산 감시`
            ).catch(() => {});
          }, { db });
          if (rotCheck?.executed) {
            currentAllBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
          }
        } catch (rotErr) {
          console.warn('[SchedulerService] 주간 자동 로테이션 체크 오류:', rotErr.message);
        } finally {
          this.isWeeklyRotating = false;
        }
      }

      // ===========================================================================
      // [TRACK B] 실전 거래 (사용자가 선택한 1~3개 봇 중 실전 가동 ON인 봇만 실행)
      // 다중 LLM(Flash 30분 + Pro 1시간) 하이브리드 교차검증 ⨉ Python Core Executor ⨉ 구매 우선순위 100% 연동
      // ===========================================================================
      // 30분 Flash 및 60분 Pro 도래 시 자동 AI 분석 실행
      this.checkAndRunScheduledLlmAnalysis().catch(() => {});

      // 30분 Flash + 1시간 Pro 최신 결과를 종합한 하이브리드 최종 의사결정 도출
      const latestHybridDecisions = this.getLatestHybridDecisions(db);

      const activeRealBots = currentAllBots.filter(
        (b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1
      );
      const hasOpenRealPos = db.prepare(
        "SELECT 1 FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN' LIMIT 1"
      ).get();

      if (activeRealBots.length > 0 || hasOpenRealPos) {
        await this.runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo, latestHybridDecisions, currentAllBots);
      }

      // 월별 자산 평가 스냅샷 자동 갱신 (5분 주기)
      const nowTs = Date.now();
      if (!this.lastAssetSnapshotMs || nowTs - this.lastAssetSnapshotMs > 5 * 60 * 1000) {
        this.lastAssetSnapshotMs = nowTs;
        AssetSnapshotService.recordOrUpdateCurrentSnapshot().catch(() => {});
      }
    } catch (err) {
      console.error('[SchedulerService] Error in runCycle:', err);
    } finally {
      this.isRunningCycle = false;
      this.isTickRunning = false;
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

      // 1) 보유 가상 포지션 동적 청산 검사 (전략별 기술적 청산 + 트레일링 스탑 + 고정 익손절)
      const vPositions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").all(bot.bot_id);

      for (const pos of vPositions) {
        const quote = candidateQuotes.find((c) => c.code === pos.stock_code);

        // 정통 퀀트 청산 및 트레일링 스탑 통합 판정
        const exitEval = evaluatePureQuantExit(bot, pos, quote, { fastCycleEnabled: isFastCycleMode });

        // 최고가 및 트레일링 스탑 활성화 상태 DB 갱신
        if (exitEval.highestPrice > (pos.highest_price || 0) || (exitEval.trailingActive ? 1 : 0) !== (pos.trailing_active || 0)) {
          db.prepare("UPDATE bot_positions SET highest_price = ?, trailing_active = ? WHERE id = ?")
            .run(exitEval.highestPrice, exitEval.trailingActive ? 1 : 0, pos.id);
        }

        if (exitEval.shouldExit) {
          await virtualEngine.executeVirtualSell({ positionId: pos.id, reason: exitEval.exitReason });
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

      if (bestStock && bestSignal) {
        const virtualKrw = Number(bot.virtual_krw || 0);
        const stockMarket = bestStock?.market === 'US' ? 'US' : 'KR';
        const multiplier = stockMarket === 'US' ? (usMult > 0 ? usMult : 1.0) : (krMult > 0 ? krMult : 1.0);
        
        // 정통 변동성(ATR) 댐퍼 및 알고리즘 점수 가중치(15%~40%) 동적 포지션 사이징
        const baseInvest = calculateDynamicPositionSize(bot, virtualKrw, bestSignal.score, bestStock.atrPct);
        const investAmount = Math.floor(Math.min(virtualKrw, baseInvest) * multiplier);

        if (investAmount >= 10000) {
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
      }
    } catch (vErr) {
      // Ignore individual bot virtual loop errors to prevent interrupting others
    }
  }

  // ---------------------------------------------------------------------------
  // 토스 실계좌 보유 주식(Holdings) ↔ 로컬 DB(bot_positions) 자동 동기화
  // ---------------------------------------------------------------------------
  syncRealHoldingsWithDb(db, activeRealBots, tossBal, nowIso, allBots = null) {
    if (!tossBal || tossBal.isMock || !Array.isArray(tossBal.holdings)) {
      return;
    }

    const openRealPositions = db.prepare("SELECT * FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'").all();
    const heldSymbolsInToss = new Set(tossBal.holdings.filter((h) => Number(h.qty) > 0).map((h) => h.stockCode));

    // 1) 토스 실계좌에서 이미 전량 매도되어 잔고가 0인 DB 포지션은 CLOSED 정리
    let closedGhostRealPos = false;
    for (const pos of openRealPositions) {
      if (!heldSymbolsInToss.has(pos.stock_code)) {
        closedGhostRealPos = true;
        db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, pos.id);
        const ownerRow = db.prepare('SELECT is_real_selected FROM bots WHERE bot_id = ?').get(pos.bot_id);
        if (ownerRow && Number(ownerRow.is_real_selected) === 0) {
          const remRow = db.prepare(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(buy_amount), 0) AS amt FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'"
          ).get(pos.bot_id);
          if (!remRow || Number(remRow.cnt) === 0) {
            db.prepare(
              "UPDATE bots SET real_allocated_capital = 0, real_available_krw = 0, real_status_msg = '가상 아레나 전용 (실전 미선택)', updated_at = ? WHERE bot_id = ?"
            ).run(nowIso, pos.bot_id);
          } else {
            db.prepare(
              "UPDATE bots SET real_allocated_capital = ?, real_status_msg = '청산 대기 중 (보유 포지션 자동 관리)', updated_at = ? WHERE bot_id = ?"
            ).run(Math.round(Number(remRow.amt || 0)), nowIso, pos.bot_id);
          }
        }
      }
    }
    if (closedGhostRealPos) {
      try {
        syncActiveRealBotsAvailableKrw(db, tossBal);
      } catch (_) {}
    }

    const assignmentPool = activeRealBots.length > 0
      ? activeRealBots
      : (allBots || db.prepare('SELECT * FROM bots WHERE is_real_selected = 1 ORDER BY bot_id ASC').all());
    if (assignmentPool.length === 0) {
      return;
    }

    // 2) 토스 실계좌에 보유 중이나 DB(bot_positions)에 OPEN으로 등록되지 않은 종목을 실전 봇에 자동 매핑
    for (const holding of tossBal.holdings) {
      const qty = Number(holding.qty || 0);
      if (qty <= 0) continue;

      const existing = db.prepare("SELECT * FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN' AND stock_code = ?").get(holding.stockCode);
      if (existing) {
        // 기존 포지션 소유 봇(pos.bot_id)은 Position Stickiness 원칙에 따라 절대 변경하지 않고 수량/단가만 최신화
        const buyAmt = Math.max(1, Math.round(holding.avgBuyPrice * qty));
        db.prepare("UPDATE bot_positions SET qty = ?, avg_buy_price = ?, buy_amount = ? WHERE id = ?")
          .run(qty, holding.avgBuyPrice, buyAmt, existing.id);
        continue;
      }

      // 가장 보유 포지션 수가 적은 활성 실전 봇 선택
      const botCounts = assignmentPool.map((b) => {
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
  // [TRACK B: 내부 실행 함수] 실전 거래 사이클 (Soft Regime Routing + Position Stickiness)
  // ---------------------------------------------------------------------------
  async runRealTradingCycle(
    db,
    activeRealBots,
    candidateQuotes,
    marketStatus,
    regimeInfo,
    latestLlmDecisions = [],
    allBots = null
  ) {
    const nowIso = new Date().toISOString();
    const tossBal = await tossClient.getAccountBalance();
    const usMarket = await tossClient.getUsMarketStatus();
    const resolvedAllBots = Array.isArray(allBots) && allBots.length > 0
      ? allBots
      : db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();

    // 토스 실시간 주문가능 예수금의 90%를 총 실전 운영원금으로 동적 산출 및 봇 배분 실시간 동기화
    try {
      BotService.syncDynamicRealBudget(db, tossBal);
    } catch (bErr) {}

    // 0) 토스 실계좌 보유 포지션과 로컬 DB 동기화 (소유 봇 bot_id는 절대 변경하지 않음)
    try {
      this.syncRealHoldingsWithDb(db, activeRealBots, tossBal, nowIso, resolvedAllBots);
    } catch (syncErr) {
      console.warn('[SchedulerService] 실계좌 포지션 동기화 오류:', syncErr.message);
    }

    // 동기화 이후 최신 봇 상태 재조회 (alloc/available 금액 반영)
    const freshAllBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
    const freshActiveRealBots = freshAllBots.filter(
      (b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1
    );

    return await runRealTradingTrackWithSoftRouting({
      db,
      allBots: freshAllBots,
      activeRealBots: freshActiveRealBots,
      candidateQuotes,
      marketStatus,
      regimeInfo,
      tossBal,
      usMarket,
      latestHybridDecisions: latestLlmDecisions,
      nowIso,
    });
  }
}

async function executeDefaultPriorityRealBuy({
  db,
  realBot,
  entryCandidates,
  priorityList,
  remainingCap,
  krHalt,
  krMult,
  krHeldCount,
  MAX_KR_SLOTS,
  usHalt,
  usMult,
  usHeldCount,
  MAX_US_SLOTS,
  tossBal,
  marketStatus,
  usMarket,
  defaultUsdRate,
  minFractionalKrw,
  pendingBotSellMsgs,
  reservedSymbolsInCycle,
  nowIso,
}) {
  let realExecuted = false;

  for (const priority of priorityList) {
    if (realExecuted) break;

    if (priority === 'KR_UNIT') {
      if (krHalt || krHeldCount >= MAX_KR_SLOTS) continue;
      const candidate = entryCandidates.find((c) => c.market === 'KR' && !reservedSymbolsInCycle.has(c.stock.code));
      if (!candidate) continue;

      const { stock, quantSig, gate } = candidate;
      const effectiveKrMult = (krMult > 0 ? krMult : 1.0) * gate.regimeMultiplier;
      const krScaledRemaining = Math.floor(remainingCap * effectiveKrMult);
      const availableKrCash = Math.min(tossBal?.availableCash ?? krScaledRemaining, krScaledRemaining);
      if (availableKrCash <= 0) continue;

      const priceInfo = await kiwoomClient.getCurrentPrice(stock.code);
      const unitPrice = Number(priceInfo?.currentPrice || stock.current_price || 0);

      if (availableKrCash >= unitPrice && unitPrice > 0) {
        reservedSymbolsInCycle.add(stock.code);
        const krPhase = marketStatus?.kr?.phase || marketStatus?.phase;
        if (krPhase && krPhase !== 'REGULAR') {
          const sellPrefix = pendingBotSellMsgs.has(realBot.bot_id) ? `${pendingBotSellMsgs.get(realBot.bot_id)} | ` : '';
          const waitMsg = `[⏳ 국내장 개장대기] ${sellPrefix}[${gate.regime} x${gate.regimeMultiplier}] 매수예정: ${stock.name} 1주 (${unitPrice.toLocaleString()}원) — 정규장(09:00) 자동 집행`;
          if (realBot.real_status_msg !== waitMsg) {
            db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
              .run(waitMsg, waitMsg, nowIso, realBot.bot_id);
          }
          continue;
        }

        const execReason = `[${realBot.nickname}][${gate.regime} x${gate.regimeMultiplier}] ${quantSig.reason || stock.name + ' 퀀트 진입'} | ${gate.reason}`;
        const orderRes = await pythonBridge.executeOrder({
          symbol: stock.code,
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
        const orderId = orderRes.orderId || `TORD_${Date.now()}`;
        const botLogPrefix = gate.regime === 'FALLBACK_PURE_QUANT'
          ? '[🐍 Python 실전매수(Fallback 50%)]'
          : `[🐍 Python 실전매수(${gate.regime} x${gate.regimeMultiplier})]`;

        withDbTransaction(db, () => {
          const insTrade = db.prepare(`
            INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
            VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
          `).run(realBot.bot_id, stock.code, stock.name, orderId, unitPrice, unitPrice, nowIso);

          db.prepare(`
            INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
            VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
          `).run(realBot.bot_id, stock.code, stock.name, orderId, unitPrice, unitPrice, fee, insTrade.lastInsertRowid, nowIso);

          db.prepare(`
            UPDATE bots
            SET real_available_krw = MAX(0, real_available_krw - ?),
                real_status_msg = ?,
                last_status_msg = ?,
                updated_at = ?
            WHERE bot_id = ?
          `).run(
            unitPrice + fee,
            `${botLogPrefix} ${stock.name} (${unitPrice.toLocaleString()}원, ${quantSig.score}점)`,
            `${botLogPrefix} 매수: ${stock.name}`,
            nowIso,
            realBot.bot_id
          );

          try {
            db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
              .run(orderId, stock.code);
          } catch (_) {}
        });

        NotificationService.notifyRealTrade({
          botName: realBot.nickname,
          market: 'KR',
          symbol: stock.code,
          name: stock.name,
          action: 'BUY',
          qty: 1,
          price: unitPrice,
          totalAmount: unitPrice,
          reason: execReason,
        });

        if (tossBal && tossBal.availableCash !== undefined) {
          tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - unitPrice - fee);
        }
        realExecuted = true;
      }
    } else if (priority === 'US_UNIT') {
      if (usHalt || usHeldCount >= MAX_US_SLOTS) continue;
      const candidate = entryCandidates.find((c) => c.market === 'US' && !reservedSymbolsInCycle.has(c.stock.code));
      if (!candidate) continue;

      const { stock, quantSig, gate } = candidate;
      const effectiveUsMult = (usMult > 0 ? usMult : 1.0) * gate.regimeMultiplier;
      const usScaledRemaining = Math.floor(remainingCap * effectiveUsMult);
      const accountPurchasingPowerKrw = tossBal
        ? (Number(tossBal.availableCash || 0) + (Number(tossBal.availableUsd || 0) * defaultUsdRate))
        : usScaledRemaining;
      const availableUsCash = Math.min(accountPurchasingPowerKrw, usScaledRemaining);
      if (availableUsCash <= 0) continue;

      const priceInfo = await tossClient.getCurrentPrice(stock.code);
      const unitPriceKrw = Number(priceInfo?.currentPrice || stock.current_price || 0);
      const unitPriceUsd = priceInfo?.currentPriceUsd || (unitPriceKrw / defaultUsdRate).toFixed(2);

      if (availableUsCash >= unitPriceKrw && unitPriceKrw > 0) {
        reservedSymbolsInCycle.add(stock.code);
        if (usMarket && !usMarket.isOpen) {
          const sellPrefix = pendingBotSellMsgs.has(realBot.bot_id) ? `${pendingBotSellMsgs.get(realBot.bot_id)} | ` : '';
          const waitMsg = `[⏳ 미국장 개장대기] ${sellPrefix}[${gate.regime} x${gate.regimeMultiplier}] 매수예정: ${stock.name} 1주 ($${unitPriceUsd}) — 미국장 개장 즉시 자동 집행`;
          if (realBot.real_status_msg !== waitMsg) {
            db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
              .run(waitMsg, waitMsg, nowIso, realBot.bot_id);
          }
          continue;
        }

        const execReason = `[${realBot.nickname}][${gate.regime} x${gate.regimeMultiplier}] ${quantSig.reason || stock.name + ' 퀀트 진입'} | ${gate.reason}`;
        const orderRes = await pythonBridge.executeOrder({
          symbol: stock.code,
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
        const orderId = orderRes.orderId || `TORD_${Date.now()}`;
        const botLogPrefix = gate.regime === 'FALLBACK_PURE_QUANT'
          ? '[🐍 Python 실전매수(Fallback 50%)]'
          : `[🐍 Python 실전매수(${gate.regime} x${gate.regimeMultiplier})]`;

        withDbTransaction(db, () => {
          const insTrade = db.prepare(`
            INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
            VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
          `).run(realBot.bot_id, stock.code, stock.name, orderId, unitPriceKrw, unitPriceKrw, nowIso);

          db.prepare(`
            INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
            VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
          `).run(realBot.bot_id, stock.code, stock.name, orderId, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

          db.prepare(`
            UPDATE bots
            SET real_available_krw = MAX(0, real_available_krw - ?),
                real_status_msg = ?,
                last_status_msg = ?,
                updated_at = ?
            WHERE bot_id = ?
          `).run(
            unitPriceKrw + fee,
            `${botLogPrefix} 미국 1주: ${stock.name} ($${unitPriceUsd}, ${quantSig.score}점)`,
            `${botLogPrefix} 1주 매수: ${stock.name}`,
            nowIso,
            realBot.bot_id
          );

          try {
            db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
              .run(orderId, stock.code);
          } catch (_) {}
        });

        NotificationService.notifyRealTrade({
          botName: realBot.nickname,
          market: 'US',
          symbol: stock.code,
          name: stock.name,
          action: 'BUY',
          qty: 1,
          price: unitPriceKrw,
          totalAmount: unitPriceKrw,
          reason: execReason,
        });

        if (tossBal && tossBal.availableCash !== undefined) {
          tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - unitPriceKrw - fee);
        }
        realExecuted = true;
      }
    } else if (priority === 'US_FRACTIONAL') {
      if (usHalt || usHeldCount >= MAX_US_SLOTS) continue;
      const candidate = entryCandidates.find((c) => c.market === 'US' && !reservedSymbolsInCycle.has(c.stock.code));
      if (!candidate) continue;

      const { stock, quantSig, gate, orderBudgetKrw } = candidate;
      const priceInfo = await tossClient.getCurrentPrice(stock.code);
      const usdRate = priceInfo?.exchangeRate || defaultUsdRate || 1345;
      const effectiveUsMult = (usMult > 0 ? usMult : 1.0) * gate.regimeMultiplier;
      const usScaledRemaining = Math.floor(remainingCap * effectiveUsMult);

      // 레짐 비중 및 동적 포지션 사이징 반영 (토스 최소 소수점 주문 $10 하한 보장)
      const targetUsd = Math.max(10.0, Math.round(Math.min(Math.max(orderBudgetKrw, minFractionalKrw), 50 * usdRate) / usdRate));
      const targetKrw = Math.round(targetUsd * usdRate);

      const actualUsd = tossBal?.availableUsd !== undefined ? Number(tossBal.availableUsd) : 0;
      const actualKrw = tossBal?.availableCash !== undefined ? Number(tossBal.availableCash) : 0;
      const accountTotalPurchasingPowerKrw = tossBal ? (actualKrw + (actualUsd * usdRate)) : usScaledRemaining;

      if (accountTotalPurchasingPowerKrw < targetKrw || usScaledRemaining < Math.min(targetKrw, minFractionalKrw)) {
        continue;
      }

      reservedSymbolsInCycle.add(stock.code);

      if (usMarket && !usMarket.isFractionalOrderable) {
        const sellPrefix = pendingBotSellMsgs.has(realBot.bot_id) ? `${pendingBotSellMsgs.get(realBot.bot_id)} | ` : '';
        const waitMsg = `[⏳ 소수점 예약대기] ${sellPrefix}[${gate.regime} x${gate.regimeMultiplier}] 매수예정: ${stock.name} $${targetUsd.toFixed(2)} (약 ${targetKrw.toLocaleString()}원) — 미국 정규장(${usMarket?.nextFractionalTime || '23:30'}) 개장 즉시 자동 체결`;
        if (realBot.real_status_msg !== waitMsg) {
          db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
            waitMsg,
            `[⏳ 소수점 예약대기] ${stock.name} $${targetUsd.toFixed(2)} (${usMarket?.nextFractionalTime || '23:30'} 개장 시 자동 주문)`,
            nowIso,
            realBot.bot_id
          );
        }
        realExecuted = true;
        continue;
      }

      const execReason = `[${realBot.nickname}][${gate.regime} x${gate.regimeMultiplier}] ${quantSig.reason || stock.name + ' 소수점 진입'} | ${gate.reason}`;
      const orderRes = await pythonBridge.executeOrder({
        symbol: stock.code,
        side: 'BUY',
        orderType: 'MARKET',
        market: 'US',
        orderAmount: targetUsd,
        reason: execReason,
      });

      if (!orderRes || orderRes.success === false) {
        throw new Error(orderRes?.message || '미국 소수점 실전 매수 주문 실행 실패');
      }

      const unitPriceKrw = Number(priceInfo?.currentPrice || stock.current_price || 1);
      const fractionalQty = parseFloat((targetKrw / unitPriceKrw).toFixed(6));
      const fee = Math.round(targetKrw * 0.0025);
      const orderId = orderRes.orderId || `TORD_${Date.now()}`;
      const botLogPrefix = gate.regime === 'FALLBACK_PURE_QUANT'
        ? '[🐍 Python 실전매수(Fallback 50%)]'
        : `[🐍 Python 실전매수(${gate.regime} x${gate.regimeMultiplier})]`;

      withDbTransaction(db, () => {
        const insTrade = db.prepare(`
          INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
          VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
        `).run(realBot.bot_id, stock.code, stock.name, orderId, unitPriceKrw, fractionalQty, targetKrw, nowIso);

        db.prepare(`
          INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
          VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
        `).run(realBot.bot_id, stock.code, stock.name, orderId, fractionalQty, unitPriceKrw, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

        db.prepare(`
          UPDATE bots
          SET real_available_krw = MAX(0, real_available_krw - ?),
              real_status_msg = ?,
              last_status_msg = ?,
              updated_at = ?
          WHERE bot_id = ?
        `).run(
          targetKrw + fee,
          `${botLogPrefix} 미국 소수점: ${stock.name} $${targetUsd.toFixed(2)} (${fractionalQty}주, ${quantSig.score}점)`,
          `${botLogPrefix} 소수점 매수: ${stock.name} ($${targetUsd.toFixed(2)})`,
          nowIso,
          realBot.bot_id
        );

        try {
          db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)")
            .run(orderId, stock.code);
        } catch (_) {}
      });

      NotificationService.notifyRealTrade({
        botName: realBot.nickname,
        market: 'US',
        symbol: stock.code,
        name: stock.name,
        action: 'BUY',
        qty: fractionalQty,
        price: unitPriceKrw,
        totalAmount: targetKrw,
        reason: execReason,
      });

      if (tossBal) {
        if (tossBal.availableUsd !== undefined && Number(tossBal.availableUsd) >= targetUsd) {
          tossBal.availableUsd = Math.max(0, parseFloat((Number(tossBal.availableUsd || 0) - targetUsd).toFixed(2)));
        } else if (tossBal.availableCash !== undefined) {
          tossBal.availableCash = Math.max(0, Number(tossBal.availableCash || 0) - targetKrw - fee);
        }
      }
      realExecuted = true;
    }
  }

  return realExecuted;
}

/**
 * Track B 실전 거래 엔진 (Position Stickiness + Soft Regime Routing)
 * - Phase B-1: 모든 미청산 실전 포지션(is_real_selected/running 무관)을 원 소유 봇(pos.bot_id)의 고유 청산 수식으로 끝까지 책임 청산
 * - Phase B-2: 활성 실전 봇의 신규 매수(BUY) 시도에만 30m Flash + 1h Pro Soft Regime Router 게이트 및 가중치 적용
 */
export async function runRealTradingTrackWithSoftRouting({
  db,
  allBots = [],
  activeRealBots = null,
  enrichedCandidates = [],
  candidateQuotes = null,
  marketStatus = null,
  regimeInfo = null,
  tossBal = null,
  usMarket = null,
  latestHybridDecisions = [],
  evaluateGateFn = evaluateRegimeGateForNewEntry,
  executeRealSellOrder = null,
  executeRealBuyOrderWithPriority = null,
  nowIso = new Date().toISOString(),
}) {
  const quotes = candidateQuotes || enrichedCandidates || [];
  const botMap = new Map(allBots.map((b) => [b.bot_id, b]));
  const resolvedActiveRealBots = Array.isArray(activeRealBots)
    ? activeRealBots
    : allBots.filter((b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1);

  const pendingBotSellMsgs = new Map();
  const exitEvents = [];
  const entryEvents = [];
  const closedOwnerBotIds = new Set();

  // =========================================================================
  // [Phase B-1: Position Stickiness & Orphan Protection]
  // 선택/가동 여부와 무관하게 모든 REAL OPEN 포지션을 원 소유 봇의 청산 공식으로 감시
  // =========================================================================
  const allOpenRealPositions = db.prepare(`
    SELECT * FROM bot_positions
    WHERE trade_mode = 'REAL' AND status = 'OPEN'
    ORDER BY id ASC
  `).all();

  for (const pos of allOpenRealPositions) {
    const ownerBot = botMap.get(pos.bot_id) || allBots[0];
    if (!ownerBot) continue;

    const quote = quotes.find((c) => c.code === pos.stock_code) || null;
    const holdingItem = tossBal?.holdings?.find((h) => h.stockCode === pos.stock_code);
    const curPrice = Number(holdingItem?.currentPrice || quote?.current_price || quote?.currentPrice || pos.avg_buy_price);
    const returnPct = holdingItem?.unrealizedProfitPct !== undefined
      ? Number(holdingItem.unrealizedProfitPct)
      : (pos.avg_buy_price > 0 ? ((curPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100 : 0);

    const exitQuote = quote
      ? { ...quote, current_price: Number(quote.current_price || quote.currentPrice || curPrice) }
      : { current_price: curPrice };

    // 원 소유 봇(pos.bot_id)의 정통 퀀트 청산 + 트레일링 스탑 판정 (LLM 시황/교체로 강제 청산 금지)
    const exitEval = evaluatePureQuantExit(ownerBot, pos, exitQuote, { fastCycleEnabled: false });

    if (exitEval.highestPrice > (pos.highest_price || 0) || (exitEval.trailingActive ? 1 : 0) !== (pos.trailing_active || 0)) {
      db.prepare("UPDATE bot_positions SET highest_price = ?, trailing_active = ? WHERE id = ?")
        .run(exitEval.highestPrice, exitEval.trailingActive ? 1 : 0, pos.id);
    }

    if (!exitEval.shouldExit) {
      const curMsg = String(ownerBot.real_status_msg || '');
      if (Number(ownerBot.is_real_selected) === 0 && !curMsg.includes('청산 대기 중') && !curMsg.includes('주간 로테이션')) {
        try {
          db.prepare("UPDATE bots SET real_status_msg = ?, updated_at = ? WHERE bot_id = ?")
            .run('청산 대기 중 (보유 포지션 자동 관리)', nowIso, ownerBot.bot_id);
        } catch (_) {}
      }
      continue;
    }

    const sellReason = `실전 ${exitEval.exitReason || '원칙 청산'}`;
    const isKr = /^[0-9]/.test(pos.stock_code);
    const isFractionalPos = !isKr && (Number(pos.qty) < 1 || (Number(pos.qty) % 1 !== 0));

    // 장운영 시간 확인 (marketStatus / usMarket 전달 시 정규장 준수)
    if (isFractionalPos && usMarket && !usMarket.isFractionalOrderable) {
      const waitSellText = `청산대기: ${pos.stock_name} ${pos.qty}주 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
      pendingBotSellMsgs.set(ownerBot.bot_id, waitSellText);
      continue;
    }

    const krPhase = marketStatus?.kr?.phase || marketStatus?.phase;
    if (isKr && krPhase && krPhase !== 'REGULAR') {
      const waitSellText = `청산대기: ${pos.stock_name} ${pos.qty}주 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
      pendingBotSellMsgs.set(ownerBot.bot_id, waitSellText);
      continue;
    }

    try {
      const posQty = Number(pos.qty || 0);
      const posBuyAmt = Number(pos.buy_amount || 0);
      const orderRes = executeRealSellOrder
        ? await executeRealSellOrder({
            ownerBot,
            bot: ownerBot,
            pos,
            curPrice,
            returnPct,
            exitEval,
            reason: sellReason,
          })
        : await pythonBridge.executeOrder({
            symbol: pos.stock_code,
            side: 'SELL',
            orderType: 'MARKET',
            market: isKr ? 'KR' : 'US',
            quantity: posQty,
            price: 0,
            reason: sellReason,
          });

      if (orderRes && orderRes.success === false) {
        continue;
      }

      const executionPrice = Number(orderRes?.executionPrice || curPrice);
      const sellAmount = Math.round(executionPrice * posQty);
      const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + Number(pos.buy_fee || 0);
      const profitKrw = (sellAmount - posBuyAmt) - feeAndTax;
      const profitPct = posBuyAmt > 0 ? parseFloat(((profitKrw / posBuyAmt) * 100).toFixed(2)) : 0;

      if (!orderRes?.handledDb) {
        withDbTransaction(db, () => {
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
              orderRes?.orderId || `TORD_S_${Date.now()}`,
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
      }

      if (!executeRealSellOrder) {
        try {
          NotificationService.notifyRealTrade({
            botName: ownerBot.name,
            botNickname: ownerBot.nickname,
            side: 'SELL',
            stockName: pos.stock_name,
            stockCode: pos.stock_code,
            price: executionPrice,
            qty: posQty,
            amount: sellAmount,
            profitKrw,
            profitPct,
            reason: sellReason,
            orderId: orderRes?.orderId,
          });
        } catch (_) {}
      }

      db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
        `[🐍 Python 실전매도(${ownerBot.nickname})] ${pos.stock_name} ${posQty}주 @ ${executionPrice.toLocaleString()}원 (${profitPct >= 0 ? '+' : ''}${profitPct}%, 이유: ${sellReason})`,
        `[🐍 Python 실전매도] ${pos.stock_name} 매도 완료`,
        nowIso,
        ownerBot.bot_id
      );

      try {
        db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL_SELL' WHERE id = (SELECT id FROM ai_trade_decisions WHERE symbol = ? ORDER BY id DESC LIMIT 1)").run(pos.stock_code);
      } catch (_) {}

      if (tossBal && !tossBal.isMock) {
        const netProceedsKrw = Math.max(0, sellAmount - Math.round(sellAmount * (0.00015 + 0.0018)));
        if (isKr && tossBal.availableCash !== undefined) {
          tossBal.availableCash = Number(tossBal.availableCash || 0) + netProceedsKrw;
        } else if (!isKr && tossBal.availableUsd !== undefined) {
          const usdRate = Number(tossBal.usdRate || usMarket?.exchangeRate || 1345);
          if (usdRate > 0) {
            tossBal.availableUsd = Number(tossBal.availableUsd || 0) + (netProceedsKrw / usdRate);
          }
        }
      }

      closedOwnerBotIds.add(ownerBot.bot_id);
      exitEvents.push({
        botId: ownerBot.bot_id,
        stockCode: pos.stock_code,
        reason: sellReason,
        profitKrw,
        profitPct,
      });
    } catch (err) {
      console.error('[SchedulerService] Python 실전 매도 에러:', err.message);
      const errMsg = String(err.message || '');
      if (errMsg.includes('outside-regular-hours') || errMsg.includes('422') || errMsg.includes('429')) {
        const waitSellText = `청산대기: ${pos.stock_name} (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
        pendingBotSellMsgs.set(ownerBot.bot_id, waitSellText);
      } else if (errMsg.includes('잔고') || errMsg.includes('보유') || errMsg.includes('404')) {
        console.warn(`[SchedulerService] 실전 미보유 포지션(${pos.stock_name}, 사유: ${errMsg}) 자동 닫힘 처리`);
        db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, pos.id);
        closedOwnerBotIds.add(ownerBot.bot_id);
      }
    }
  }

  // 선택 해제되었던 봇의 Stickiness 포지션 청산 후 상태 정리 및 활성 실전 봇 가용 예산 즉시 재동기화
  for (const botId of closedOwnerBotIds) {
    const ownerBot = botMap.get(botId);
    if (ownerBot && Number(ownerBot.is_real_selected) === 0) {
      const remRow = db.prepare(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(buy_amount), 0) AS amt
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
      `).get(botId);
      if (!remRow || Number(remRow.cnt) === 0) {
        db.prepare(`
          UPDATE bots
          SET real_allocated_capital = 0,
              real_available_krw = 0,
              allocated_capital = 0,
              allocation_ratio = 0,
              real_status_msg = '가상 아레나 전용 (실전 미선택)',
              updated_at = ?
          WHERE bot_id = ?
        `).run(nowIso, botId);
      } else {
        const waitMsg = String(ownerBot.real_status_msg || '').includes('주간 로테이션')
          ? ownerBot.real_status_msg
          : '청산 대기 중 (보유 포지션 자동 관리)';
        db.prepare(`
          UPDATE bots
          SET real_allocated_capital = ?,
              allocated_capital = ?,
              real_status_msg = ?,
              updated_at = ?
          WHERE bot_id = ?
        `).run(Math.round(Number(remRow.amt || 0)), Math.round(Number(remRow.amt || 0)), waitMsg, nowIso, botId);
      }
    }
  }

  if (closedOwnerBotIds.size > 0 || exitEvents.length > 0) {
    try {
      syncActiveRealBotsAvailableKrw(db, tossBal);
      for (let i = 0; i < resolvedActiveRealBots.length; i++) {
        const refreshed = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(resolvedActiveRealBots[i].bot_id);
        if (refreshed) resolvedActiveRealBots[i] = refreshed;
      }
    } catch (_) {}
  }

  // =========================================================================
  // [Phase B-2: Soft Regime Routing]
  // 활성 실전 봇(is_real_selected = 1 AND is_real_running = 1)에 한해 신규 매수 게이트 평가
  // =========================================================================
  if (resolvedActiveRealBots.length === 0) {
    return { exitCount: exitEvents.length, exitEvents, entryCount: 0, entryEvents };
  }

  const filterRow = db.prepare("SELECT * FROM market_regime_filter WHERE id = 1").get();
  const krAction = filterRow?.kr_recommended_action || filterRow?.recommended_action || 'NORMAL';
  const krMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.kr_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
  const krHalt = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1 || regimeInfo?.isKrHalt || regimeInfo?.regime === 'HOLD_CASH';

  const usAction = filterRow?.us_recommended_action || filterRow?.recommended_action || 'NORMAL';
  const usMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.us_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
  const usHalt = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

  if (krHalt && usHalt) {
    console.log(`[LLM 방어 작동] 한·미 양대 시장 신규 매수 전면 차단 (🇰🇷KR: ${krAction}, 🇺🇸US: ${usAction})`);
    return { exitCount: exitEvents.length, exitEvents, entryCount: 0, entryEvents };
  }

  let krBlacklist = [];
  let usBlacklist = [];
  try {
    krBlacklist = JSON.parse(filterRow?.kr_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
    usBlacklist = JSON.parse(filterRow?.us_blacklist_tickers_json || filterRow?.blacklist_tickers_json || '[]');
  } catch (_) {}

  const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
  let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
  if (prioRow && prioRow.value) {
    try {
      const parsed = JSON.parse(prioRow.value);
      if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
    } catch (_) {}
  }

  const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
  const realTotalBudget = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;

  let defaultUsdRate = 1345;
  let minFractionalKrw = 13450;
  if (!executeRealBuyOrderWithPriority) {
    defaultUsdRate = usMarket?.exchangeRate || (await tossClient.getExchangeRate()) || 1345;
    minFractionalKrw = await tossClient.getMinFractionalOrderBudgetKrw();
  }

  const reservedSymbolsInCycle = new Set();

  for (const realBot of resolvedActiveRealBots) {
    const botPositions = db.prepare(
      "SELECT stock_code, trade_mode FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'"
    ).all(realBot.bot_id);
    if (botPositions.length >= 3) continue;

    const krHeldCount = botPositions.filter((p) => p.stock_code && p.stock_code.length === 6 && /^\d+$/.test(p.stock_code)).length;
    const usHeldCount = botPositions.filter((p) => !(p.stock_code && p.stock_code.length === 6 && /^\d+$/.test(p.stock_code))).length;
    const MAX_KR_SLOTS = 2;
    const MAX_US_SLOTS = 2;

    const heldCodes = db.prepare("SELECT stock_code FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'").all().map((p) => p.stock_code);
    const botCap = Number(realBot.real_allocated_capital || 0) > 0
      ? Number(realBot.real_allocated_capital)
      : (Number(realBot.real_available_krw || 0) > 0
        ? Number(realBot.real_available_krw)
        : Math.floor(realTotalBudget * ((realBot.real_allocation_ratio || 33.3) / 100)));
    const usedCapRow = db.prepare(
      "SELECT COALESCE(SUM(buy_amount), 0) AS used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)"
    ).get(realBot.bot_id);
    const usedCap = Number(usedCapRow?.used || 0);
    const remainingCap = Math.max(0, botCap - usedCap);
    const availableBotKrw = Math.max(
      0,
      Number(realBot.real_available_krw || 0) > 0 ? Math.min(remainingCap, Number(realBot.real_available_krw)) : remainingCap
    );
    if (availableBotKrw <= 0) continue;

    const entryCandidates = [];
    for (const stock of quotes) {
      if (!stock || !stock.code) continue;
      if (heldCodes.includes(stock.code) || reservedSymbolsInCycle.has(stock.code)) continue;

      const market = stock.market || (/^[0-9]/.test(stock.code) ? 'KR' : 'US');
      if (market === 'KR' && (krHalt || krHeldCount >= MAX_KR_SLOTS || krBlacklist.includes(stock.code))) continue;
      if (market === 'US' && (usHalt || usHeldCount >= MAX_US_SLOTS || usBlacklist.includes(stock.code))) continue;

      // 1) 봇 고유의 퀀트 알고리즘 진입 시그널 평가
      const quantSig = evaluatePureQuantAlgorithm(realBot, stock);
      if (!quantSig || !(quantSig.shouldBuy || quantSig.signal === 'BUY')) continue;

      // 2) Soft Regime Router 게이트키퍼 평가 (허용 여부 + 예산 배수)
      const gate = await evaluateGateFn(realBot, stock, quantSig, { db });
      if (!gate || !gate.allowNewBuy || Number(gate.regimeMultiplier || 0) <= 0) continue;

      // LLM이 개별 종목 SELL 경고를 냈다면 (Fallback 모드 제외) 진입 보류
      if (gate.regime !== 'FALLBACK_PURE_QUANT') {
        const llmItem = Array.isArray(latestHybridDecisions)
          ? latestHybridDecisions.find((d) => d.symbol === stock.code)
          : null;
        if (llmItem && llmItem.action === 'SELL') continue;
      }

      // 3) 시그널 점수 + ATR 변동성 + 레짐 가중치 결합 동적 포지션 사이징
      const orderBudgetKrw = calculateDynamicPositionSize(
        realBot,
        quantSig.score,
        stock,
        availableBotKrw,
        gate.regimeMultiplier
      );
      if (orderBudgetKrw <= 0) continue;

      entryCandidates.push({
        stock,
        market,
        quantSig,
        gate,
        orderBudgetKrw,
        sortScore: Number(quantSig.score || 0) + (gate.hasNewsCatalyst ? 5 : 0),
      });
    }

    if (entryCandidates.length === 0) continue;
    entryCandidates.sort((a, b) => b.sortScore - a.sortScore);

    try {
      if (executeRealBuyOrderWithPriority) {
        const top = entryCandidates[0];
        const buyRes = await executeRealBuyOrderWithPriority({
          realBot,
          bot: realBot,
          stock: top.stock,
          quantSig: top.quantSig,
          gate: top.gate,
          orderBudgetKrw: top.orderBudgetKrw,
          candidates: entryCandidates,
          priorityList,
          remainingCap,
          krMult,
          usMult,
        });
        if (buyRes !== false) {
          reservedSymbolsInCycle.add(top.stock.code);
          entryEvents.push({
            botId: realBot.bot_id,
            stockCode: top.stock.code,
            regime: top.gate.regime,
            regimeMultiplier: top.gate.regimeMultiplier,
            orderBudgetKrw: top.orderBudgetKrw,
          });
        }
      } else {
        const executed = await executeDefaultPriorityRealBuy({
          db,
          realBot,
          entryCandidates,
          priorityList,
          remainingCap,
          krHalt,
          krMult,
          krHeldCount,
          MAX_KR_SLOTS,
          usHalt,
          usMult,
          usHeldCount,
          MAX_US_SLOTS,
          tossBal,
          marketStatus,
          usMarket,
          defaultUsdRate,
          minFractionalKrw,
          pendingBotSellMsgs,
          reservedSymbolsInCycle,
          nowIso,
        });
        if (executed) {
          entryEvents.push({
            botId: realBot.bot_id,
            stockCode: entryCandidates[0].stock.code,
            regime: entryCandidates[0].gate.regime,
            regimeMultiplier: entryCandidates[0].gate.regimeMultiplier,
            orderBudgetKrw: entryCandidates[0].orderBudgetKrw,
          });
        }
      }
    } catch (rErr) {
      console.error('[SchedulerService] Python 실전 매수 에러:', rErr.message);
      const errMsg = String(rErr?.message || '');
      if (errMsg.includes('insufficient-buying-power') || errMsg.includes('주문가능 달러')) {
        const failMsg = `[⚠️ 달러부족 실패] 토스증권 주문가능 달러 부족 — 토스 앱에서 달러(USD) 환전 필요`;
        try {
          db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
            .run(failMsg, failMsg, nowIso, realBot.bot_id);
        } catch (_) {}
      }
    }
  }

  return {
    exitCount: exitEvents.length,
    exitEvents,
    entryCount: entryEvents.length,
    entryEvents,
  };
}

/**
 * 매주 월요일 08:30 KST(08:30~08:59) 정규장 개장 30분 전 자동 전략군별 주간 1위 로테이션 실행기
 * - 당일(last_weekly_rotation_date === YYYY-MM-DD) 중복 실행 방지
 */
export async function checkAndRunWeeklyAutoRotation(
  liveQuotes = [],
  notifyCallback = null,
  options = {}
) {
  const db = options.db || getDb();
  if (!db) return { executed: false, reason: 'NO_DB' };

  const nowDate = options.nowDate instanceof Date ? options.nowDate : new Date();
  const kstParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(nowDate);

  const partMap = Object.fromEntries(kstParts.map((p) => [p.type, p.value]));
  const weekday = partMap.weekday;
  const rawHour = Number(partMap.hour);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(partMap.minute);
  const todayKst = `${partMap.year}-${partMap.month}-${partMap.day}`;

  // 매주 월요일 08:30 ~ 08:59 KST 창에서만 실행 (장 개장 30분 전)
  if (weekday !== 'Mon' || hour !== 8 || minute < 30) {
    return {
      executed: false,
      reason: 'OUTSIDE_WINDOW',
      weekday,
      hour,
      minute,
      date: todayKst,
    };
  }

  const enabledRow = db.prepare("SELECT value FROM system_settings WHERE key = 'weekly_auto_rotation_enabled'").get();
  if (enabledRow && enabledRow.value !== 'true') {
    return { executed: false, reason: 'DISABLED', date: todayKst };
  }

  const lastRow = db.prepare("SELECT value FROM system_settings WHERE key = 'last_weekly_rotation_date'").get();
  if (lastRow && lastRow.value === todayKst) {
    return { executed: false, reason: 'ALREADY_ROTATED_TODAY', date: todayKst };
  }

  const result = await rotateWeeklyTopBotsByFamily(liveQuotes, {
    trigger: 'AUTO_MONDAY_0830',
    db,
    nowDate,
    skipTossSync: options.skipTossSync,
    tossBal: options.tossBal,
  });

  if (typeof notifyCallback === 'function') {
    try {
      await notifyCallback(result);
    } catch (_) {}
  }

  return {
    executed: true,
    date: todayKst,
    result,
  };
}

export const schedulerService = new SchedulerService();
