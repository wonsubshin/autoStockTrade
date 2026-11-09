import { getDb } from '../db/index.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine, BotService } from './bot_service.mjs';
import { pythonBridge } from './trade_service.mjs';
import { evaluatePureQuantAlgorithm } from '../common/quant_algorithms.mjs';
import { AiService, llmDecisionService } from './ai_service.mjs';

export class SchedulerService {
  constructor() {
    this.timer = null;
    this.aiScheduleTimer = null;
    this.intervalMs = 7000;
    this.lastLlmAnalysisTime = 0;
    // 정해진 4시간 간격(0시, 4시, 8시, 12시, 16시, 20시 KST) 자동 분석 슬롯 추적
    this.lastAutoSlotKey = '';
    this.lastScheduledAiFailureMs = 0;
    this.isLlmAnalyzing = false;
    this.cachedLlmDecisions = [];
  }

  start() {
    if (this.timer) return;
    console.log('[SchedulerService] 듀얼 트랙(10대 가상 아레나 & 1~3개 실전봇) 스케줄러 시작 (7초 주기, AI 자동분석: 0/4/8/12/16/20시)');
    // 시작 시 현재 4시간 슬롯(0시/4시/8시/12시/16시/20시) 자동 분석 여부 확인 및 실행
    this.checkAndRunScheduledLlmAnalysis().catch(() => {});
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
    // 10초 간격 4시간 주기 AI 시황 & 봇 진단 자동 스케줄러 타이머 구동
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
    console.log('[SchedulerService] 스케줄러 정지');
  }

  async checkAndRunScheduledLlmAnalysis() {
    if (this.isLlmAnalyzing) return;
    // 실패 시 무한 재시도 방지를 위해 5분(300,000ms) 쿨다운 적용
    if (this.lastScheduledAiFailureMs > 0 && Date.now() - this.lastScheduledAiFailureMs < 300000) {
      return;
    }

    const db = getDb();
    if (!db) return;

    const { slotKey, slotLabel } = AiService.getKstTimeParts();

    if (!this.lastAutoSlotKey) {
      try {
        const row = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_briefing_last_auto_slot'").get()
          || db.prepare("SELECT value FROM system_settings WHERE key = 'ai_last_auto_slot_key'").get();
        if (row && row.value) {
          this.lastAutoSlotKey = row.value;
        }
      } catch (e) {}
    }

    // 현재 시각의 4시간 정각 슬롯(00시, 04시, 08시, 12시, 16시, 20시)이 아직 자동 실행되지 않았다면 즉시 자동 분석 수행
    // (사용자가 중간에 수동 분석을 요청했더라도 ai_briefing_last_auto_slot은 변경되지 않으므로 정해진 시각에 반드시 자동 실행됨)
    if (this.lastAutoSlotKey !== slotKey) {
      await this.refreshLlmDecisions({ triggerType: 'AUTO', slotKey, slotLabel });
    }
  }

  async refreshLlmDecisions({ triggerType = 'AUTO', slotKey = '', slotLabel = '' } = {}) {
    if (this.isLlmAnalyzing) return;
    this.isLlmAnalyzing = true;
    try {
      const db = getDb();
      console.log(`[SchedulerService] 📰 [${slotLabel || '정기'} 자동분석] 한·미 실시간 시장 체제 & 봇 진단 및 종목 신호 분석 시작...`);

      // 1) 한·미 실시간 마켓 브리핑 & 봇 진단 생성 및 ai_market_briefings 저장
      await AiService.generateAiMarketAnalysis({
        triggerType,
        slotKey,
      });

      // 2) 후보 종목별 AI 매매 신호(BUY/SELL/HOLD) 갱신
      const decisions = await llmDecisionService.evaluateTradeSignals(ALL_CANDIDATE_STOCKS, {
        triggerType,
        slotLabel,
      });
      if (Array.isArray(decisions) && decisions.length > 0) {
        this.cachedLlmDecisions = decisions;
      }

      this.lastLlmAnalysisTime = Date.now();
      this.lastScheduledAiFailureMs = 0;

      if (triggerType === 'AUTO' && slotKey && db) {
        this.lastAutoSlotKey = slotKey;
        const nowIso = new Date().toISOString();
        try {
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('ai_briefing_last_auto_slot', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(slotKey, nowIso);
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('ai_last_auto_slot_key', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(slotKey, nowIso);
        } catch (e) {}
      }
      console.log(`[SchedulerService] ✅ [${slotLabel || '정기'}] Gemini AI 한·미 시장 분석 & 봇 진단 자동 갱신 완료 (슬롯: ${slotKey || 'MANUAL'})`);
    } catch (err) {
      this.lastScheduledAiFailureMs = Date.now();
      console.warn('[SchedulerService] AI 정기 시장 분석 & 봇 진단 갱신 오류 (5분 후 재시도):', err.message);
    } finally {
      this.isLlmAnalyzing = false;
    }
  }

  getLatestLlmDecisions(db) {
    try {
      const rows = db.prepare(`
        SELECT * FROM ai_trade_decisions
        WHERE id IN (
          SELECT MAX(id) FROM ai_trade_decisions GROUP BY symbol
        )
      `).all();
      if (rows && rows.length > 0) {
        return rows.map((r) => ({
          symbol: r.symbol,
          name: r.stock_name,
          market: r.market,
          action: r.action,
          confidence: r.confidence,
          sentimentScore: r.sentiment_score,
          reasoning: r.reasoning,
          isFractional: r.suggested_order_type === 'AMOUNT_FRACTIONAL',
        }));
      }
    } catch (e) {}
    return this.cachedLlmDecisions || [];
  }

  async runCycle() {
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
      // Gemini LLM 뉴스 감성 분석 ⨉ Python Core Executor ⨉ 구매 우선순위 100% 연동
      // ===========================================================================
      // 0시, 4시, 8시, 12시, 16시, 20시(4시간 간격 KST 정각) 도래 시 자동 AI 시장분석 & 봇 진단 실행
      if (!this.isLlmAnalyzing) {
        this.checkAndRunScheduledLlmAnalysis().catch(() => {});
      }

      const latestLlmDecisions = this.getLatestLlmDecisions(db);

      const activeRealBots = allBots.filter(
        (b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1
      );

      if (activeRealBots.length > 0) {
        await this.runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo, latestLlmDecisions);
      }
    } catch (err) {
      console.error('[SchedulerService] Error in runCycle:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // [TRACK A: 내부 실행 함수] 가상 아레나 순수 퀀트 봇 사이클
  // ---------------------------------------------------------------------------
  async runPureVirtualArenaCycle(db, bot, candidateQuotes) {
    try {
      const nowMs = Date.now();
      const nowIso = new Date().toISOString();

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
        } else if (heldTimeMs >= 25000 && (returnPct >= 0.5 || returnPct <= -1.0)) {
          shouldExit = true;
          exitReason = returnPct >= 0.5
            ? `가상 단기 목표 수익 달성 (+${returnPct.toFixed(2)}%)`
            : `가상 리스크 관리 조기 손절 (${returnPct.toFixed(2)}%)`;
        } else if (heldTimeMs >= 75000) {
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

      // 시그널 미발생 시에도 상시 가상 거래 활성화를 위해 0포지션일 때 탐색적 진입
      if (!bestStock && currentOpenCount === 0 && Math.random() < 0.65) {
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
          // Gemini LLM 실시간 뉴스 감성 분석 악재 SELL 신호 발생 시 긴급 청산
          const llmSignal = latestLlmDecisions.find((d) => d.symbol === pos.stock_code);
          if (llmSignal && llmSignal.action === 'SELL') {
            shouldSell = true;
            sellReason = `[🎙️ Gemini LLM 뉴스 악재 매도권고] ${llmSignal.reasoning || '뉴스 감성 점수 급락 및 악재 출회로 인한 리스크 관리 매도'}`;
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
          if (isKr && marketStatus?.phase !== 'REGULAR') {
            const waitSellText = `청산대기: ${pos.stock_name} ${pos.qty}주 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
            pendingBotSellMsgs.set(bot.bot_id, waitSellText);
            continue;
          }

          try {
            const orderRes = await pythonBridge.executeOrder({
              symbol: pos.stock_code,
              side: 'SELL',
              orderType: 'MARKET',
              market: isKr ? 'KR' : 'US',
              quantity: pos.qty,
              price: 0,
              reason: sellReason,
            });

            const executionPrice = curPrice;
            const sellAmount = Math.round(executionPrice * pos.qty);
            const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + (pos.buy_fee || 0);
            const profitKrw = (sellAmount - pos.buy_amount) - feeAndTax;
            const profitPct = pos.buy_amount > 0 ? parseFloat(((profitKrw / pos.buy_amount) * 100).toFixed(2)) : 0;

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
                pos.qty,
                sellAmount,
                nowIso,
                feeAndTax,
                profitKrw,
                profitPct,
                pos.trade_id
              );
            }

            db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
              `[🐍 Python 실전매도] ${pos.stock_name} ${pos.qty}주 @ ${executionPrice.toLocaleString()}원 (${profitPct >= 0 ? '+' : ''}${profitPct}%, 이유: ${sellReason})`,
              `[🐍 Python 실전매도] ${pos.stock_name} 매도 완료`,
              nowIso,
              bot.bot_id
            );

            // AI 의사결정 상태도 EXECUTED_REAL_SELL로 갱신
            try {
              db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL_SELL' WHERE symbol = ? ORDER BY id DESC LIMIT 1").run(pos.stock_code);
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

    // 🇰🇷 한국 시장 체제 판정 및 매매 지침
    const krAction = filterRow?.kr_recommended_action || filterRow?.recommended_action || 'NORMAL';
    const krMult = Math.max(0.0, Math.min(1.0, Number(filterRow?.kr_position_size_multiplier ?? filterRow?.position_size_multiplier ?? 1.0)));
    const krHalt = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1 || regimeInfo?.regime === 'HOLD_CASH';

    // 🇺🇸 미국 시장 체제 판정 및 매매 지침
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
    // - 한국 종목(market === 'KR')은 krHalt/krBlacklist가 적용되며,
    // - 미국 종목(market === 'US')은 usHalt/usBlacklist가 적용됩니다.
    // - 코스피가 폭락하여 krHalt이더라도, 미국 시장(usHalt = false)은 정상 매수 신호로 살아남아 독립 거래됩니다!
    const buySignals = latestLlmDecisions
      .filter((d) => {
        if (d.action !== 'BUY' || (d.confidence || 0) < 65) return false;
        if (d.market === 'KR' && (krHalt || krBlacklist.includes(d.symbol))) return false;
        if (d.market === 'US' && (usHalt || usBlacklist.includes(d.symbol))) return false;
        return true;
      })
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.sentimentScore || 0) - (a.sentimentScore || 0));

    if (buySignals.length === 0) {
      return;
    }

    const defaultUsdRate = usMarket?.exchangeRate || 1345;
    const minFractionalKrw = Math.ceil(defaultUsdRate * 1.05); // 토스 소수점 최소 주문($1.00) + 환율 버퍼 (약 1,415원)
    const reservedSymbolsInCycle = new Set();

    for (const bot of activeRealBots) {
      const openCount = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").get(bot.bot_id).cnt;
      if (openCount >= 3) continue;

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
        const allAvailableSignals = buySignals.filter((s) => !heldCodes.includes(s.symbol));
        const unreservedSignals = allAvailableSignals.filter((s) => !reservedSymbolsInCycle.has(s.symbol));
        const availableBuySignals = unreservedSignals.length > 0 ? unreservedSignals : allAvailableSignals;
        if (availableBuySignals.length === 0) continue;

        let realExecuted = false;
        for (const priority of priorityList) {
          if (realExecuted) break;

          if (priority === 'KR_UNIT') {
            // 1순위: 🇰🇷 한국 주식 1주 온주 매수 (한국 LLM 판단 로직 및 krMult 배율 적용)
            if (krHalt) continue; // 한국 시장 리스크 경보/차단 시 국내 주식만 스킵

            const krScaledBotCap = Math.floor(botCap * (krMult > 0 ? krMult : 1.0));
            const krRemainingCap = Math.max(0, krScaledBotCap - usedCap);
            const availableKrCash = Math.min(tossBal?.availableCash || 0, krRemainingCap);
            if (availableKrCash <= 0) continue;

            const candidateSignal = availableBuySignals.find((s) => s.market === 'KR');
            if (!candidateSignal) continue;

            const priceInfo = await kiwoomClient.getCurrentPrice(candidateSignal.symbol);
            const unitPrice = priceInfo.currentPrice;

            if (availableKrCash >= unitPrice && unitPrice > 0) {
              reservedSymbolsInCycle.add(candidateSignal.symbol);
              if (marketStatus?.phase !== 'REGULAR') {
                const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
                const waitMsg = `[⏳ 국내장 개장대기] ${sellPrefix}매수예정: ${candidateSignal.name} 1주 (${unitPrice.toLocaleString()}원, 🇰🇷KR배율: ${Math.round(krMult * 100)}%) — 정규장(09:00) 자동 집행`;
                if (bot.real_status_msg !== waitMsg) {
                  db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
                    .run(waitMsg, waitMsg, nowIso, bot.bot_id);
                }
                continue;
              }

              const execReason = `[${bot.nickname}] Gemini AI 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 매수'}`;
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidateSignal.symbol,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'KR',
                quantity: 1,
                reason: execReason,
              });
              const fee = Math.round(unitPrice * 0.00015);
              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, unitPrice, unitPrice, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPrice, unitPrice, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] LLM 호재 추천: ${candidateSignal.name} (${unitPrice.toLocaleString()}원, 확신도 ${candidateSignal.confidence}%)`,
                `[🐍 Python 실전매수] LLM 추천 매수: ${candidateSignal.name}`,
                nowIso,
                bot.bot_id
              );

              try {
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                  .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
              } catch (e) {}

              realExecuted = true;
            }
          } else if (priority === 'US_UNIT') {
            // 2순위: 🇺🇸 미국 주식 1주 온주 매수 (미국 LLM 판단 로직 및 usMult 배율 적용)
            if (usHalt) continue; // 미국 시장 리스크 경보/차단 시 미국 주식 스킵

            const usScaledBotCap = Math.max(minFractionalKrw, Math.floor(botCap * (usMult > 0 ? usMult : 1.0)));
            const usRemainingCap = Math.max(0, usScaledBotCap - usedCap);
            const availableUsCash = Math.min(tossBal?.availableCash || 0, usRemainingCap);
            if (availableUsCash <= 0) continue;

            const candidateSignal = availableBuySignals.find((s) => s.market === 'US');
            if (!candidateSignal) continue;

            const priceInfo = await tossClient.getCurrentPrice(candidateSignal.symbol);
            const unitPriceKrw = priceInfo.currentPrice;
            const unitPriceUsd = priceInfo.currentPriceUsd;

            if (availableUsCash >= unitPriceKrw && unitPriceKrw > 0) {
              reservedSymbolsInCycle.add(candidateSignal.symbol);
              if (!usMarket?.isOpen) {
                const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
                const waitMsg = `[⏳ 미국장 개장대기] ${sellPrefix}매수예정: ${candidateSignal.name} 1주 ($${unitPriceUsd}, 🇺🇸US배율: ${Math.round(usMult * 100)}%) — 미국장 개장 즉시 자동 집행`;
                if (bot.real_status_msg !== waitMsg) {
                  db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?")
                    .run(waitMsg, waitMsg, nowIso, bot.bot_id);
                }
                continue;
              }

              const execReason = `[${bot.nickname}] Gemini AI 미국 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 미국 1주 온주 매수'}`;
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidateSignal.symbol,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'US',
                quantity: 1,
                reason: execReason,
              });
              const fee = Math.round(unitPriceKrw * 0.0025);
              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, unitPriceKrw, unitPriceKrw, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] LLM 추천 미국 1주 온주: ${candidateSignal.name} ($${unitPriceUsd}, 확신도 ${candidateSignal.confidence}%)`,
                `[🐍 Python 실전매수] LLM 추천 1주 온주: ${candidateSignal.name}`,
                nowIso,
                bot.bot_id
              );

              try {
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                  .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
              } catch (e) {}

              realExecuted = true;
            }
          } else if (priority === 'US_FRACTIONAL') {
            // 3순위: 🇺🇸 미국 주식 소수점 금액 구매 (미국 LLM 판단 로직 및 usMult 배율 적용)
            if (usHalt) continue; // 미국 시장 리스크 경보/차단 시 미국 소수점 스킵

            const usScaledBotCap = Math.max(minFractionalKrw, Math.floor(botCap * (usMult > 0 ? usMult : 1.0)));
            const usRemainingCap = Math.max(0, usScaledBotCap - usedCap);
            const availableUsCash = Math.min(tossBal?.availableCash || 0, usRemainingCap);

            const candidateSignal = availableBuySignals.find((s) => s.market === 'US');
            if (!candidateSignal) continue;

            const priceInfo = await tossClient.getCurrentPrice(candidateSignal.symbol);
            const usdRate = priceInfo.exchangeRate || defaultUsdRate || 1345;
            // 가용 예산의 96%(환율 변동 및 수수료 여유분)를 달러로 환산하여 최소 $1.00 이상이면 즉시 주문 가능
            const affordableUsd = Math.floor(((availableUsCash * 0.96) / usdRate) * 100) / 100;
            const targetUsd = Math.min(10.0, affordableUsd);
            const targetKrw = Math.round(targetUsd * usdRate);

            if (targetUsd >= 1.0 && availableUsCash >= targetKrw) {
              reservedSymbolsInCycle.add(candidateSignal.symbol);
              // 토스증권 소수점 금액 주문은 미국 정규장(개장 ~ 종료 1시간 전, 23:30~05:00 KST)에만 접수 가능
              if (!usMarket?.isFractionalOrderable) {
                const sellPrefix = pendingBotSellMsgs.has(bot.bot_id) ? `${pendingBotSellMsgs.get(bot.bot_id)} | ` : '';
                const waitMsg = `[⏳ 소수점 예약대기] ${sellPrefix}매수예정: ${candidateSignal.name} $${targetUsd.toFixed(2)} (약 ${targetKrw.toLocaleString()}원, 확신도 ${candidateSignal.confidence}%) — 미국 정규장(${usMarket?.nextFractionalTime || '23:30'}) 개장 즉시 자동 체결`;
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

              const execReason = `[${bot.nickname}] Gemini AI 추천: ${candidateSignal.reasoning || candidateSignal.name + ' 소수점 매수'}`;
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidateSignal.symbol,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'US',
                orderAmount: targetUsd,
                reason: execReason,
              });
              const fractionalQty = parseFloat((targetKrw / priceInfo.currentPrice).toFixed(6));
              const fee = Math.round(targetKrw * 0.0025);

              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TORD_${Date.now()}`, priceInfo.currentPrice, fractionalQty, targetKrw, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidateSignal.symbol, candidateSignal.name, orderRes.orderId || `TPOS_${Date.now()}`, fractionalQty, priceInfo.currentPrice, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] LLM 추천 미국 소수점: ${candidateSignal.name} $${targetUsd.toFixed(2)} (${fractionalQty}주, 확신도 ${candidateSignal.confidence}%)`,
                `[🐍 Python 실전매수] LLM 추천 소수점: ${candidateSignal.name} ($${targetUsd.toFixed(2)})`,
                nowIso,
                bot.bot_id
              );

              try {
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                  .run(orderRes.orderId || `TORD_${Date.now()}`, candidateSignal.symbol);
              } catch (e) {}

              realExecuted = true;
            }
          }
        }
      } catch (rErr) {
        console.error('[SchedulerService] Python 실전 매수 에러:', rErr.message);
      }
    }
  }
}

export const schedulerService = new SchedulerService();
