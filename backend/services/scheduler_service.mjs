import { getDb } from '../db/index.mjs';
import { kiwoomClient, tossClient, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine } from './bot_service.mjs';
import { pythonBridge } from './trade_service.mjs';

export class SchedulerService {
  constructor() {
    this.timer = null;
    this.intervalMs = 7000;
  }

  start() {
    if (this.timer) return;
    console.log('[SchedulerService] 자율 트레이딩 봇 스케줄러 시작 (7초 주기)');
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

      const runningBots = db.prepare('SELECT * FROM bots WHERE is_running = 1').all();
      if (runningBots.length === 0) return;

      const marketStatus = kiwoomClient.getMarketStatus();
      const regimeInfo = await kiwoomClient.getMarketRegime();

      // 1. Check Active Positions for Exit Signals (Stop Loss, Take Profit, Time Exit)
      for (const bot of runningBots) {
        const positions = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND status = 'OPEN'").all(bot.bot_id);
        for (const pos of positions) {
          const priceInfo = await kiwoomClient.getCurrentPrice(pos.stock_code);
          const currentPrice = priceInfo.currentPrice;
          const returnPct = ((currentPrice - pos.avg_buy_price) / pos.avg_buy_price) * 100;

          let shouldSell = false;
          let sellReason = '';

          // 1. 손절 조건
          if (returnPct <= -bot.stop_loss_pct) {
            shouldSell = true;
            sellReason = `손절 도달 (-${bot.stop_loss_pct}% 설정, 현재 ${returnPct.toFixed(2)}%)`;
          }
          // 2. 익절 조건
          else if (returnPct >= bot.take_profit_pct) {
            shouldSell = true;
            sellReason = `익절 도달 (+${bot.take_profit_pct}% 설정, 현재 +${returnPct.toFixed(2)}%)`;
          }
          // 3. 래리 윌리엄스 15:15 장마감 시간청산 (오버나잇 방지)
          else if (bot.strategy_type === 'VOLATILITY_BREAKOUT' && marketStatus.phase === 'REGULAR') {
            const now = new Date();
            const nowMin = (now.getUTCHours() + 9) * 60 + now.getUTCMinutes();
            if (nowMin >= 15 * 60 + 15) {
              shouldSell = true;
              sellReason = '15:15 당일 장마감 동시호가 전 시간청산 (오버나잇 배제)';
            }
          }

          if (shouldSell) {
            if (pos.trade_mode === 'VIRTUAL') {
              await virtualEngine.executeVirtualSell({ positionId: pos.id, reason: sellReason });
            } else {
              // Real order via Python Executor
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
                const executionPrice = currentPrice;
                const sellAmount = Math.round(executionPrice * pos.qty);
                const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + (pos.buy_fee || 0);
                const profitKrw = (sellAmount - pos.buy_amount) - feeAndTax;
                const profitPct = parseFloat(((profitKrw / pos.buy_amount) * 100).toFixed(2));
                const nowIso = new Date().toISOString();

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
                db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                  `[🐍 Python 실전매도] ${pos.stock_name} ${pos.qty}주 @ ${executionPrice.toLocaleString()}원 (${profitPct >= 0 ? '+' : ''}${profitPct}%, 이유: ${sellReason})`,
                  nowIso,
                  bot.bot_id
                );
              } catch (err) {
                console.error('[SchedulerService] Python 실전 매도 에러:', err.message);
              }
            }
          }
        }
      }

      // If Market Regime is HOLD_CASH, skip new entry
      if (regimeInfo.regime === 'HOLD_CASH') {
        return;
      }

      // 2. Check Entry Signals for Bots with zero open positions
      for (const bot of runningBots) {
        const isReal = bot.trade_mode === 'REAL';
        const openCount = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND trade_mode = ? AND status = 'OPEN'").get(bot.bot_id, bot.trade_mode).cnt;
        if (openCount > 0) continue; // 포지션 보유 중이면 신규 진입 대기

        // Select candidate from ALL_CANDIDATE_STOCKS (국내 및 미국 소수점 종목)
        const candidate = ALL_CANDIDATE_STOCKS[Math.floor(Math.random() * ALL_CANDIDATE_STOCKS.length)];
        const priceInfo = await kiwoomClient.getCurrentPrice(candidate.code);

        // Simulation strategy condition trigger (대기 중 12% 확률로 진입 시그널 모의)
        const isEntryTriggered = Math.random() < 0.12;
        if (isEntryTriggered) {
          const nowIso = new Date().toISOString();

          if (!isReal) {
            // VIRTUAL 모드: 가상 예산 한도 내 집행
            try {
              const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
              const virtTotalBudget = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;
              const botCap = Math.floor(virtTotalBudget * (bot.allocation_ratio || 0.33));

              const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").get(bot.bot_id);
              const usedCap = usedCapRow ? usedCapRow.used : 0;
              const remainingCap = Math.max(0, botCap - usedCap);

              const perTradeBudget = Math.min(bot.virtual_krw || 0, remainingCap, Math.floor(botCap * 0.4));
              const minReq = candidate.isFractional ? 1000 : priceInfo.currentPrice;

              if (perTradeBudget >= minReq) {
                await virtualEngine.executeVirtualBuy({
                  botId: bot.bot_id,
                  stockCode: candidate.code,
                  stockName: candidate.name,
                  requestedBudget: perTradeBudget,
                });
              } else {
                db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                  `🚨 가상 배분 예산 한도 도달 (${botCap.toLocaleString()}원 중 ${usedCap.toLocaleString()}원 사용)`,
                  nowIso,
                  bot.bot_id
                );
              }
            } catch (err) {}
          } else {
            // REAL 모드: Python Core Executor를 통한 안전 실전 매매 집행
            try {
              const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
              const realTotalBudget = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;
              const botCap = Math.floor(realTotalBudget * (bot.allocation_ratio || 0.33));

              const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").get(bot.bot_id);
              const usedCap = usedCapRow ? usedCapRow.used : 0;
              const remainingCap = Math.max(0, botCap - usedCap);

              const tossBal = await tossClient.getAccountBalance();
              const availableRealCash = Math.min(tossBal.availableCash, remainingCap);

              if (candidate.isFractional) {
                // 미국 소수점 금액 주문 ($10)
                const targetUsd = 10;
                const usdRate = 1380;
                const targetKrw = targetUsd * usdRate;

                if (availableRealCash >= targetKrw) {
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: candidate.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'US',
                    orderAmount: targetUsd,
                    reason: `[${bot.nickname}] 미국 소수점 자동 매수`,
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

                  db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                    `[🐍 Python 실전매수] ${candidate.name} $${targetUsd} (${fractionalQty}주)`,
                    nowIso,
                    bot.bot_id
                  );
                }
              } else {
                // 국내 온주 주문
                const buyQty = Math.max(1, Math.floor(Math.min(availableRealCash, 500000) / priceInfo.currentPrice));
                const totalCost = buyQty * priceInfo.currentPrice;

                if (availableRealCash >= totalCost && totalCost > 0) {
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: candidate.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'KR',
                    quantity: buyQty,
                    reason: `[${bot.nickname}] 국내 온주 자동 매수`,
                  });
                  const fee = Math.round(totalCost * 0.00015);

                  const insTrade = db.prepare(`
                    INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
                    VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
                  `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TORD_${Date.now()}`, priceInfo.currentPrice, buyQty, totalCost, nowIso);

                  db.prepare(`
                    INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
                    VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
                  `).run(bot.bot_id, candidate.code, candidate.name, orderRes.orderId || `TPOS_${Date.now()}`, buyQty, priceInfo.currentPrice, totalCost, fee, insTrade.lastInsertRowid, nowIso);

                  db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                    `[🐍 Python 실전매수] ${candidate.name} ${buyQty}주 @ ${priceInfo.currentPrice.toLocaleString()}원`,
                    nowIso,
                    bot.bot_id
                  );
                }
              }
            } catch (rErr) {
              console.error('[SchedulerService] Python 실전 매수 에러:', rErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[SchedulerService] Error in runCycle:', err);
    }
  }
}

export const schedulerService = new SchedulerService();
