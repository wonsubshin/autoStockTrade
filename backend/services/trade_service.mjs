import { getDb } from '../db/index.mjs';
import { PROJECT_ROOT } from '../config/env.mjs';
import { kiwoomClient, tossClient, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine, BotService } from './bot_service.mjs';
import { PythonExecutorBridge } from '../common/python_executor_bridge.mjs';

export const pythonBridge = new PythonExecutorBridge(PROJECT_ROOT);

export class TradeService {
  static getTrades({ mode, botId, page = 1, limit = 50, status, search }) {
    const db = getDb();
    let whereClause = ' WHERE 1=1';
    const params = [];

    if (mode === 'REAL') {
      // 실전 모드는 가상 모의 주문(VORD)이 아닌 실제 계좌에서 집행된 실전 거래 내역만 엄격하게 조회
      whereClause += " AND trades.trade_mode = 'REAL' AND (trades.buy_order_no NOT LIKE 'VORD_%' OR trades.buy_order_no IS NULL)";
    } else if (mode && mode !== 'ALL') {
      whereClause += ' AND trades.trade_mode = ?';
      params.push(mode);
    }
    if (botId && botId !== 'ALL') {
      whereClause += ' AND trades.bot_id = ?';
      params.push(botId);
    }
    if (status && status !== 'ALL') {
      whereClause += ' AND trades.status = ?';
      params.push(status);
    }
    if (search && search.trim()) {
      whereClause += ' AND (trades.stock_name ILIKE ? OR trades.stock_code ILIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s);
    }

    // 1. 전체 건수 조회
    const countSql = `SELECT COUNT(*) as count FROM trades ${whereClause}`;
    const countRow = db.prepare(countSql).get(...params);
    const totalCount = Number(countRow?.count || 0);

    // 2. 페이징 데이터 조회 (봇 메타데이터 Left Join)
    const validLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const validPage = Math.max(1, Number(page) || 1);
    const offset = (validPage - 1) * validLimit;

    const dataSql = `
      SELECT trades.*, bots.name as bot_name, bots.nickname as bot_nickname
      FROM trades
      LEFT JOIN bots ON trades.bot_id = bots.bot_id
      ${whereClause}
      ORDER BY trades.id DESC
      LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(dataSql).all(...params, validLimit, offset);
    const totalPages = Math.ceil(totalCount / validLimit) || 1;

    return {
      trades: rows,
      pagination: {
        page: validPage,
        limit: validLimit,
        totalCount,
        totalPages,
      },
    };
  }

  static async getPositions({ mode, botId }) {
    const db = getDb();

    // 1. REAL 모드 요청 시: 토스증권 공식 실전 계좌의 실제 보유 종목(Holdings)을 100% 직접 연동하여 반환
    if (mode === 'REAL') {
      try {
        const tossBal = await tossClient.getAccountBalance();
        if (tossBal && !tossBal.isMock && Array.isArray(tossBal.holdings)) {
          // DB에 기록된 실전 포지션 메타데이터(진입일시, bot_id 등) 매칭
          const realDbPositions = db.prepare("SELECT * FROM bot_positions WHERE status = 'OPEN' AND trade_mode = 'REAL'").all();
          const realPositions = tossBal.holdings.map((h) => {
            const matched = realDbPositions.find((p) => p.stock_code === h.stockCode);
            return {
              id: matched?.id || `toss_${h.stockCode}`,
              bot_id: matched?.bot_id || (botId || 'toss_real_account'),
              trade_mode: 'REAL',
              stock_code: h.stockCode,
              stock_name: h.stockName,
              order_no: matched?.order_no || `TOSS_HOLDING_${h.stockCode}`,
              qty: h.qty,
              avg_buy_price: h.avgBuyPrice,
              currentPrice: h.currentPrice,
              buy_amount: Math.round(h.avgBuyPrice * h.qty),
              evalAmount: h.evalAmount,
              unrealizedProfitKrw: h.unrealizedProfitKrw,
              unrealizedProfitPct: h.unrealizedProfitPct,
              created_at: matched?.created_at || new Date().toISOString(),
              priceProvider: '토스증권(실전)',
            };
          });

          if (botId) {
            return realPositions.filter((p) => p.bot_id === botId);
          }
          return realPositions;
        }
      } catch (e) {
        console.warn('[TradeService] 실전 토스 보유 종목 조회 오류:', e.message);
      }
    }

    // 2. VIRTUAL 또는 ALL 모드 처리
    let query = "SELECT * FROM bot_positions WHERE status = 'OPEN'";
    const params = [];

    if (mode && mode !== 'ALL') {
      query += ' AND trade_mode = ?';
      params.push(mode);
    }
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    query += ' ORDER BY id DESC';

    const openPositions = db.prepare(query).all(...params);

    // 키움증권 실시간 호가/시세 기반 평가금액 산출
    const enriched = await Promise.all(
      openPositions.map(async (pos) => {
        const priceInfo = await kiwoomClient.getCurrentPrice(pos.stock_code);
        const currentPrice = priceInfo?.currentPrice || pos.avg_buy_price;
        const evalAmount = currentPrice * pos.qty;
        const unrealizedProfitKrw = evalAmount - pos.buy_amount - (pos.buy_fee || 0);
        const unrealizedProfitPct = pos.buy_amount > 0 ? parseFloat(((unrealizedProfitKrw / pos.buy_amount) * 100).toFixed(2)) : 0;

        return {
          ...pos,
          currentPrice,
          evalAmount,
          unrealizedProfitKrw,
          unrealizedProfitPct,
          priceProvider: '키움증권',
        };
      })
    );

    return enriched;
  }

  static async executeManualTrade({ botId, side, stockCode, positionId }) {
    const db = getDb();
    const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
    if (!bot) throw new Error('해당 봇을 찾을 수 없습니다.');

    const isReal = bot.trade_mode === 'REAL';
    const targetStock = ALL_CANDIDATE_STOCKS.find((s) => s.code === stockCode) || ALL_CANDIDATE_STOCKS[0];
    const nowIso = new Date().toISOString();

    if (side === 'BUY') {
      if (!isReal) {
        const result = await virtualEngine.executeVirtualBuy({
          botId,
          stockCode: targetStock.code,
          stockName: targetStock.name,
          requestedBudget: 2000000,
        });
        return {
          success: true,
          message: `[가상] 매수 체결: ${result.stockName} ${result.qty}주 (${targetStock.isFractional ? '미국 소수점' : '국내 온주'})`,
          result,
        };
      } else {
        // 실전 모드 매수 집행 (Python Core Executor 연동)
        const priceInfo = await kiwoomClient.getCurrentPrice(targetStock.code);
        const tossBal = await tossClient.getAccountBalance();
        const dynamicRealBudget = BotService.syncDynamicRealBudget(db, tossBal);
        const botCap = bot.real_allocated_capital || Math.floor(dynamicRealBudget * ((bot.real_allocation_ratio || 33.3) / 100));
        const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)").get(botId);
        const usedCap = usedCapRow ? usedCapRow.used : 0;
        const remainingCap = Math.max(0, botCap - usedCap);

        const availableCash = Math.min(tossBal.availableCash, remainingCap);

        // 구매 우선순위 확인
        const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
        let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
        if (prioRow && prioRow.value) {
          try {
            const parsed = JSON.parse(prioRow.value);
            if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
          } catch (e) {}
        }

        const isUs = targetStock.market === 'US';
        const preferUsUnit = priorityList.indexOf('US_UNIT') < priorityList.indexOf('US_FRACTIONAL');

        if (isUs) {
          const unitPriceKrw = priceInfo.currentPrice;

          // 우선순위가 미국 1주 온주 우선이고 잔고가 1주 매수에 충분한 경우: 미국 1주 온주 매수
          if (preferUsUnit && availableCash >= unitPriceKrw && unitPriceKrw > 0) {
            const orderRes = await pythonBridge.executeOrder({
              symbol: targetStock.code,
              side: 'BUY',
              orderType: 'MARKET',
              market: 'US',
              quantity: 1,
              reason: `웹 수동 미국 1주 온주 매수 ($${priceInfo.currentPriceUsd})`,
            });
            const fee = Math.round(unitPriceKrw * 0.0025);

            const insTrade = db.prepare(`
              INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
              VALUES (?, 'REAL', ?, ?, ?, ?, 1, ?, ?, 'HOLDING')
            `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TORD_${Date.now()}`, unitPriceKrw, unitPriceKrw, nowIso);

            db.prepare(`
              INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
              VALUES (?, 'REAL', ?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', ?)
            `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TPOS_${Date.now()}`, unitPriceKrw, unitPriceKrw, fee, insTrade.lastInsertRowid, nowIso);

            return {
              success: true,
              message: `[실전 Python] 미국 1주 온주 매수 성공: ${targetStock.name} ($${priceInfo.currentPriceUsd}, ${unitPriceKrw.toLocaleString()}원)`,
              orderRes,
            };
          } else {
            // 미국 소수점 금액 주문 ($1.00 ~ $10.00 가용 예산 맞춤 동적 산정)
            const usdRate = priceInfo.exchangeRate || 1345;
            const minKrw = Math.round(1.0 * usdRate);
            const affordableUsd = Math.floor(((availableCash * 0.96) / usdRate) * 100) / 100;
            const targetUsd = Math.min(10.0, affordableUsd);
            const targetKrw = Math.round(targetUsd * usdRate);

            if (targetUsd < 1.0 || availableCash < targetKrw) {
              throw new Error(`주문 가능 예수금 부족 (소수점 최소 $1 ≈ ${minKrw.toLocaleString()}원 필요, 잔여: ${availableCash.toLocaleString()}원)`);
            }

            const orderRes = await pythonBridge.executeOrder({
              symbol: targetStock.code,
              side: 'BUY',
              orderType: 'MARKET',
              market: 'US',
              orderAmount: targetUsd,
              reason: `웹 수동 미국 소수점 매수 ($${targetUsd.toFixed(2)})`,
            });

            const executionPrice = priceInfo.currentPrice;
            const fractionalQty = parseFloat((targetKrw / executionPrice).toFixed(6));
            const fee = Math.round(targetKrw * 0.0025);

            const insTrade = db.prepare(`
              INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
              VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
            `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TORD_${Date.now()}`, executionPrice, fractionalQty, targetKrw, nowIso);

            db.prepare(`
              INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
              VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
            `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TPOS_${Date.now()}`, fractionalQty, executionPrice, targetKrw, fee, insTrade.lastInsertRowid, nowIso);

            return {
              success: true,
              message: `[실전 Python] 미국 소수점 금액 매수 성공: ${targetStock.name} ($${targetUsd.toFixed(2)}, 약 ${fractionalQty}주)`,
              orderRes,
            };
          }
        } else {
          // 국내 주식 1주 온주 주문
          const buyQty = 1;
          const totalCost = buyQty * priceInfo.currentPrice;

          if (availableCash < totalCost) {
            throw new Error(`주문 가능 예수금 부족 (필요: ${totalCost.toLocaleString()}원, 잔여: ${availableCash.toLocaleString()}원)`);
          }

          const orderRes = await pythonBridge.executeOrder({
            symbol: targetStock.code,
            side: 'BUY',
            orderType: 'MARKET',
            market: 'KR',
            quantity: buyQty,
            reason: `웹 수동 국내 1주 온주 매수 (${buyQty}주)`,
          });

          const executionPrice = priceInfo.currentPrice;
          const fee = Math.round(totalCost * 0.00015);

          const insTrade = db.prepare(`
            INSERT INTO trades (bot_id, trade_mode, stock_code, stock_name, buy_order_no, buy_price, buy_qty, buy_amount, buy_date, status)
            VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, 'HOLDING')
          `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TORD_${Date.now()}`, executionPrice, buyQty, totalCost, nowIso);

          db.prepare(`
            INSERT INTO bot_positions (bot_id, trade_mode, stock_code, stock_name, order_no, qty, avg_buy_price, buy_amount, buy_fee, trade_id, status, created_at)
            VALUES (?, 'REAL', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
          `).run(botId, targetStock.code, targetStock.name, orderRes.orderId || `TPOS_${Date.now()}`, buyQty, executionPrice, totalCost, fee, insTrade.lastInsertRowid, nowIso);

          return {
            success: true,
            message: `[실전 Python] 국내 1주 온주 매수 성공: ${targetStock.name} ${buyQty}주`,
            orderRes,
          };
        }
      }
    } else if (side === 'SELL') {
      if (!isReal) {
        if (!positionId) {
          const openPos = db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN' ORDER BY id DESC LIMIT 1").get(botId);
          if (!openPos) throw new Error('청산할 가상 포지션이 없습니다.');
          positionId = openPos.id;
        }
        const result = await virtualEngine.executeVirtualSell({ positionId, reason: '사용자 수동 청산' });
        return {
          success: true,
          message: `[가상] 매도 완료: ${result.stockName} (손익: ${result.profitKrw.toLocaleString()}원)`,
          result,
        };
      } else {
        const targetPos = positionId
          ? db.prepare('SELECT * FROM bot_positions WHERE id = ?').get(positionId)
          : db.prepare("SELECT * FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' ORDER BY id DESC LIMIT 1").get(botId);

        if (!targetPos) throw new Error('청산할 실전 포지션이 없습니다.');

        const isKr = /^[0-9]/.test(targetPos.stock_code);
        const orderRes = await pythonBridge.executeOrder({
          symbol: targetPos.stock_code,
          side: 'SELL',
          orderType: 'MARKET',
          market: isKr ? 'KR' : 'US',
          quantity: targetPos.qty,
          reason: '웹 수동 실전 매도 청산',
        });

        const priceInfo = await kiwoomClient.getCurrentPrice(targetPos.stock_code);
        const executionPrice = priceInfo.currentPrice;
        const sellAmount = Math.round(executionPrice * targetPos.qty);
        const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + (targetPos.buy_fee || 0);
        const profitKrw = (sellAmount - targetPos.buy_amount) - feeAndTax;
        const profitPct = parseFloat(((profitKrw / targetPos.buy_amount) * 100).toFixed(2));

        db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, targetPos.id);
        if (targetPos.trade_id) {
          db.prepare(`
            UPDATE trades
            SET sell_order_no = ?, sell_price = ?, sell_qty = ?, sell_amount = ?, sell_date = ?, fee_and_tax = ?, profit_krw = ?, profit_pct = ?, status = 'CLOSED'
            WHERE id = ?
          `).run(
            orderRes.orderId || `TORD_S_${Date.now()}`,
            executionPrice,
            targetPos.qty,
            sellAmount,
            nowIso,
            feeAndTax,
            profitKrw,
            profitPct,
            targetPos.trade_id
          );
        }

        return {
          success: true,
          message: `[실전 Python] 매도 청산 완료: ${targetPos.stock_name} ${targetPos.qty}주 (손익: ${profitKrw.toLocaleString()}원)`,
          orderRes,
        };
      }
    }

    throw new Error('side는 BUY 또는 SELL이어야 합니다.');
  }

  static getStats({ mode = 'REAL', period = 'daily' }) {
    const db = getDb();
    const baseDate = '2026-10-01';

    const toKstDateString = (dateInput = new Date()) => {
      const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
      if (isNaN(d.getTime())) return null;
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    };

    const getWeekKeyFromDateStr = (ymd) => {
      const [y, m, day] = ymd.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1, day));
      const oneJan = new Date(Date.UTC(y, 0, 1));
      const weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getUTCDay() + 1) / 7);
      return `${y}-W${String(weekNum).padStart(2, '0')}`;
    };

    // 통계는 가상 매매를 완전히 제외하고 오직 실전 매매(REAL) 데이터만 엄격하게 집계 (모의 주문 VORD 제외)
    let sql = "SELECT * FROM trades WHERE status = 'CLOSED' AND trade_mode = 'REAL' AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL) AND buy_date >= ? ORDER BY buy_date ASC";
    const params = [baseDate];

    const trades = db.prepare(sql).all(...params);

    const periodMap = new Map();
    const stockContribMap = new Map();

    // 거래가 없는 날(또는 주/월)도 모두 0으로 표기되도록 기준일(baseDate)부터 오늘(KST)까지 빈 슬롯을 0으로 사전 생성
    const todayKst = toKstDateString(new Date()) || baseDate;
    const [startY, startM, startD] = baseDate.split('-').map(Number);
    const [endY, endM, endD] = todayKst.split('-').map(Number);
    const curDate = new Date(Date.UTC(startY, startM - 1, startD));
    const endDateObj = new Date(Date.UTC(endY, endM - 1, endD));

    while (curDate <= endDateObj) {
      const y = curDate.getUTCFullYear();
      const m = String(curDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(curDate.getUTCDate()).padStart(2, '0');
      const ymd = `${y}-${m}-${d}`;

      let slotKey = ymd;
      if (period === 'monthly') {
        slotKey = `${y}-${m}`;
      } else if (period === 'weekly') {
        slotKey = getWeekKeyFromDateStr(ymd);
      }

      if (!periodMap.has(slotKey)) {
        periodMap.set(slotKey, {
          period: slotKey,
          profitKrw: 0,
          tradesCount: 0,
          winCount: 0,
        });
      }

      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    for (const t of trades) {
      const tradeYmd = toKstDateString(t.sell_date || t.buy_date);
      if (!tradeYmd) continue;

      let key = tradeYmd;
      if (period === 'monthly') {
        key = tradeYmd.slice(0, 7);
      } else if (period === 'weekly') {
        key = getWeekKeyFromDateStr(tradeYmd);
      }

      if (!periodMap.has(key)) {
        periodMap.set(key, { period: key, profitKrw: 0, tradesCount: 0, winCount: 0 });
      }
      const pObj = periodMap.get(key);
      pObj.profitKrw += t.profit_krw || 0;
      pObj.tradesCount += 1;
      if ((t.profit_krw || 0) > 0) pObj.winCount += 1;

      const sKey = `${t.stock_code}_${t.stock_name}`;
      if (!stockContribMap.has(sKey)) {
        stockContribMap.set(sKey, {
          stockCode: t.stock_code,
          stockName: t.stock_name,
          totalProfitKrw: 0,
          tradesCount: 0,
          wins: 0,
        });
      }
      const sObj = stockContribMap.get(sKey);
      sObj.totalProfitKrw += t.profit_krw || 0;
      sObj.tradesCount += 1;
      if ((t.profit_krw || 0) > 0) sObj.wins += 1;
    }

    let runningProfit = 0;
    const timeline = Array.from(periodMap.values()).map((p) => {
      runningProfit += p.profitKrw || 0;
      return {
        ...p,
        profitKrw: p.profitKrw || 0,
        cumulativeProfitKrw: runningProfit,
        tradesCount: p.tradesCount || 0,
        winRate: p.tradesCount > 0 ? parseFloat(((p.winCount / p.tradesCount) * 100).toFixed(1)) : 0,
      };
    });

    const stockRanking = Array.from(stockContribMap.values())
      .map((s) => ({
        ...s,
        winRate: s.tradesCount > 0 ? parseFloat(((s.wins / s.tradesCount) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalProfitKrw - a.totalProfitKrw);

    const totalProfit = trades.reduce((sum, t) => sum + (t.profit_krw || 0), 0);
    const winCount = trades.filter((t) => (t.profit_krw || 0) > 0).length;
    const totalTrades = trades.length;

    return {
      baseDate,
      totalProfitKrw: totalProfit,
      totalTrades,
      winRate: totalTrades > 0 ? parseFloat(((winCount / totalTrades) * 100).toFixed(1)) : 0,
      timeline,
      stockRanking,
    };
  }

  static getLeaderboard() {
    return virtualEngine.getLeaderboard();
  }

  static async runFastReplayTest(seedCapital) {
    return await virtualEngine.runFastReplayTest(seedCapital);
  }

  static promoteToReal(botId) {
    return virtualEngine.promoteToReal(botId);
  }
}
