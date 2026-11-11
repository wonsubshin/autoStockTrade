import { getDb } from '../db/index.mjs';
import { PROJECT_ROOT } from '../config/env.mjs';
import { kiwoomClient, tossClient, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { virtualEngine, BotService } from './bot_service.mjs';
import { PythonExecutorBridge } from '../common/python_executor_bridge.mjs';
import { evaluatePureQuantAlgorithm } from '../common/quant_algorithms.mjs';

export const pythonBridge = new PythonExecutorBridge(PROJECT_ROOT);

export class TradeService {
  static getTrades({ mode, botId, page = 1, limit = 50, status, search, profitType }) {
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
    if (profitType === 'PROFIT') {
      whereClause += ' AND trades.profit_krw > 0';
    } else if (profitType === 'LOSS') {
      whereClause += ' AND trades.profit_krw < 0';
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

    // 국내(키움증권) 및 해외(토스증권) 실시간 호가/시세 기반 평가금액 산출
    const enriched = await Promise.all(
      openPositions.map(async (pos) => {
        const isUs = /^[A-Za-z.]+$/.test(pos.stock_code);
        const priceInfo = isUs
          ? await tossClient.getCurrentPrice(pos.stock_code)
          : await kiwoomClient.getCurrentPrice(pos.stock_code);
        const currentPrice = Number(priceInfo?.currentPrice || pos.avg_buy_price || 0);
        const qty = Number(pos.qty || 0);
        const buyAmount = Number(pos.buy_amount || 0);
        const buyFee = Number(pos.buy_fee || 0);
        const evalAmount = Math.round(currentPrice * qty);
        const unrealizedProfitKrw = evalAmount - buyAmount - buyFee;
        const unrealizedProfitPct = buyAmount > 0 ? parseFloat(((unrealizedProfitKrw / buyAmount) * 100).toFixed(2)) : 0;

        return {
          ...pos,
          qty,
          avg_buy_price: Number(pos.avg_buy_price || 0),
          buy_amount: buyAmount,
          buy_fee: buyFee,
          currentPrice,
          evalAmount,
          unrealizedProfitKrw,
          unrealizedProfitPct,
          priceProvider: isUs ? '토스증권' : '키움증권',
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
        const isUs = targetStock.market === 'US';
        const priceInfo = isUs
          ? await tossClient.getCurrentPrice(targetStock.code)
          : await kiwoomClient.getCurrentPrice(targetStock.code);
        const tossBal = await tossClient.getAccountBalance();
        const dynamicRealBudget = BotService.syncDynamicRealBudget(db, tossBal);
        const botCap = Number(bot.real_allocated_capital || Math.floor(dynamicRealBudget * ((Number(bot.real_allocation_ratio || 33.3)) / 100)));
        const usedCapRow = db.prepare("SELECT COALESCE(SUM(buy_amount), 0) as used FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)").get(botId);
        const usedCap = usedCapRow ? Number(usedCapRow.used || 0) : 0;
        const remainingCap = Math.max(0, botCap - usedCap);

        const availableCash = Math.min(Number(tossBal.availableCash || 0), remainingCap);

        // 구매 우선순위 확인
        const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
        let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
        if (prioRow && prioRow.value) {
          try {
            const parsed = JSON.parse(prioRow.value);
            if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
          } catch (e) {}
        }

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
            // 미국 소수점 금액 주문 ($1.00 ~ $10.00 가용 달러/원화 예산 맞춤 동적 산정)
            const usdRate = priceInfo.exchangeRate || tossBal.usdRate || 1345;
            const actualUsd = Number(tossBal.availableUsd || 0);
            const botRemainingUsd = remainingCap / usdRate;
            const cashBasedUsd = (availableCash * 0.96) / usdRate;
            const effectiveUsdPool = actualUsd >= 1.0 ? Math.min(actualUsd * 0.98, Math.max(1.0, botRemainingUsd)) : cashBasedUsd;
            const affordableUsd = Math.floor(effectiveUsdPool * 100) / 100;
            const targetUsd = Math.min(10.0, affordableUsd);
            const targetKrw = Math.round(targetUsd * usdRate);

            if (targetUsd < 1.0) {
              throw new Error(`주문 가능 달러/예수금 부족 (소수점 최소 $1.00 필요, 현재 주문가능 달러: $${actualUsd.toFixed(2)}, 원화: ${availableCash.toLocaleString()}원)`);
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
        const posQty = Number(targetPos.qty || 0);
        const posBuyAmt = Number(targetPos.buy_amount || 0);
        const orderRes = await pythonBridge.executeOrder({
          symbol: targetPos.stock_code,
          side: 'SELL',
          orderType: 'MARKET',
          market: isKr ? 'KR' : 'US',
          quantity: posQty,
          reason: '웹 수동 실전 매도 청산',
        });

        const priceInfo = isKr
          ? await kiwoomClient.getCurrentPrice(targetPos.stock_code)
          : await tossClient.getCurrentPrice(targetPos.stock_code);
        const executionPrice = Number(priceInfo?.currentPrice || targetPos.avg_buy_price || 0);
        const sellAmount = Math.round(executionPrice * posQty);
        const feeAndTax = Math.round(sellAmount * (0.00015 + 0.0018)) + Number(targetPos.buy_fee || 0);
        const profitKrw = (sellAmount - posBuyAmt) - feeAndTax;
        const profitPct = posBuyAmt > 0 ? parseFloat(((profitKrw / posBuyAmt) * 100).toFixed(2)) : 0;

        db.prepare("UPDATE bot_positions SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(nowIso, targetPos.id);
        if (targetPos.trade_id) {
          db.prepare(`
            UPDATE trades
            SET sell_order_no = ?, sell_price = ?, sell_qty = ?, sell_amount = ?, sell_date = ?, fee_and_tax = ?, profit_krw = ?, profit_pct = ?, status = 'CLOSED'
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

    // 통계는 기본값(REAL) 시 가상 매매를 제외하고 실전 매매(REAL) 데이터만 엄격하게 집계하되, VIRTUAL/ALL 요청 시 해당 모드로 조회 지원
    let sql = "SELECT * FROM trades WHERE status = 'CLOSED' AND buy_date >= ?";
    const params = [baseDate];
    if (mode === 'VIRTUAL') {
      sql += " AND trade_mode = 'VIRTUAL'";
    } else if (mode !== 'ALL') {
      sql += " AND trade_mode = 'REAL' AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)";
    }
    sql += ' ORDER BY buy_date ASC';

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

      const profitKrw = isNaN(Number(t.profit_krw)) ? 0 : Math.round(Number(t.profit_krw));

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
      pObj.profitKrw += profitKrw;
      pObj.tradesCount += 1;
      if (profitKrw > 0) pObj.winCount += 1;

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
      sObj.totalProfitKrw += profitKrw;
      sObj.tradesCount += 1;
      if (profitKrw > 0) sObj.wins += 1;
    }

    let runningProfit = 0;
    const timeline = Array.from(periodMap.values()).map((p) => {
      const pProfit = Number(p.profitKrw) || 0;
      runningProfit += pProfit;
      return {
        ...p,
        profitKrw: pProfit,
        cumulativeProfitKrw: runningProfit,
        tradesCount: p.tradesCount || 0,
        winRate: p.tradesCount > 0 ? parseFloat(((p.winCount / p.tradesCount) * 100).toFixed(1)) : 0,
      };
    });

    const stockRanking = Array.from(stockContribMap.values())
      .map((s) => ({
        ...s,
        totalProfitKrw: Number(s.totalProfitKrw) || 0,
        winRate: s.tradesCount > 0 ? parseFloat(((s.wins / s.tradesCount) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalProfitKrw - a.totalProfitKrw);

    const totalProfit = trades.reduce((sum, t) => sum + (isNaN(Number(t.profit_krw)) ? 0 : Math.round(Number(t.profit_krw))), 0);
    const winCount = trades.filter((t) => Number(t.profit_krw || 0) > 0).length;
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

  /**
   * [하이브리드(Flash + Pro) 기반 거래 여부 최종 판단 엔진]
   * - 30분 단위 Flash 종합 판단(단기 속보 뉴스 및 수급)과
   * - 1시간 단위 Pro 심층 분석(거시 지표, 20MA/60MA 이평선 괴리율, 중기 추세)의
   * 로컬 DB 결과를 불러와 크로스체크(Cross-check/Merge) 후 최종 매수/매도/관망(HOLD) 결정
   * 
   * [서킷 브레이커 & Fallback]
   * - LLM 장애 또는 서킷 브레이커 OPEN 감지 시 fallbackMode = true 플래그를 설정하여
   *   실전 매매 엔진이 순수 퀀트 알고리즘(evaluatePureQuantAlgorithm) 50% 비중 분기 모드로 자동 전환되도록 유도
   */
  static evaluateWithHybridLLM(candidates = ALL_CANDIDATE_STOCKS, { db = getDb(), isCircuitOpen = false } = {}) {
    if (!db) return [];

    try {
      // 1. DB에서 최신 Flash(30분) 및 최신 Pro(1시간) 결정 조회
      let flashRows = [];
      let proRows = [];
      try {
        flashRows = db.prepare(`
          SELECT * FROM ai_trade_decisions
          WHERE model_type = 'FLASH'
            AND id IN (
              SELECT MAX(id) FROM ai_trade_decisions
              WHERE model_type = 'FLASH'
              GROUP BY symbol
            )
        `).all() || [];
      } catch (e) {}

      try {
        proRows = db.prepare(`
          SELECT * FROM ai_trade_decisions
          WHERE model_type = 'PRO'
            AND id IN (
              SELECT MAX(id) FROM ai_trade_decisions
              WHERE model_type = 'PRO'
              GROUP BY symbol
            )
        `).all() || [];
      } catch (e) {}

      // 서킷 브레이커 OPEN 상태이거나 DB에 결정이 전무한 경우 순수 퀀트 Fallback 모드 시그널 반환
      const isFallback = isCircuitOpen || (flashRows.length === 0 && proRows.length === 0);

      // 아직 model_type 구분이 축적되지 않은 초기 상태 시 전체 레코드 폴백
      if (flashRows.length === 0 && proRows.length === 0) {
        try {
          const fallbackRows = db.prepare(`
            SELECT * FROM ai_trade_decisions
            WHERE id IN (
              SELECT MAX(id) FROM ai_trade_decisions
              GROUP BY symbol
            )
          `).all() || [];
          flashRows = fallbackRows;
          proRows = fallbackRows;
        } catch (e) {}
      } else if (flashRows.length === 0 && proRows.length > 0) {
        flashRows = proRows;
      } else if (proRows.length === 0 && flashRows.length > 0) {
        proRows = flashRows;
      }

      const flashMap = new Map(flashRows.map((r) => [r.symbol, r]));
      const proMap = new Map(proRows.map((r) => [r.symbol, r]));

      const targetList = Array.isArray(candidates) && candidates.length > 0
        ? candidates
        : ALL_CANDIDATE_STOCKS;

      const hybridDecisions = targetList.map((target) => {
        const code = target.code || target.symbol;
        const name = target.name || target.stock_name || code;
        const market = target.market || (code.length === 6 && /^\d+$/.test(code) ? 'KR' : 'US');
        const isFractional = target.isFractional !== undefined ? !!target.isFractional : market === 'US';

        const flash = flashMap.get(code) || null;
        const pro = proMap.get(code) || null;

        // 서킷 브레이커 OPEN 또는 데이터 부재 시 순수 퀀트 Fallback 모드 객체 생성
        if (isFallback || (!flash && !pro)) {
          return {
            symbol: code,
            name,
            market,
            action: 'HOLD', // LLM 신호 자체는 관망이나 fallbackMode = true로 실전 엔진에 순수 퀀트 분기 유도
            confidence: 50,
            sentimentScore: 0,
            reasoning: isCircuitOpen
              ? '🛡️ LLM 서킷 브레이커(OPEN) 발동으로 순수 퀀트 알고리즘 50% 분할 매매 Fallback 모드가 적용됩니다.'
              : 'Flash 및 Pro 분석 데이터 수집 대기 중 (보수적 관망)',
            related_news: '',
            consensusType: isCircuitOpen ? 'CIRCUIT_OPEN_FALLBACK' : 'NO_DATA_HOLD',
            isFractional,
            fallbackMode: true,
            flashDecision: null,
            proDecision: null,
            evaluatedAt: new Date().toISOString(),
          };
        }

        // 한쪽만 있는 경우 해당 모델 기준으로 안전 할인 적용
        if (flash && !pro) {
          return {
            symbol: code,
            name,
            market,
            action: flash.action,
            confidence: Math.max(40, Number(flash.confidence || 50) - 5),
            sentimentScore: Number(flash.sentiment_score || 0),
            reasoning: `[Flash 30분 단독 시그널 | Pro 대기] ${flash.reasoning || ''}`,
            related_news: flash.related_news || '',
            consensusType: 'FLASH_ONLY',
            isFractional,
            fallbackMode: false,
            flashDecision: flash,
            proDecision: null,
            evaluatedAt: new Date().toISOString(),
          };
        }

        if (!flash && pro) {
          return {
            symbol: code,
            name,
            market,
            action: pro.action,
            confidence: Math.max(40, Number(pro.confidence || 50) - 5),
            sentimentScore: Number(pro.sentiment_score || 0),
            reasoning: `[Pro 1시간 심층 단독 시그널 | Flash 대기] ${pro.reasoning || ''}`,
            related_news: pro.related_news || '',
            consensusType: 'PRO_ONLY',
            isFractional,
            fallbackMode: false,
            flashDecision: null,
            proDecision: pro,
            evaluatedAt: new Date().toISOString(),
          };
        }

        const flashAction = String(flash.action || 'HOLD').toUpperCase();
        const proAction = String(pro.action || 'HOLD').toUpperCase();
        const flashConf = Number(flash.confidence || 50);
        const proConf = Number(pro.confidence || 50);
        const flashSent = Number(flash.sentiment_score || 0);
        const proSent = Number(pro.sentiment_score || 0);

        let finalAction = 'HOLD';
        let hybridConfidence = 50;
        let hybridSentiment = 0;
        let consensusType = 'NEUTRAL_HOLD';
        let reasoning = '';
        const relatedNews = flash.related_news || pro.related_news || '';

        // =========================================================================
        // [1] 방어적 긴급 매도 (Defensive SELL - 자본 보호 최우선 합집합 원칙)
        // =========================================================================
        if (flashAction === 'SELL' && proAction === 'SELL') {
          finalAction = 'SELL';
          hybridConfidence = Math.min(100, Math.max(flashConf, proConf) + 5);
          hybridSentiment = Math.min(flashSent, proSent);
          consensusType = 'CONSENSUS_SELL';
          reasoning = `🚨 [Flash 30분 속보 악재 ⨉ Pro 1시간 거시 추세 이탈 만장일치 매도] Flash: ${flash.reasoning} | Pro: ${pro.reasoning}`;
        } else if (flashAction === 'SELL' && proAction !== 'SELL') {
          finalAction = 'SELL';
          hybridConfidence = Math.max(65, Math.round(flashConf * 0.7 + proConf * 0.3));
          hybridSentiment = Math.min(flashSent, -3.0);
          consensusType = 'FLASH_DEFENSIVE_SELL';
          reasoning = `⚡ [Flash 30분 단기 악재 긴급 매도 권고] ${flash.reasoning} (Pro 심층 의견: ${proAction}, 중기 이평선 지지 여부와 별개로 단기 악재 리스크 선제 차단)`;
        } else if (proAction === 'SELL' && flashAction !== 'SELL') {
          finalAction = 'SELL';
          hybridConfidence = Math.max(65, Math.round(proConf * 0.75 + flashConf * 0.25));
          hybridSentiment = Math.min(proSent, -3.0);
          consensusType = 'PRO_MACRO_SELL';
          reasoning = `🏛️ [Pro 1시간 거시 퀀트 추세 붕괴 매도 권고] ${pro.reasoning} (Flash 단기 의견: ${flashAction}, 단기 반등 소음 배제 및 중기 리스크 방어 청산)`;
        }
        // =========================================================================
        // [2] 보수적 교집합 매수 (Conservative Consensus BUY - 만장일치 우선 원칙)
        // =========================================================================
        else if (flashAction === 'BUY' && proAction === 'BUY') {
          finalAction = 'BUY';
          hybridConfidence = Math.min(100, Math.round(flashConf * 0.45 + proConf * 0.55) + 5);
          hybridSentiment = parseFloat((flashSent * 0.4 + proSent * 0.6).toFixed(1));
          consensusType = 'CONSENSUS_BUY';
          reasoning = `💎 [Flash 30분 속보 호재 ⨉ Pro 1시간 거시 심층 퀀트 만장일치 매수] Flash: ${flash.reasoning} | Pro: ${pro.reasoning}`;
        }
        // =========================================================================
        // [3] 의견 엇갈림 (Divergence - 한쪽 BUY, 다른쪽 HOLD)
        // =========================================================================
        else if (flashAction === 'BUY' && proAction === 'HOLD') {
          finalAction = 'HOLD';
          hybridConfidence = Math.round(flashConf * 0.4 + proConf * 0.6);
          hybridSentiment = parseFloat((flashSent * 0.4 + proSent * 0.6).toFixed(1));
          consensusType = 'FLASH_ALONE_HOLD';
          reasoning = `⚠️ [단기 호재 vs 거시 관망 엇갈림] Flash 30분 속보 호재(확신도 ${flashConf}%)가 포착되었으나, Pro 1시간 심층 분석(확신도 ${proConf}%)이 거시 관망(HOLD)을 권고하여 보수적 자본 보호를 위해 신규 매수를 유보하고 관망(HOLD)합니다.`;
        } else if (proAction === 'BUY' && flashAction === 'HOLD') {
          finalAction = 'HOLD';
          hybridConfidence = Math.round(proConf * 0.55 + flashConf * 0.45);
          hybridSentiment = parseFloat((proSent * 0.6 + flashSent * 0.4).toFixed(1));
          consensusType = 'PRO_ALONE_HOLD';
          reasoning = `⏳ [거시 유망 vs 단기 수급 미확인 엇갈림] Pro 1시간 심층 퀀트(확신도 ${proConf}%)는 중기 상승 추세를 지지하나, Flash 30분 단기 수급 모멘텀(확신도 ${flashConf}%)이 미확인 상태이므로 안전한 분할 타점 형성을 위해 관망(HOLD)합니다.`;
        }
        // =========================================================================
        // [4] 둘 다 HOLD (Neutral HOLD)
        // =========================================================================
        else {
          finalAction = 'HOLD';
          hybridConfidence = Math.round(flashConf * 0.5 + proConf * 0.5);
          hybridSentiment = parseFloat(((flashSent + proSent) / 2).toFixed(1));
          consensusType = 'NEUTRAL_HOLD';
          reasoning = `⚖️ [방향성 탐색 중립 관망] Flash(30분)와 Pro(1시간) 양대 모델 모두 뚜렷한 모멘텀 없이 중립 지지선을 테스트 중이므로 관망(HOLD)을 유지합니다.`;
        }

        return {
          symbol: code,
          name,
          market,
          action: finalAction,
          confidence: hybridConfidence,
          sentimentScore: hybridSentiment,
          reasoning,
          related_news: relatedNews,
          consensusType,
          isFractional,
          fallbackMode: false,
          flashDecision: {
            action: flashAction,
            confidence: flashConf,
            sentimentScore: flashSent,
            reasoning: flash.reasoning || '',
          },
          proDecision: {
            action: proAction,
            confidence: proConf,
            sentimentScore: proSent,
            reasoning: pro.reasoning || '',
          },
          evaluatedAt: new Date().toISOString(),
        };
      });

      // 배열에 서킷 브레이커/Fallback 상태 속성 부착
      hybridDecisions.isCircuitOpen = !!isCircuitOpen;
      hybridDecisions.isFallback = isFallback;
      return hybridDecisions;
    } catch (err) {
      console.warn('[TradeService] evaluateWithHybridLLM 예외 발생 -> Fallback 모드 전환:', err.message);
      const fallbackList = ALL_CANDIDATE_STOCKS.map((stock) => ({
        symbol: stock.code,
        name: stock.name,
        market: stock.market,
        action: 'HOLD',
        confidence: 50,
        sentimentScore: 0,
        reasoning: `🛡️ 하이브리드 LLM 예외(${err.message})로 인해 순수 퀀트 Fallback 모드로 안전 전환됩니다.`,
        related_news: '',
        consensusType: 'ERROR_FALLBACK',
        isFractional: !!stock.isFractional,
        fallbackMode: true,
        evaluatedAt: new Date().toISOString(),
      }));
      fallbackList.isCircuitOpen = true;
      fallbackList.isFallback = true;
      return fallbackList;
    }
  }

  /**
   * [Fallback 전용] LLM 서킷 브레이커 차단(OPEN) 또는 예외 발생 시 순수 퀀트 모드 전환
   * 실전 담당 봇(is_real_running = 1)의 evaluatePureQuantAlgorithm() 점수만으로 매매 판단
   * ACTION = pureAlgorithmResult.shouldBuy ? 'BUY' : 'HOLD'
   * 주문 금액은 평소 배정 예산의 50% 수준(budgetMultiplier: 0.5)으로 축소
   */
  static evaluatePureQuantFallback({ bot, candidateQuotes = [], budgetMultiplier = 0.5 }) {
    if (!bot || !Array.isArray(candidateQuotes) || candidateQuotes.length === 0) {
      return [];
    }

    return candidateQuotes.map((quote) => {
      const pureResult = evaluatePureQuantAlgorithm(bot, quote);
      const shouldBuy = Boolean(pureResult && pureResult.shouldBuy);
      const action = shouldBuy ? 'BUY' : 'HOLD';
      const confidence = pureResult?.score ? Number(pureResult.score) : (shouldBuy ? 80 : 35);
      const symbol = quote.code || quote.symbol;

      return {
        symbol,
        name: quote.name || symbol,
        market: quote.market || (symbol && symbol.length === 6 && /^\d+$/.test(symbol) ? 'KR' : 'US'),
        action,
        confidence,
        sentimentScore: 0,
        reasoning: `[🛡️순수퀀트 Fallback 모드 (예산 ${Math.round(budgetMultiplier * 100)}%)] ${pureResult?.reason || '순수 알고리즘 지표 판정'}`,
        related_news: '',
        consensusType: 'PURE_QUANT_FALLBACK',
        isFractional: quote.isFractional !== undefined ? !!quote.isFractional : quote.market === 'US',
        fallbackMode: true,
        budgetMultiplier,
        pureAlgorithmResult: pureResult,
        evaluatedAt: new Date().toISOString(),
      };
    });
  }
}
