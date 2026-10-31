import { getDb } from '../db/index.mjs';
import { kiwoomClient, tossClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
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
          // 4. 가상 모드(VIRTUAL) 환경 시 전략 기반 동적 트레일링 익절 / 청산
          else if (pos.trade_mode === 'VIRTUAL') {
            const holdingTimeMs = Date.now() - new Date(pos.created_at).getTime();
            // 포지션 진입 후 25초 이상 경과 시 목표 수익(+0.5% 이상) 또는 리스크 관리(-1.0% 이하) 도달 시 익절/손절 청산
            if (holdingTimeMs > 25000 && (returnPct >= 0.5 || returnPct <= -1.0)) {
              shouldSell = true;
              sellReason = returnPct >= 0.5
                ? `가상 단기 목표 수익 달성 (+${returnPct.toFixed(2)}%)`
                : `가상 리스크 관리 조기 손절 (${returnPct.toFixed(2)}%)`;
            } else if (holdingTimeMs > 75000) {
              // 75초 이상 경과 시 포지션 순환 리밸런싱 청산
              shouldSell = true;
              sellReason = `가상 포지션 순환 리밸런싱 (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`;
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

      // 2. Check Entry Signals for Bots with room for positions (최대 3개 종목 분산 보유)
      for (const bot of runningBots) {
        const isReal = bot.trade_mode === 'REAL';
        const openCount = db.prepare("SELECT COUNT(*) as cnt FROM bot_positions WHERE bot_id = ? AND trade_mode = ? AND status = 'OPEN'").get(bot.bot_id, bot.trade_mode).cnt;
        if (openCount >= 3) continue; // 최대 3개 포지션까지 분산 보유 허용

        // 0건일 때는 70% 높은 확률로 빠른 진입, 이미 보유 중일 때는 25% 추가 분산 진입
        const entryProbability = openCount === 0 ? 0.70 : 0.25;
        const isEntryTriggered = Math.random() < entryProbability;
        if (isEntryTriggered) {
          const nowIso = new Date().toISOString();

          // 1. 사용자 설정 구매 우선순위 로드 (기본: 1.국내1주 -> 2.미국1주 -> 3.미국소수점)
          const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
          let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
          if (prioRow && prioRow.value) {
            try {
              const parsed = JSON.parse(prioRow.value);
              if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
            } catch (e) {}
          }

          if (!isReal) {
            // VIRTUAL 모드: 가상 예산 한도 내에서 우선순위에 따른 순차 매수 집행
            try {
              const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
              const virtTotalBudget = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;
              const botCap = Math.floor(virtTotalBudget * (bot.allocation_ratio || 0.33));

              const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'").get(bot.bot_id);
              const usedCap = usedCapRow ? usedCapRow.used : 0;
              const remainingCap = Math.max(0, botCap - usedCap);
              const perTradeBudget = Math.min(bot.virtual_krw || 0, remainingCap, Math.floor(botCap * 0.4));

              let virtualExecuted = false;
              for (const priority of priorityList) {
                if (virtualExecuted) break;

                if (priority === 'KR_UNIT') {
                  const unheldKr = TOP_KR_STOCKS.filter((s) => !db.prepare("SELECT id FROM bot_positions WHERE bot_id = ? AND stock_code = ? AND status = 'OPEN'").get(bot.bot_id, s.code));
                  if (unheldKr.length === 0) continue;
                  const candidate = unheldKr[Math.floor(Math.random() * unheldKr.length)];
                  const priceInfo = await kiwoomClient.getCurrentPrice(candidate.code);
                  const unitPrice = priceInfo.currentPrice;

                  if (perTradeBudget >= unitPrice) {
                    await virtualEngine.executeVirtualBuy({
                      botId: bot.bot_id,
                      stockCode: candidate.code,
                      stockName: candidate.name,
                      requestedBudget: unitPrice,
                      isFractional: false,
                    });
                    virtualExecuted = true;
                  }
                } else if (priority === 'US_UNIT') {
                  const unheldUs = TOP_US_STOCKS.filter((s) => !db.prepare("SELECT id FROM bot_positions WHERE bot_id = ? AND stock_code = ? AND status = 'OPEN'").get(bot.bot_id, s.code));
                  if (unheldUs.length === 0) continue;
                  const candidate = unheldUs[Math.floor(Math.random() * unheldUs.length)];
                  const priceInfo = await tossClient.getCurrentPrice(candidate.code);
                  const unitPriceKrw = priceInfo.currentPrice;

                  if (perTradeBudget >= unitPriceKrw) {
                    await virtualEngine.executeVirtualBuy({
                      botId: bot.bot_id,
                      stockCode: candidate.code,
                      stockName: candidate.name,
                      requestedBudget: unitPriceKrw,
                      isFractional: false,
                    });
                    virtualExecuted = true;
                  }
                } else if (priority === 'US_FRACTIONAL') {
                  const unheldUs = TOP_US_STOCKS.filter((s) => !db.prepare("SELECT id FROM bot_positions WHERE bot_id = ? AND stock_code = ? AND status = 'OPEN'").get(bot.bot_id, s.code));
                  if (unheldUs.length === 0) continue;
                  const candidate = unheldUs[Math.floor(Math.random() * unheldUs.length)];
                  const priceInfo = await tossClient.getCurrentPrice(candidate.code);
                  const usdRate = priceInfo.exchangeRate || 1340;
                  const targetKrw = Math.round(10 * usdRate);
                  const budget = Math.min(perTradeBudget, targetKrw);

                  if (budget >= 1000) {
                    await virtualEngine.executeVirtualBuy({
                      botId: bot.bot_id,
                      stockCode: candidate.code,
                      stockName: candidate.name,
                      requestedBudget: budget,
                      isFractional: true,
                    });
                    virtualExecuted = true;
                  }
                }
              }

              if (!virtualExecuted) {
                db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                  `🚨 가상 배분 예산 한도 도달 (${botCap.toLocaleString()}원 중 ${usedCap.toLocaleString()}원 사용)`,
                  nowIso,
                  bot.bot_id
                );
              }
            } catch (err) {}
          } else {
            // REAL 모드: Python Core Executor를 통한 우선순위 순차 실전 집행
            try {
              const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
              const realTotalBudget = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;
              const botCap = Math.floor(realTotalBudget * (bot.allocation_ratio || 0.33));

              const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'").get(bot.bot_id);
              const usedCap = usedCapRow ? usedCapRow.used : 0;
              const remainingCap = Math.max(0, botCap - usedCap);

              const tossBal = await tossClient.getAccountBalance();
              const availableRealCash = Math.min(tossBal.availableCash, remainingCap);

              let realExecuted = false;
              for (const priority of priorityList) {
                if (realExecuted) break;

                if (priority === 'KR_UNIT') {
                  // 1. 국내 주식 1주 온주 구매
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

                    db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                      `[🐍 Python 실전매수] 1순위 국내 1주: ${candidate.name} (${unitPrice.toLocaleString()}원)`,
                      nowIso,
                      bot.bot_id
                    );
                    realExecuted = true;
                  }
                } else if (priority === 'US_UNIT') {
                  // 2. 미국 주식 1주 온주 구매
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

                    db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                      `[🐍 Python 실전매수] 2순위 미국 1주 온주: ${candidate.name} ($${unitPriceUsd})`,
                      nowIso,
                      bot.bot_id
                    );
                    realExecuted = true;
                  }
                } else if (priority === 'US_FRACTIONAL') {
                  // 3. 미국 주식 소수점 금액 구매 ($10)
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

                    db.prepare("UPDATE bots SET last_status_msg = ?, updated_at = ? WHERE bot_id = ?").run(
                      `[🐍 Python 실전매수] 3순위 미국 소수점: ${candidate.name} $${targetUsd} (${fractionalQty}주)`,
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
    } catch (err) {
      console.error('[SchedulerService] Error in runCycle:', err);
    }
  }
}

export const schedulerService = new SchedulerService();

