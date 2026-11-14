import { getDb, runTransaction } from '../db/index.mjs';
import { kiwoomClient, tossClient } from './market_service.mjs';
import { VirtualPaperTradingEngine } from '../common/virtual_engine.mjs';
import { getBotStrategyFamily } from '../common/quant_algorithms.mjs';

const STRATEGY_FAMILIES = ['BREAKOUT', 'TREND', 'REVERSION'];

function formatKstDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function execInTx(db, fn) {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  db.exec('BEGIN');
  try {
    const res = fn();
    db.exec('COMMIT');
    return res;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function buildQuotePriceMap(liveQuotes = []) {
  const quoteMap = new Map();
  if (!Array.isArray(liveQuotes)) return quoteMap;
  for (const q of liveQuotes) {
    if (!q) continue;
    const code = q.stock_code || q.code || q.symbol;
    const price = Number(q.current_price || q.currentPrice || q.price || 0);
    if (code && Number.isFinite(price) && price > 0) {
      quoteMap.set(code, price);
    }
  }
  return quoteMap;
}

function resolveCurrentPrice(stockCode, fallbackPrice = 0, quoteMap = null) {
  if (quoteMap && quoteMap.has(stockCode)) {
    const p = Number(quoteMap.get(stockCode));
    if (Number.isFinite(p) && p > 0) return p;
  }
  const cached = kiwoomClient.priceCache.get(stockCode)?.data || tossClient.priceCache.get(stockCode)?.data;
  const cachedPrice = Number(cached?.currentPrice || 0);
  if (Number.isFinite(cachedPrice) && cachedPrice > 0) return cachedPrice;
  return Number(fallbackPrice || 0);
}

function computeOpenPositionMetrics(positions = [], quoteMap = null) {
  let openEvalSum = 0;
  let openUnrealizedSum = 0;
  for (const pos of positions) {
    const curPrice = resolveCurrentPrice(pos.stock_code, Number(pos.avg_buy_price || 0), quoteMap);
    const qty = Number(pos.qty || 0);
    const buyAmt = Number(pos.buy_amount || 0);
    const buyFee = Number(pos.buy_fee || 0);
    const evalAmt = Math.round(curPrice * qty);
    openEvalSum += evalAmt;
    openUnrealizedSum += (evalAmt - buyAmt - buyFee);
  }
  return { openEvalSum, openUnrealizedSum };
}

function computeRealBotCompoundAvailable(db, botId, allocatedCap) {
  const openAmt = db.prepare(`
    SELECT COALESCE(SUM(buy_amount), 0) as amt
    FROM bot_positions
    WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
      AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)
  `).get(botId)?.amt || 0;

  const rProfitRow = db.prepare(`
    SELECT COALESCE(SUM(profit_krw), 0) as profit
    FROM trades
    WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED'
      AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)
  `).get(botId);
  const rProfit = Number(rProfitRow?.profit || 0);

  return {
    allocatedCap,
    openAmt: Number(openAmt),
    rProfit,
    availKrw: Math.max(0, allocatedCap + rProfit - Number(openAmt)),
  };
}

function reconcileDeselectedStickiness(db, nowIso, preferWeeklyMsg = false) {
  const deselectedBots = db.prepare(`
    SELECT bot_id, nickname, real_allocated_capital, real_available_krw, real_status_msg
    FROM bots WHERE is_real_selected = 0
  `).all();

  let deselectedLockedBudget = 0;
  const stickinessBots = [];

  for (const dbBot of deselectedBots) {
    const posStats = db.prepare(`
      SELECT COUNT(*) AS cnt,
             COALESCE(SUM(buy_amount), 0) AS total_amt,
             COALESCE(SUM(CASE WHEN order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL THEN buy_amount ELSE 0 END), 0) AS budget_amt
      FROM bot_positions
      WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
    `).get(dbBot.bot_id);

    const openCnt = Number(posStats?.cnt || 0);
    const totalLockedAmt = Math.round(Number(posStats?.total_amt || 0));
    const budgetLockedAmt = Math.round(Number(posStats?.budget_amt || 0));
    deselectedLockedBudget += budgetLockedAmt;

    if (openCnt > 0) {
      stickinessBots.push({
        bot_id: dbBot.bot_id,
        nickname: dbBot.nickname,
        open_positions: openCnt,
        locked_capital: totalLockedAmt,
      });
      const keepWeeklyMsg = preferWeeklyMsg
        ? '주간 로테이션 교체됨 (보유 포지션 책임 청산 감시 중)'
        : (String(dbBot.real_status_msg || '').includes('주간 로테이션')
            ? dbBot.real_status_msg
            : '청산 대기 중 (보유 포지션 자동 관리)');
      db.prepare(`
        UPDATE bots
        SET is_real_running = 0,
            real_allocation_ratio = 0,
            real_allocated_capital = ?,
            real_available_krw = 0,
            allocated_capital = ?,
            allocation_ratio = 0,
            real_status_msg = ?,
            updated_at = ?
        WHERE bot_id = ?
      `).run(totalLockedAmt, totalLockedAmt, keepWeeklyMsg, nowIso, dbBot.bot_id);
    } else if (
      Number(dbBot.real_allocated_capital || 0) > 0 ||
      Number(dbBot.real_available_krw || 0) > 0 ||
      String(dbBot.real_status_msg || '').includes('청산 대기') ||
      String(dbBot.real_status_msg || '').includes('주간 로테이션')
    ) {
      db.prepare(`
        UPDATE bots
        SET is_real_running = 0,
            real_allocation_ratio = 0,
            real_allocated_capital = 0,
            real_available_krw = 0,
            allocated_capital = 0,
            allocation_ratio = 0,
            real_status_msg = '가상 아레나 전용 (실전 미선택)',
            updated_at = ?
        WHERE bot_id = ?
      `).run(nowIso, dbBot.bot_id);
    }
  }

  return { deselectedLockedBudget, stickinessBots };
}

export const DEFAULT_BOT_PRESETS = {
  bot_01_volatility_breakout: {
    stop_loss_pct: -2.0,
    take_profit_pct: 4.0,
    min_volume_krw: 5000000000,
    config_json: { k_factor: 0.5, vol_surge_ratio: 2.0 }
  },
  bot_02_inst_dual_momentum: {
    stop_loss_pct: -3.0,
    take_profit_pct: 7.0,
    min_volume_krw: 5000000000,
    config_json: { lookback_days: 20, min_inst_streak: 3 }
  },
  bot_03_bb_rsi_reversion: {
    stop_loss_pct: -2.5,
    take_profit_pct: 3.5,
    min_volume_krw: 5000000000,
    config_json: { bb_period: 20, bb_std: 2.0, rsi_low: 30 }
  },
  bot_04_macd_volume_surge: {
    stop_loss_pct: -2.5,
    take_profit_pct: 5.5,
    min_volume_krw: 5000000000,
    config_json: { fast: 12, slow: 26, signal: 9, vol_mult: 3.0 }
  },
  bot_05_supertrend_atr: {
    stop_loss_pct: -3.0,
    take_profit_pct: 8.0,
    min_volume_krw: 5000000000,
    config_json: { atr_period: 10, multiplier: 3.0, min_adx: 25 }
  },
  bot_06_envelope_sniper: {
    stop_loss_pct: -2.0,
    take_profit_pct: 3.0,
    min_volume_krw: 5000000000,
    config_json: { ma_period: 20, envelope_pct: -7.0 }
  },
  bot_07_ichimoku_cloud: {
    stop_loss_pct: -2.8,
    take_profit_pct: 6.5,
    min_volume_krw: 5000000000,
    config_json: { tenkan: 9, kijun: 26, senkou: 52 }
  },
  bot_08_stoch_vwap_scalp: {
    stop_loss_pct: -1.2,
    take_profit_pct: 2.5,
    min_volume_krw: 5000000000,
    config_json: { stoch_k: 14, stoch_d: 3, vwap_margin: 0.002 }
  },
  bot_09_keltner_squeeze: {
    stop_loss_pct: -2.5,
    take_profit_pct: 6.0,
    min_volume_krw: 5000000000,
    config_json: { ema_period: 20, atr_mult: 1.5 }
  },
  bot_10_ma_pullback_swing: {
    stop_loss_pct: -2.2,
    take_profit_pct: 5.0,
    min_volume_krw: 5000000000,
    config_json: { fast_ma: 20, slow_ma: 60, pullback_tolerance: 0.8 }
  },
  bot_11_jack_kellogg_vwap: {
    stop_loss_pct: -2.0,
    take_profit_pct: 6.0,
    min_volume_krw: 5000000000,
    config_json: { min_vol_ratio: 2.0, max_dist_from_high_pct: 3.5, vwap_stop_buffer: 0.995, max_rsi: 78 }
  }
};

/**
 * 개별 봇 알고리즘 파라미터(익절/손절/거래대금/config_json) 업데이트
 */
export function updateBotStrategyConfig(botId, payload = {}) {
  const db = getDb();
  if (!db) throw new Error('데이터베이스가 준비되지 않았습니다.');
  const existing = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
  if (!existing) throw new Error(`존재하지 않는 봇입니다: ${botId}`);

  const takeProfitPct = Number(payload.take_profit_pct ?? existing.take_profit_pct);
  const rawStopLossPct = Number(payload.stop_loss_pct ?? existing.stop_loss_pct);
  // 사용자가 양수(예: 2.5)로 입력하더라도 자동으로 음수(-2.5)로 보정
  const stopLossPct = rawStopLossPct > 0 ? -Math.abs(rawStopLossPct) : rawStopLossPct;
  const minVolumeKrw = Math.max(0, Number(payload.min_volume_krw ?? existing.min_volume_krw ?? 5000000000));

  if (takeProfitPct <= 0.3 || takeProfitPct > 50) {
    throw new Error('목표 익절률(take_profit_pct)은 +0.3% ~ +50.0% 사이여야 합니다.');
  }
  if (stopLossPct >= -0.2 || stopLossPct < -30) {
    throw new Error('손절 제한선(stop_loss_pct)은 -0.2% ~ -30.0% 사이여야 합니다.');
  }

  let currentConfig = {};
  try {
    currentConfig = JSON.parse(existing.config_json || '{}');
  } catch (_) {}

  const incomingConfig =
    typeof payload.config_json === 'string'
      ? JSON.parse(payload.config_json)
      : (payload.config_json || {});

  const mergedConfig = { ...currentConfig };
  for (const [k, v] of Object.entries(incomingConfig)) {
    const numVal = Number(v);
    mergedConfig[k] = Number.isNaN(numVal) ? v : numVal;
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE bots
    SET take_profit_pct = ?,
        stop_loss_pct = ?,
        min_volume_krw = ?,
        config_json = ?,
        updated_at = ?
    WHERE bot_id = ?
  `).run(
    Number(takeProfitPct.toFixed(2)),
    Number(stopLossPct.toFixed(2)),
    Math.floor(minVolumeKrw),
    JSON.stringify(mergedConfig),
    nowIso,
    botId
  );

  return BotService.getAllBotsWithMetrics();
}

/**
 * 개별 봇 또는 전체 11대 봇 파라미터를 초기 시드값(Factory Default)으로 복원
 */
export function resetBotStrategyConfig(targetBotId = 'ALL') {
  const db = getDb();
  if (!db) throw new Error('데이터베이스가 준비되지 않았습니다.');
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE bots
    SET stop_loss_pct = ?,
        take_profit_pct = ?,
        min_volume_krw = ?,
        config_json = ?,
        updated_at = ?
    WHERE bot_id = ?
  `);

  runTransaction(() => {
    if (targetBotId === 'ALL') {
      for (const [id, preset] of Object.entries(DEFAULT_BOT_PRESETS)) {
        stmt.run(
          preset.stop_loss_pct,
          preset.take_profit_pct,
          preset.min_volume_krw,
          JSON.stringify(preset.config_json),
          nowIso,
          id
        );
      }
    } else {
      const preset = DEFAULT_BOT_PRESETS[targetBotId];
      if (!preset) throw new Error(`기본 프리셋을 찾을 수 없는 봇입니다: ${targetBotId}`);
      stmt.run(
        preset.stop_loss_pct,
        preset.take_profit_pct,
        preset.min_volume_krw,
        JSON.stringify(preset.config_json),
        nowIso,
        targetBotId
      );
    }
  });

  return BotService.getAllBotsWithMetrics();
}

export const getAllBotsWithMetrics = () => BotService.getAllBotsWithMetrics();

export const virtualEngine = new VirtualPaperTradingEngine(getDb, kiwoomClient);

export class BotService {
  /**
   * 토스증권 실제 주문가능 예수금(원화 availableCash + 달러 availableUsd 원화 환산액)의 90%를 계산하여
   * 총 실전 운영원금(real_total_budget)으로 자동 설정하고,
   * 실전 선택된 봇들에게 설정된 비율(real_allocation_ratio)대로 실시간 분배
   * @param {Object} db DB 인스턴스 (선택)
   * @param {Object} tossBal 토스 잔고 객체 ({ availableCash, availableUsd, ... })
   * @returns {number} 동적 산출된 총 실전 운영원금
   */
  static syncDynamicRealBudget(db = getDb(), tossBal = null) {
    if (!db || !tossBal) return 0;
    const availableCash = Number(tossBal.availableCash || 0);
    const availableUsd = Number(tossBal.availableUsd || 0);
    const usdRate = Number(tossBal.usdRate || 1345);
    const availableUsdKrw = tossBal.availableUsdKrw !== undefined ? Number(tossBal.availableUsdKrw) : Math.floor(availableUsd * usdRate);
    const totalCash = availableCash + availableUsdKrw;
    const dynamicBudget = Math.floor(totalCash * 0.90);
    const nowIso = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('real_total_budget', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `).run(String(dynamicBudget), nowIso);

      const selectedBots = db.prepare(`
        SELECT bot_id, real_allocation_ratio FROM bots WHERE is_real_selected = 1 ORDER BY bot_id ASC
      `).all();

      if (selectedBots.length > 0) {
        for (const b of selectedBots) {
          const ratio = Number(b.real_allocation_ratio || 0);
          const allocatedCap = Math.floor(dynamicBudget * (ratio / 100));
          const { availKrw } = computeRealBotCompoundAvailable(db, b.bot_id, allocatedCap);

          db.prepare(`
            UPDATE bots
            SET real_allocated_capital = ?,
                real_available_krw = ?,
                allocated_capital = ?,
                updated_at = ?
            WHERE bot_id = ?
          `).run(allocatedCap, availKrw, allocatedCap, nowIso, b.bot_id);
        }
      }

      // Position Stickiness: 선택 해제되었지만 미청산 실전 포지션을 보유한 봇의 잔고/상태 보호 및 청산 완료 후 정리
      reconcileDeselectedStickiness(db, nowIso, false);
    } catch (e) {
      console.warn('[BotService] 동적 실전 운영원금 동기화 오류:', e.message);
    }

    return dynamicBudget;
  }

  static getBots() {
    return this.getAllBotsWithArenaMetrics();
  }

  static getAllBotsWithMetrics() {
    return this.getAllBotsWithArenaMetrics();
  }

  static getAllBotsWithArenaMetrics(dbOverrideOrQuotes = null, maybeDb = null) {
    const liveQuotes = Array.isArray(dbOverrideOrQuotes) ? dbOverrideOrQuotes : [];
    const db = (!Array.isArray(dbOverrideOrQuotes) && dbOverrideOrQuotes)
      ? dbOverrideOrQuotes
      : (maybeDb || getDb());
    if (!db) return [];

    const quoteMap = buildQuotePriceMap(liveQuotes);
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const realTotal = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;

    const rawBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();

    const enrichedBots = rawBots.map((bot) => {
      // 1. 누적 가상 매매 거래 통계 집계
      const vStats = db.prepare(`
        SELECT COUNT(*) as total_trades,
               SUM(CASE WHEN profit_krw > 0 THEN 1 ELSE 0 END) as wins,
               COALESCE(SUM(profit_krw), 0) as realized_profit
        FROM trades
        WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'CLOSED'
      `).get(bot.bot_id);

      const vOpen = db.prepare(`
        SELECT COALESCE(SUM(buy_amount), 0) as open_amount,
               COUNT(*) as open_count
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'
      `).get(bot.bot_id);

      // 1-2. 실시간 시가 평가(Mark-to-Market) 반영
      const vOpenPositions = db.prepare(`
        SELECT stock_code, qty, avg_buy_price, buy_amount, buy_fee
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'
      `).all(bot.bot_id);

      const { openEvalSum: vOpenEvalSum, openUnrealizedSum: vOpenUnrealizedSum } =
        computeOpenPositionMetrics(vOpenPositions, quoteMap);

      const initCap = Number(bot.virtual_initial_capital || 1000000);
      const totalEval = Number(bot.virtual_krw || 0) + vOpenEvalSum;
      const returnPct = initCap > 0 ? ((totalEval - initCap) / initCap) * 100 : 0;
      const totalTrades = Number(vStats?.total_trades || 0);
      const winTrades = Number(vStats?.wins || 0);
      const lossTrades = totalTrades - winTrades;
      const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

      // 1-3. 최근 7일(Rolling 7-Day) 가상 매매 성과 + 미실현 MTM 결합 점수 산출
      const wStats = db.prepare(`
        SELECT COUNT(*) as weekly_trades,
               SUM(CASE WHEN profit_krw > 0 THEN 1 ELSE 0 END) as weekly_wins,
               COALESCE(SUM(profit_krw), 0) as weekly_realized_profit
        FROM trades
        WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'CLOSED'
          AND COALESCE(sell_date, buy_date) >= ?
      `).get(bot.bot_id, sevenDaysAgoIso);

      const weeklyTradeCnt = Number(wStats?.weekly_trades || 0);
      const weeklyWins = Number(wStats?.weekly_wins || 0);
      const weeklyWinRate = weeklyTradeCnt > 0
        ? Number(((weeklyWins / weeklyTradeCnt) * 100).toFixed(1))
        : 50.0;
      const weeklyRealized = Number(wStats?.weekly_realized_profit || 0);
      const weeklyUnrealized = Math.round(vOpenUnrealizedSum);
      const weeklyProfitKrw = Math.round(weeklyRealized + weeklyUnrealized);
      const weeklyReturnPct = initCap > 0 ? Number(((weeklyProfitKrw / initCap) * 100).toFixed(2)) : 0;

      const sampleConfidence = weeklyTradeCnt >= 3 ? 1.0 : (weeklyTradeCnt >= 1 ? 0.8 : 0.65);
      const weeklyCompositeScore = Number(
        ((weeklyReturnPct * 0.7 + ((weeklyWinRate - 50) / 10) * 0.3) * sampleConfidence).toFixed(4)
      );

      // 2. 실전 매매 거래 통계 집계 (실제 집행된 실전 거래만 엄격 반영)
      const rStats = db.prepare(`
        SELECT COUNT(*) as total_trades,
               COALESCE(SUM(profit_krw), 0) as realized_profit
        FROM trades
        WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED' AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)
      `).get(bot.bot_id);

      const rOpen = db.prepare(`
        SELECT COALESCE(SUM(buy_amount), 0) as open_amount,
               COUNT(*) as open_count
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN' AND (order_no NOT LIKE 'VORD_%' OR order_no IS NULL)
      `).get(bot.bot_id);

      const realAllocated = Math.round(Number(bot.real_allocated_capital || Math.floor(realTotal * (Number(bot.real_allocation_ratio || 33.3) / 100))));
      const virtualAllocated = Math.round(Number(bot.virtual_initial_capital || 1000000));

      return {
        ...bot,
        strategy_family: getBotStrategyFamily(bot),
        is_virtual_running: 1, // 상시 가상 거래 상태 보장
        virtual_initial_capital: initCap,
        virtual_total_assets: totalEval,
        virtual_return_pct: Number(returnPct.toFixed(2)),
        virtual_profit_krw: Number(vStats?.realized_profit || 0),
        virtual_win_rate: Number(winRate.toFixed(1)),
        virtual_trade_count: totalTrades,
        virtual_win_trades: winTrades,
        virtual_loss_trades: lossTrades,
        virtual_open_count: Number(vOpen.open_count || 0),
        weekly_return_pct: weeklyReturnPct,
        weekly_profit_krw: weeklyProfitKrw,
        weekly_win_rate: weeklyWinRate,
        weekly_trade_count: weeklyTradeCnt,
        weekly_composite_score: weeklyCompositeScore,
        is_family_weekly_top: false,
        real_profit_krw: Number(rStats.realized_profit),
        real_trade_count: Number(rStats.total_trades),
        real_open_count: Number(rOpen.open_count || 0),
        real_allocated_capital: realAllocated,
        real_available_krw: Math.round(Number(bot.real_available_krw || 0)),
        virtual_allocated_capital: virtualAllocated,
        allocated_capital: bot.is_real_selected === 1 ? realAllocated : virtualAllocated,
      };
    });

    // 전략군별 주간 복합 점수 1위 봇 마킹
    for (const family of STRATEGY_FAMILIES) {
      const famBots = enrichedBots
        .filter((b) => b.strategy_family === family)
        .sort((a, b) => (
          Number(b.weekly_composite_score || 0) - Number(a.weekly_composite_score || 0) ||
          Number(b.weekly_return_pct || 0) - Number(a.weekly_return_pct || 0) ||
          Number(b.virtual_return_pct || 0) - Number(a.virtual_return_pct || 0) ||
          String(a.bot_id).localeCompare(String(b.bot_id))
        ));
      if (famBots.length > 0) {
        famBots[0].is_family_weekly_top = true;
      }
    }

    return enrichedBots;
  }

  static getBotById(botId) {
    const db = getDb();
    return db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
  }

  // 1~3개 실전 담당 봇 선택 확정 (Position Stickiness)
  // - 기존 봇이 선택 해제되더라도 보유 중인 실전 미청산 포지션(pos.bot_id)은 절대 타 봇으로 이관하지 않음
  // - 원 소유 봇의 고유 청산 조건 도달 시까지 끝까지 자동 관리(청산 대기 중) 및 투자 원금 보호
  static async selectRealTradingBots(selectedBotIds, options = {}) {
    if (!Array.isArray(selectedBotIds) || selectedBotIds.length < 1 || selectedBotIds.length > 3) {
      throw new Error('실전 거래 담당 봇은 1개에서 최대 3개까지 선택해야 합니다.');
    }
    if (new Set(selectedBotIds).size !== selectedBotIds.length) {
      throw new Error('실전 거래 담당 봇은 서로 다른 봇을 선택해야 합니다.');
    }

    const db = options.db || getDb();

    // 토스 실시간 주문가능 예수금(원화 + 달러 환산)의 90%를 총 실전 운영원금으로 동적 산출
    let dynamicBudget = 0;
    if (!options.skipTossSync) {
      try {
        const tossBal = await tossClient.getAccountBalance();
        dynamicBudget = this.syncDynamicRealBudget(db, tossBal);
      } catch (e) {}
    }

    const settingRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const realTotalBudget = dynamicBudget > 0 ? dynamicBudget : Number(settingRow?.value || 10000000);

    const nowIso = new Date().toISOString();

    for (const botId of selectedBotIds) {
      if (!db.prepare('SELECT bot_id FROM bots WHERE bot_id = ?').get(botId)) {
        throw new Error(`존재하지 않는 봇입니다: ${botId}`);
      }
    }

    // 기존 실전 담당 봇 및 비율, 가동 상태 스냅샷
    const prevSelected = db.prepare(`
      SELECT bot_id, name, nickname, real_allocation_ratio, is_real_running
      FROM bots WHERE is_real_selected = 1 ORDER BY bot_id ASC
    `).all();
    const prevIds = prevSelected.map((b) => b.bot_id);
    const prevRatioMap = new Map(prevSelected.map((b) => [b.bot_id, Number(b.real_allocation_ratio || 0)]));
    const prevRunningMap = new Map(prevSelected.map((b) => [b.bot_id, Number(b.is_real_running || 0)]));

    const retainedIds = selectedBotIds.filter((id) => prevIds.includes(id));
    const addedIds = selectedBotIds.filter((id) => !prevIds.includes(id));
    const removedSelectedIds = prevIds.filter((id) => !selectedBotIds.includes(id));

    db.exec('BEGIN');
    try {
      // 1) Position Stickiness: 미청산 실전 포지션(bot_positions.bot_id)은 원 소유 봇에 그대로 귀속 유지
      const inheritance = [];

      // 2) 투자 비율 결정: 유지 봇은 기존 비율, 신규 봇은 해제된 봇의 목표 비율 순차 참고 후 100% 정규화
      const ratioMap = new Map();
      retainedIds.forEach((id) => ratioMap.set(id, prevRatioMap.get(id) || 0));
      addedIds.forEach((id, idx) => {
        const srcId = removedSelectedIds[idx];
        ratioMap.set(id, srcId && prevRatioMap.has(srcId) ? prevRatioMap.get(srcId) || 0 : 0);
      });
      const assignedSum = [...ratioMap.values()].reduce((a, b) => a + b, 0);
      const zeroIds = selectedBotIds.filter((id) => !(ratioMap.get(id) > 0));
      if (zeroIds.length > 0) {
        const remain = Math.max(0, 100 - assignedSum);
        if (remain <= 0) {
          const count = selectedBotIds.length;
          let acc = 0;
          selectedBotIds.forEach((id, idx) => {
            const r = idx === count - 1 ? Number((100 - acc).toFixed(1)) : Number((100 / count).toFixed(1));
            acc += r;
            ratioMap.set(id, r);
          });
        } else {
          let acc = 0;
          zeroIds.forEach((id, idx) => {
            const r = idx === zeroIds.length - 1
              ? Number((remain - acc).toFixed(1))
              : Number((remain / zeroIds.length).toFixed(1));
            acc += r;
            ratioMap.set(id, r);
          });
        }
      }
      const totalRatio = [...ratioMap.values()].reduce((a, b) => a + b, 0);
      if (Math.abs(totalRatio - 100) > 0.5) {
        const count = selectedBotIds.length;
        let acc = 0;
        selectedBotIds.forEach((id, idx) => {
          const r = idx === count - 1 ? Number((100 - acc).toFixed(1)) : Number((100 / count).toFixed(1));
          acc += r;
          ratioMap.set(id, r);
        });
      }

      // 3) 미선택 봇 처리: 신규 매수 중지(is_real_selected = 0, is_real_running = 0)
      //    단, 미청산 포지션이 남은 봇은 상태 메시지와 점유 원금을 보존하여 끝까지 책임 청산
      const notInPlaceholders = selectedBotIds.map(() => '?').join(', ');
      const deselectedAll = db.prepare(`
        SELECT bot_id FROM bots WHERE bot_id NOT IN (${notInPlaceholders})
      `).all(...selectedBotIds);

      let deselectedLockedBudget = 0;
      const stickinessBots = [];

      for (const row of deselectedAll) {
        const posStats = db.prepare(`
          SELECT COUNT(*) AS cnt,
                 COALESCE(SUM(buy_amount), 0) AS total_amt,
                 COALESCE(SUM(CASE WHEN order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL THEN buy_amount ELSE 0 END), 0) AS budget_amt
          FROM bot_positions
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
        `).get(row.bot_id);

        const openCnt = Number(posStats?.cnt || 0);
        const totalLockedAmt = Math.round(Number(posStats?.total_amt || 0));
        const budgetLockedAmt = Math.round(Number(posStats?.budget_amt || 0));
        deselectedLockedBudget += budgetLockedAmt;

        if (openCnt > 0) {
          stickinessBots.push({ bot_id: row.bot_id, open_positions: openCnt, locked_capital: totalLockedAmt });
          db.prepare(`
            UPDATE bots
            SET is_real_selected = 0,
                is_real_running = 0,
                real_allocation_ratio = 0,
                real_allocated_capital = ?,
                real_available_krw = 0,
                allocated_capital = ?,
                allocation_ratio = 0,
                real_status_msg = '청산 대기 중 (보유 포지션 자동 관리)',
                updated_at = ?
            WHERE bot_id = ?
          `).run(totalLockedAmt, totalLockedAmt, nowIso, row.bot_id);
        } else {
          db.prepare(`
            UPDATE bots
            SET is_real_selected = 0,
                is_real_running = 0,
                real_allocation_ratio = 0,
                real_allocated_capital = 0,
                real_available_krw = 0,
                allocated_capital = 0,
                allocation_ratio = 0,
                real_status_msg = '가상 아레나 전용 (실전 미선택)',
                updated_at = ?
            WHERE bot_id = ?
          `).run(nowIso, row.bot_id);
        }
      }

      // 4) 선택 봇 실전 지정 (정적 총예산 사용 시 미선택 봇의 미청산 포지션 점유 원금을 보호한 잔여 예산 배분)
      const distributableBudget = dynamicBudget > 0
        ? realTotalBudget
        : Math.max(0, realTotalBudget - deselectedLockedBudget);

      for (const botId of selectedBotIds) {
        const ratio = ratioMap.get(botId);
        const allocated = Math.floor(distributableBudget * (ratio / 100));

        const openReal = db.prepare(`
          SELECT COALESCE(SUM(buy_amount), 0) as amt
          FROM bot_positions
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
            AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)
        `).get(botId)?.amt || 0;

        // 2.3 실전 가용 현금(real_available_krw)에 누적 실현손익 복리 반영
        const rProfitRow = db.prepare(`
          SELECT COALESCE(SUM(profit_krw), 0) as profit
          FROM trades
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED'
            AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)
        `).get(botId);
        const rProfit = Number(rProfitRow?.profit || 0);

        const available = Math.max(0, allocated + rProfit - Number(openReal));

        // 기존에 이미 실전 담당으로 가동 중이던(is_real_running = 1) 봇이 재선택된 경우 기존 가동 상태 그대로 유지
        const prevRun = prevRunningMap.get(botId);
        const targetRunning = prevRun !== undefined ? prevRun : 1;

        const statusMsg = retainedIds.includes(botId)
          ? (targetRunning === 1 ? '실전 담당 유지 및 가동 중' : '실전 담당 유지 (일시 정지 상태)')
          : '실전 담당 지정 및 가동 중';

        db.prepare(`
          UPDATE bots
          SET is_real_selected = 1,
              is_real_running = ?,
              trade_mode = 'REAL',
              real_allocation_ratio = ?,
              real_allocated_capital = ?,
              real_available_krw = ?,
              allocated_capital = ?,
              allocation_ratio = ?,
              real_status_msg = ?,
              updated_at = ?
          WHERE bot_id = ?
        `).run(targetRunning, ratio, allocated, available, allocated, ratio / 100, statusMsg, nowIso, botId);
      }

      db.exec('COMMIT');

      if (stickinessBots.length > 0) {
        console.log('[BotService] 🛡️ Position Stickiness 활성 (원 소유 봇 청산 대기 관리):', JSON.stringify(stickinessBots));
      }

      return {
        bots: this.getAllBotsWithArenaMetrics(db),
        inheritance,
        retained: retainedIds,
        stickinessBots,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // 환경설정에서 선택된 1~3개 실전 봇의 동적 투자금 비율(%) 및 총 예산 저장
  static async updateRealBudgetAllocations(realTotalBudget, allocations, options = {}) {
    if (!Array.isArray(allocations) || allocations.length < 1 || allocations.length > 3) {
      throw new Error('실전 거래 담당 봇(1~3개)의 비율을 설정해야 합니다.');
    }

    const sum = allocations.reduce((acc, cur) => acc + Number(cur.ratio || 0), 0);
    if (Math.abs(sum - 100) > 0.5) {
      throw new Error(`선택된 실전 봇들의 투자 비율 합계는 100%여야 합니다. (현재: ${sum.toFixed(1)}%)`);
    }

    const db = options.db || getDb();

    // 토스 실시간 주문가능 예수금(원화 + 달러 환산)의 90%를 총 실전 운영원금으로 동적 산출
    let dynamicBudget = 0;
    if (!options.skipTossSync) {
      try {
        const tossBal = await tossClient.getAccountBalance();
        dynamicBudget = this.syncDynamicRealBudget(db, tossBal);
      } catch (e) {}
    }

    const targetBudget = dynamicBudget > 0 ? dynamicBudget : (Number(realTotalBudget) || 10000000);
    const nowIso = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('real_total_budget', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `).run(String(targetBudget), nowIso);

      // 정적 총예산 사용 시 선택 해제되었으나 미청산 포지션을 보유 중인 봇의 점유 원금 보호
      let deselectedLockedBudget = 0;
      if (dynamicBudget <= 0) {
        const lockRow = db.prepare(`
          SELECT COALESCE(SUM(bp.buy_amount), 0) AS amt
          FROM bot_positions bp
          JOIN bots b ON b.bot_id = bp.bot_id
          WHERE b.is_real_selected = 0
            AND bp.trade_mode = 'REAL'
            AND bp.status = 'OPEN'
            AND (bp.order_no NOT LIKE 'TOSS_SYNC_%' OR bp.order_no IS NULL)
        `).get();
        deselectedLockedBudget = Math.round(Number(lockRow?.amt || 0));
      }

      const distributableBudget = dynamicBudget > 0
        ? targetBudget
        : Math.max(0, targetBudget - deselectedLockedBudget);

      for (const item of allocations) {
        const ratio = Number(item.ratio);
        const allocated = Math.floor(distributableBudget * (ratio / 100));

        const openReal = db.prepare(`
          SELECT COALESCE(SUM(buy_amount), 0) as amt
          FROM bot_positions
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
            AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)
        `).get(item.bot_id)?.amt || 0;

        // 2.3 실전 가용 현금(real_available_krw)에 누적 실현손익 복리 반영
        const rProfitRow = db.prepare(`
          SELECT COALESCE(SUM(profit_krw), 0) as profit
          FROM trades
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED'
            AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)
        `).get(item.bot_id);
        const rProfit = Number(rProfitRow?.profit || 0);

        const available = Math.max(0, allocated + rProfit - Number(openReal));

        db.prepare(`
          UPDATE bots
          SET real_allocation_ratio = ?,
              real_allocated_capital = ?,
              real_available_krw = ?,
              allocated_capital = ?,
              allocation_ratio = ?,
              updated_at = ?
          WHERE bot_id = ? AND is_real_selected = 1
        `).run(ratio, allocated, available, allocated, ratio / 100, nowIso, item.bot_id);
      }

      db.exec('COMMIT');
      return this.getAllBotsWithArenaMetrics(db);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // 실전 봇 개별 가동/정지 토글
  static toggleRealRunning(botId, isRealRunning) {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const val = isRealRunning ? 1 : 0;
    const msg = isRealRunning ? '실전 거래 가동 중' : '사용자 실전 일시 중지';

    db.prepare(`
      UPDATE bots
      SET is_real_running = ?,
          real_status_msg = ?,
          updated_at = ?
      WHERE bot_id = ? AND is_real_selected = 1
    `).run(val, msg, nowIso, botId);

    return { success: true, botId, is_real_running: val, message: `[${botId}] ${msg}` };
  }

  static async handleAction(botId, action, seedCapital) {
    const db = getDb();

    // 1. 전체 가상 봇 및 거래내역 일괄 초기화
    if (botId === 'all' || action === 'RESET_VIRTUAL_ALL') {
      const targetSeed = seedCapital ? Number(seedCapital) : 1000000;
      const res = virtualEngine.resetAllVirtual(targetSeed);
      return {
        success: true,
        message: `전체 ${res.count || 11}대 가상 봇의 보유 포지션 및 누적 거래내역이 완전히 삭제되었습니다. 각 봇 초기 자본금 100만 원, 모든 성과 지표(수익률, 손익, 승률, 익절/손절) 0으로 신규 경쟁을 시작합니다.`,
      };
    }

    const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
    if (!bot) throw new Error('해당 봇을 찾을 수 없습니다.');

    const nowIso = new Date().toISOString();

    if (action === 'START') {
      db.prepare("UPDATE bots SET is_running = 1, is_real_running = 1, last_status_msg = '가동 중 (실시간 전략 실행)', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
      return { success: true, message: `[${bot.name}] 거래가 시작되었습니다.` };
    }

    if (action === 'STOP') {
      db.prepare("UPDATE bots SET is_running = 0, is_real_running = 0, last_status_msg = '사용자 수동 중지됨', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
      return { success: true, message: `[${bot.name}] 거래가 중지되었습니다.` };
    }

    if (action === 'TOGGLE_MODE') {
      const nextMode = bot.trade_mode === 'VIRTUAL' ? 'REAL' : 'VIRTUAL';
      const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
      const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
      const realTotal = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 0;
      const virtTotal = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;
      const nextAllocatedCap = Math.floor((nextMode === 'REAL' ? realTotal : virtTotal) * (bot.allocation_ratio || 0.33));

      db.prepare('UPDATE bots SET trade_mode = ?, allocated_capital = ?, last_status_msg = ?, updated_at = ? WHERE bot_id = ?').run(
        nextMode,
        nextAllocatedCap,
        `모드 변경: ${nextMode === 'REAL' ? '💰 실전매매' : '🧪 가상매매'}`,
        nowIso,
        botId
      );
      return { success: true, newMode: nextMode, message: `[${bot.name}] 모드가 ${nextMode}로 전환되었습니다.` };
    }

    if (action === 'RESET_VIRTUAL') {
      const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
      const virtTotal = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;
      const capital = seedCapital || Math.floor(virtTotal * (bot.allocation_ratio || 0.33)) || 10000000;
      virtualEngine.resetVirtualBalance(botId, capital);
      return {
        success: true,
        message: `[${bot.nickname || bot.name}] 가상 계좌 및 누적 거래내역이 완전히 삭제되었습니다. (초기 자본: ${capital.toLocaleString()}원)`,
      };
    }

    throw new Error('알 수 없는 액션입니다.');
  }

  static updateBot(botId, body) {
    const db = getDb();
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE bots
      SET nickname = COALESCE(?, nickname),
          allocation_ratio = COALESCE(?, allocation_ratio),
          allocated_capital = COALESCE(?, allocated_capital),
          stop_loss_pct = COALESCE(?, stop_loss_pct),
          take_profit_pct = COALESCE(?, take_profit_pct),
          min_volume_krw = COALESCE(?, min_volume_krw),
          config_json = COALESCE(?, config_json),
          updated_at = ?
      WHERE bot_id = ?
    `).run(
      body.nickname || null,
      body.allocation_ratio || null,
      body.allocated_capital || null,
      body.stop_loss_pct || null,
      body.take_profit_pct || null,
      body.min_volume_krw || null,
      body.config_json ? JSON.stringify(body.config_json) : null,
      nowIso,
      botId
    );

    return { success: true, message: '봇 파라미터가 갱신되었습니다.' };
  }

  static updateStrategyConfig(botId, payload) {
    return updateBotStrategyConfig(botId, payload);
  }

  static resetStrategyConfig(targetBotId = 'ALL') {
    return resetBotStrategyConfig(targetBotId);
  }

  /**
   * 실전 담당 봇(is_real_selected = 1)들의 가용 현금(real_available_krw) 및 미선택 봇 청산 상태를 최신화.
   * 탈락 봇의 미청산 포지션이 Phase B-1에서 청산될 때마다 호출되어 회수된 원금을 활성 실전 봇에 즉시 편입합니다.
   */
  static syncActiveRealBotsAvailableKrw(db = getDb(), tossBal = null) {
    if (!db) return null;
    const nowIso = new Date().toISOString();

    if (tossBal && !tossBal.isMock && (tossBal.availableCash !== undefined || tossBal.availableUsd !== undefined)) {
      const dynamicBudget = this.syncDynamicRealBudget(db, tossBal);
      const selectedCount = db.prepare('SELECT COUNT(*) AS cnt FROM bots WHERE is_real_selected = 1').get()?.cnt || 0;
      return { totalBudget: dynamicBudget, selectedCount: Number(selectedCount), deselectedLockedBudget: 0 };
    }

    const { deselectedLockedBudget, stickinessBots } = reconcileDeselectedStickiness(db, nowIso, false);
    const budgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const realTotalBudget = budgetRow ? Number(budgetRow.value) : 10000000;
    const distributableBudget = Math.max(0, realTotalBudget - deselectedLockedBudget);

    const selectedBots = db.prepare(`
      SELECT bot_id, real_allocation_ratio FROM bots WHERE is_real_selected = 1 ORDER BY bot_id ASC
    `).all();

    for (const b of selectedBots) {
      const ratio = Number(b.real_allocation_ratio || 0);
      const allocatedCap = Math.floor(distributableBudget * (ratio / 100));
      const { availKrw } = computeRealBotCompoundAvailable(db, b.bot_id, allocatedCap);

      db.prepare(`
        UPDATE bots
        SET real_allocated_capital = ?,
            real_available_krw = ?,
            allocated_capital = ?,
            allocation_ratio = ?,
            updated_at = ?
        WHERE bot_id = ?
      `).run(allocatedCap, availKrw, allocatedCap, ratio / 100, nowIso, b.bot_id);
    }

    return {
      totalBudget: distributableBudget,
      selectedCount: selectedBots.length,
      deselectedLockedBudget,
      stickinessBots,
    };
  }

  /**
   * 3대 전략군(BREAKOUT / TREND / REVERSION)별 최근 7일 시가평가 복합점수 1위 봇을 선출하여 실전 담당 봇으로 무중단 로테이션.
   * - 기존 실전 담당 봇 중 1개라도 가동 중(is_real_running=1)이면 신규 3대 봇 모두 is_real_running=1 자동 승계
   * - 탈락 봇의 OPEN 실전 포지션은 강제 청산/이관하지 않고 원 소유 봇 책임 청산 상태 유지(Position Stickiness)
   * - 주간 수익률 < -1.0% 군은 비중 축소(15.0), >= +2.0% 군은 비중 상향(40.0), 나머지 33.3 -> 100.0% 정확 정규화
   */
  static async rotateWeeklyTopBotsByFamily(liveQuotes = [], options = {}) {
    const opts = (!Array.isArray(liveQuotes) && liveQuotes && typeof liveQuotes === 'object')
      ? liveQuotes
      : (options || {});
    const quotes = Array.isArray(liveQuotes) ? liveQuotes : (opts.liveQuotes || []);
    const db = opts.db || getDb();
    if (!db) throw new Error('DB 인스턴스를 찾을 수 없습니다.');

    const trigger = typeof options === 'string' ? options : (opts.trigger || 'MANUAL');
    const nowDate = opts.nowDate instanceof Date ? opts.nowDate : new Date();
    const nowIso = nowDate.toISOString();
    const rotatedDateKst = formatKstDate(nowDate);

    let resolvedTossBal = opts.tossBal || null;
    if (!resolvedTossBal && !opts.skipTossSync) {
      try {
        const bal = await tossClient.getAccountBalance();
        if (bal && !bal.isMock) {
          resolvedTossBal = bal;
        }
      } catch (_) {}
    }

    // 1. 11대 봇 7일 시가 평가 성과 산출 및 전략군별 1위 선출
    const evaluatedBots = this.getAllBotsWithArenaMetrics(quotes, db);
    const winners = [];
    for (const family of STRATEGY_FAMILIES) {
      const candidates = evaluatedBots
        .filter((b) => b.strategy_family === family)
        .sort((a, b) => (
          Number(b.weekly_composite_score || 0) - Number(a.weekly_composite_score || 0) ||
          Number(b.weekly_return_pct || 0) - Number(a.weekly_return_pct || 0) ||
          Number(b.virtual_return_pct || 0) - Number(a.virtual_return_pct || 0) ||
          String(a.bot_id).localeCompare(String(b.bot_id))
        ));
      if (candidates.length > 0) {
        winners.push(candidates[0]);
      }
    }

    if (winners.length === 0) {
      throw new Error('전략군별 주간 1위 후보 봇이 존재하지 않습니다.');
    }

    // 2. 성과 기반 가중치 산정 (부진 < -1.0%: 15.0, 우수 >= +2.0%: 40.0, 기본: 33.3) -> 정확히 100.0% 정규화
    const weighted = winners.map((bot) => {
      const wRet = Number(bot.weekly_return_pct || 0);
      let rawWeight = 33.3;
      if (wRet < -1.0) rawWeight = 15.0;
      else if (wRet >= 2.0) rawWeight = 40.0;
      return { bot, rawWeight, finalRatio: 0 };
    });

    const rawSum = weighted.reduce((sum, item) => sum + item.rawWeight, 0);
    weighted.forEach((item) => {
      item.finalRatio = rawSum > 0 ? Number(((item.rawWeight / rawSum) * 100).toFixed(1)) : 33.3;
    });
    const normSum = weighted.reduce((sum, item) => sum + item.finalRatio, 0);
    const diff = Number((100.0 - normSum).toFixed(1));
    if (weighted.length > 0 && Math.abs(diff) > 0) {
      weighted[0].finalRatio = Number((weighted[0].finalRatio + diff).toFixed(1));
    }

    // 3. 기존 실전 가동 상태(is_real_running) 스냅샷 및 승계 판정
    const prevSelectedRows = db.prepare(`
      SELECT bot_id, name, nickname, is_real_running
      FROM bots WHERE is_real_selected = 1 ORDER BY bot_id ASC
    `).all();
    const previousSelectedIds = prevSelectedRows.map((b) => b.bot_id);
    const hadAnyRunningRealBot = prevSelectedRows.some((b) => Number(b.is_real_running) === 1);
    const targetRunningFlag = opts.forceRunning !== undefined
      ? (opts.forceRunning ? 1 : 0)
      : (hadAnyRunningRealBot ? 1 : 0);

    const winnerIds = weighted.map((item) => item.bot.bot_id);
    const placeholders = winnerIds.map(() => '?').join(', ');

    let rotationResult = null;
    execInTx(db, () => {
      // 3-1. 선택 해제 / 선택 확정 마킹 (bot_positions는 Position Stickiness 원칙으로 절대 수정하지 않음)
      db.prepare(`UPDATE bots SET is_real_selected = 0, is_real_running = 0 WHERE bot_id NOT IN (${placeholders})`).run(...winnerIds);
      db.prepare(`UPDATE bots SET is_real_selected = 1 WHERE bot_id IN (${placeholders})`).run(...winnerIds);

      // 3-2. 탈락 봇 미청산 포지션 보호 상태 부여 & 청산 완료 봇 초기화
      const { deselectedLockedBudget, stickinessBots } = reconcileDeselectedStickiness(db, nowIso, true);

      // 3-3. 실전 배분 원금 산출 (실계좌 동적 예산 또는 정적 총예산 - 탈락 봇 점유 원금)
      let dynamicBudget = 0;
      if (resolvedTossBal && !resolvedTossBal.isMock) {
        const availableCash = Number(resolvedTossBal.availableCash || 0);
        const availableUsd = Number(resolvedTossBal.availableUsd || 0);
        const usdRate = Number(resolvedTossBal.usdRate || 1345);
        const availableUsdKrw = resolvedTossBal.availableUsdKrw !== undefined
          ? Number(resolvedTossBal.availableUsdKrw)
          : Math.floor(availableUsd * usdRate);
        dynamicBudget = Math.floor((availableCash + availableUsdKrw) * 0.90);
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('real_total_budget', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `).run(String(dynamicBudget), nowIso);
      }

      const settingRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
      const realTotalBudget = dynamicBudget > 0 ? dynamicBudget : (settingRow ? Number(settingRow.value) : 10000000);
      const distributableBudget = dynamicBudget > 0
        ? realTotalBudget
        : Math.max(0, realTotalBudget - deselectedLockedBudget);

      // 3-4. 선출 3대 전략군 1위 봇 예산/복리 가용현금/가동 승계 반영
      const summaryWinners = [];
      for (const item of weighted) {
        const { bot, finalRatio } = item;
        const allocatedCap = Math.floor(distributableBudget * (finalRatio / 100));
        const { rProfit, openAmt, availKrw } = computeRealBotCompoundAvailable(db, bot.bot_id, allocatedCap);
        const statusMsg = targetRunningFlag === 1
          ? `주간 ${bot.strategy_family} 1위 선출 (가동 승계, 비중 ${finalRatio}%)`
          : `주간 ${bot.strategy_family} 1위 선출 (대기 중, 비중 ${finalRatio}%)`;

        db.prepare(`
          UPDATE bots
          SET is_real_selected = 1,
              is_real_running = ?,
              trade_mode = 'REAL',
              real_allocation_ratio = ?,
              real_allocated_capital = ?,
              real_available_krw = ?,
              allocated_capital = ?,
              allocation_ratio = ?,
              real_status_msg = ?,
              updated_at = ?
          WHERE bot_id = ?
        `).run(
          targetRunningFlag,
          finalRatio,
          allocatedCap,
          availKrw,
          allocatedCap,
          finalRatio / 100,
          statusMsg,
          nowIso,
          bot.bot_id
        );

        summaryWinners.push({
          bot_id: bot.bot_id,
          name: bot.name,
          nickname: bot.nickname,
          strategy_family: bot.strategy_family,
          weekly_return_pct: bot.weekly_return_pct,
          weekly_profit_krw: bot.weekly_profit_krw,
          weekly_win_rate: bot.weekly_win_rate,
          weekly_trade_count: bot.weekly_trade_count,
          weekly_composite_score: bot.weekly_composite_score,
          ratio: finalRatio,
          allocated_capital: allocatedCap,
          available_krw: availKrw,
          realized_profit_krw: rProfit,
          open_amount_krw: openAmt,
        });
      }

      const summaryObj = {
        rotatedAt: nowIso,
        rotatedDateKst,
        trigger,
        inheritedRunning: targetRunningFlag === 1,
        totalBudget: distributableBudget,
        deselectedLockedBudget,
        stickinessCount: stickinessBots.length,
        stickinessBots,
        previousSelectedIds,
        winners: summaryWinners,
      };

      const upsertSetting = db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `);
      upsertSetting.run('last_weekly_rotation_date', rotatedDateKst, nowIso);
      upsertSetting.run('last_weekly_rotation_summary', JSON.stringify(summaryObj), nowIso);

      rotationResult = {
        success: true,
        ...summaryObj,
      };
    });

    const refreshedBots = this.getAllBotsWithArenaMetrics(quotes, db);
    return {
      ...rotationResult,
      bots: refreshedBots,
    };
  }

  static getWeeklyRotationStatus(db = getDb()) {
    if (!db) {
      return {
        enabled: true,
        lastRotationDate: '',
        lastSummary: null,
        nextScheduledKst: '매주 월요일 08:30 KST',
      };
    }

    const rows = db.prepare(`
      SELECT key, value FROM system_settings
      WHERE key IN ('weekly_auto_rotation_enabled', 'last_weekly_rotation_date', 'last_weekly_rotation_summary')
    `).all();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    let parsedSummary = null;
    const rawSummary = map.get('last_weekly_rotation_summary');
    if (rawSummary && rawSummary !== '{}') {
      try {
        const obj = JSON.parse(rawSummary);
        if (obj && Object.keys(obj).length > 0) parsedSummary = obj;
      } catch (_) {}
    }

    const enabledStr = map.get('weekly_auto_rotation_enabled');
    return {
      enabled: enabledStr === undefined ? true : enabledStr === 'true',
      lastRotationDate: map.get('last_weekly_rotation_date') || '',
      lastSummary: parsedSummary,
      nextScheduledKst: '매주 월요일 08:30 KST',
    };
  }

  static setWeeklyRotationEnabled(enabled, db = getDb()) {
    if (!db) throw new Error('DB 인스턴스를 찾을 수 없습니다.');
    const normalized = enabled === true || enabled === 'true' || enabled === 1 ? 'true' : 'false';
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('weekly_auto_rotation_enabled', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `).run(normalized, nowIso);
    return this.getWeeklyRotationStatus(db);
  }
}

export const getAllBotsWithArenaMetrics = (dbOverrideOrQuotes = null, maybeDb = null) =>
  BotService.getAllBotsWithArenaMetrics(dbOverrideOrQuotes, maybeDb);

export const syncActiveRealBotsAvailableKrw = (db = getDb(), tossBal = null) =>
  BotService.syncActiveRealBotsAvailableKrw(db, tossBal);

export const rotateWeeklyTopBotsByFamily = (liveQuotes = [], options = {}) =>
  BotService.rotateWeeklyTopBotsByFamily(liveQuotes, options);

export const getWeeklyRotationStatus = (db = getDb()) =>
  BotService.getWeeklyRotationStatus(db);

export const setWeeklyRotationEnabled = (enabled, db = getDb()) =>
  BotService.setWeeklyRotationEnabled(enabled, db);
