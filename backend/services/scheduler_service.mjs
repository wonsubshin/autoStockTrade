import { getDb } from '../db/index.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine } from './bot_service.mjs';
import { pythonBridge } from './trade_service.mjs';
import { evaluatePureQuantAlgorithm } from '../common/quant_algorithms.mjs';

export class SchedulerService {
  constructor() {
    this.timer = null;
    this.intervalMs = 7000;
  }

  start() {
    if (this.timer) return;
    console.log('[SchedulerService] 듀얼 트랙(10대 가상 아레나 & 1~3개 실전봇) 스케줄러 시작 (7초 주기)');
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[SchedulerService] 스케줄러 정지');
    }
  }

  async runCycle() {
    try {
      const db = getDb();
      if (!db) return;

      // 1. 가상 경쟁 모드는 10개 봇 전체 상시 가동 강제 유지
      db.prepare(`UPDATE bots SET is_virtual_running = 1 WHERE is_virtual_running != 1`).run();

      const allBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
      if (allBots.length === 0) return;

      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      // 시세 캐시 맵 구축 (국내 및 해외)
      const candidateQuotes = [];
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
      // 기존 실전 브로커 주문 + 구매 우선순위 + Python Core Executor 100% 보존
      // ===========================================================================
      const activeRealBots = allBots.filter(
        (b) => Number(b.is_real_selected) === 1 && Number(b.is_real_running) === 1
      );

      if (activeRealBots.length > 0) {
        await this.runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo);
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

      const heldCodes = db.prepare("SELECT stock_code FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").all(bot.bot_id).map((p) => p.stock_code);
      const pool = candidateQuotes.filter((c) => !heldCodes.includes(c.code));
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
      if (bestStock && bestSignal && virtualKrw >= 100000) {
        const investAmount = Math.min(virtualKrw, Math.floor(virtualKrw * 0.32));
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
  // [TRACK B: 내부 실행 함수] 실전 거래 사이클 (선택된 1~3개 실전봇 전용)
  // ---------------------------------------------------------------------------
  async runRealTradingCycle(db, activeRealBots, candidateQuotes, marketStatus, regimeInfo) {
    const nowIso = new Date().toISOString();

    // 1) 실전 포지션 청산 검사
    for (const bot of activeRealBots) {
      const realPositions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").all(bot.bot_id);

      for (const pos of realPositions) {
        const quote = candidateQuotes.find((c) => c.code === pos.stock_code);
        const curPrice = quote ? quote.current_price : pos.avg_buy_price;
        const returnPct = ((curPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100;

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
        }

        if (shouldSell) {
          try {
            const isKr = /^[0-9]/.test(pos.stock_code);
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
            const profitPct = parseFloat(((profitKrw / pos.buy_amount) * 100).toFixed(2));

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
          } catch (err) {
            console.error('[SchedulerService] Python 실전 매도 에러:', err.message);
          }
        }
      }
    }

    // 하락장 100% 현금 관망 시 신규 진입 스킵
    if (regimeInfo?.regime === 'HOLD_CASH') {
      return;
    }

    // 2) 실전 신규 매수 진입 판정 (우선순위 엔진 적용)
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
        const botCap = bot.real_allocated_capital || Math.floor(realTotalBudget * ((bot.real_allocation_ratio || 50) / 100));

        const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").get(bot.bot_id);
        const usedCap = usedCapRow ? usedCapRow.used : 0;
        const remainingCap = Math.max(0, botCap - usedCap);

        const tossBal = await tossClient.getAccountBalance();
        const availableRealCash = Math.min(tossBal.availableCash, remainingCap);

        let realExecuted = false;
        for (const priority of priorityList) {
          if (realExecuted) break;

          if (priority === 'KR_UNIT') {
            // 1순위: 국내 주식 1주 온주 매수
            const candidate = TOP_KR_STOCKS[Math.floor(Math.random() * TOP_KR_STOCKS.length)];
            const priceInfo = await kiwoomClient.getCurrentPrice(candidate.code);
            const unitPrice = priceInfo.currentPrice;

            if (availableRealCash >= unitPrice && unitPrice > 0) {
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidate.code,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'KR',
                quantity: 1,
                reason: `[${bot.nickname}] 우선순위: 국내 1주 자동 매수`,
              });
              const fee = Math.round(unitPrice * 0.00015);
              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TORD_${Date.now()}`, unitPrice, unitPrice, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPrice, unitPrice, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] 1순위 국내 1주: ${candidate.name} (${unitPrice.toLocaleString()}원)`,
                `[🐍 Python 실전매수] 1순위 국내 1주: ${candidate.name}`,
                nowIso,
                bot.bot_id
              );
              realExecuted = true;
            }
          } else if (priority === 'US_UNIT') {
            // 2순위: 미국 주식 1주 온주 매수
            const candidate = TOP_US_STOCKS[Math.floor(Math.random() * TOP_US_STOCKS.length)];
            const priceInfo = await tossClient.getCurrentPrice(candidate.code);
            const unitPriceKrw = priceInfo.currentPrice;
            const unitPriceUsd = priceInfo.currentPriceUsd;

            if (availableRealCash >= unitPriceKrw && unitPriceKrw > 0) {
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidate.code,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'US',
                quantity: 1,
                reason: `[${bot.nickname}] 우선순위: 미국 1주 온주 자동 매수`,
              });
              const fee = Math.round(unitPriceKrw * 0.0025);
              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TORD_${Date.now()}`, unitPriceKrw, unitPriceKrw, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] 2순위 미국 1주 온주: ${candidate.name} ($${unitPriceUsd})`,
                `[🐍 Python 실전매수] 2순위 미국 1주 온주: ${candidate.name}`,
                nowIso,
                bot.bot_id
              );
              realExecuted = true;
            }
          } else if (priority === 'US_FRACTIONAL') {
            // 3순위: 미국 주식 소수점 금액 구매 ($10)
            const candidate = TOP_US_STOCKS[Math.floor(Math.random() * TOP_US_STOCKS.length)];
            const priceInfo = await tossClient.getCurrentPrice(candidate.code);
            const usdRate = priceInfo.exchangeRate || 1340;
            const targetUsd = 10;
            const targetKrw = Math.round(targetUsd * usdRate);

            if (availableRealCash >= targetKrw) {
              const orderRes = await pythonBridge.executeOrder({
                symbol: candidate.code,
                side: 'BUY',
                orderType: 'MARKET',
                market: 'US',
                orderAmount: targetUsd,
                reason: `[${bot.nickname}] 우선순위: 미국 소수점($${targetUsd}) 자동 매수`,
              });
              const fractionalQty = parseFloat((targetKrw / priceInfo.currentPrice).toFixed(6));
              const fee = Math.round(targetKrw * 0.0025);

              const insTrade = db.prepare(`
                INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TORD_${Date.now()}`, priceInfo.currentPrice, fractionalQty, targetKrw, nowIso);

              db.prepare(`
                INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
              `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TPOS_${Date.now()}`, fractionalQty, priceInfo.currentPrice, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

              db.prepare("UPDATE bots SET real_status_msg = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                `[🐍 Python 실전매수] 3순위 미국 소수점: ${candidate.name} $${targetUsd} (${fractionalQty}주)`,
                `[🐍 Python 실전매수] 3순위 미국 소수점: ${candidate.name}`,
                nowIso,
                bot.bot_id
              );
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
