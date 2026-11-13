import { getDb } from '../db/index.mjs';
import { kiwoomClient, tossClient } from './market_service.mjs';
import { VirtualPaperTradingEngine } from '../common/virtual_engine.mjs';

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

          const openAmt = db.prepare(`
            SELECT COALESCE(SUM(buy_amount), 0) as amt
            FROM bot_positions
            WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
              AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)
          `).get(b.bot_id)?.amt || 0;

          // 2.3 누적 실현손익 복리 반영
          const rProfitRow = db.prepare(`
            SELECT COALESCE(SUM(profit_krw), 0) as profit
            FROM trades
            WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED'
              AND (buy_order_no NOT LIKE 'VORD_%' OR buy_order_no IS NULL)
          `).get(b.bot_id);
          const rProfit = Number(rProfitRow?.profit || 0);

          const availKrw = Math.max(0, allocatedCap + rProfit - Number(openAmt));

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

  static getAllBotsWithArenaMetrics() {
    const db = getDb();
    if (!db) return [];

    const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
    const realTotal = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;
    const virtTotal = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 10000000;

    const rawBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();

    return rawBots.map((bot) => {
      // 1. 가상 매매 거래 통계 집계
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

      // 2.2 가상 평가자산(virtual_total_assets)의 실시간 시가 평가(Mark-to-Market) 반영
      const vOpenPositions = db.prepare(`
        SELECT stock_code, qty, avg_buy_price, buy_amount, buy_fee
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'VIRTUAL' AND status = 'OPEN'
      `).all(bot.bot_id);

      let vOpenEvalSum = 0;
      let vOpenUnrealizedSum = 0;
      for (const pos of vOpenPositions) {
        const quote = kiwoomClient.priceCache.get(pos.stock_code)?.data || tossClient.priceCache.get(pos.stock_code)?.data;
        const curPrice = Number(quote?.currentPrice || pos.avg_buy_price || 0);
        const qty = Number(pos.qty || 0);
        const buyAmt = Number(pos.buy_amount || 0);
        const buyFee = Number(pos.buy_fee || 0);
        const evalAmt = Math.round(curPrice * qty);
        vOpenEvalSum += evalAmt;
        vOpenUnrealizedSum += (evalAmt - buyAmt - buyFee);
      }

      const initCap = Number(bot.virtual_initial_capital || 1000000);
      const totalEval = Number(bot.virtual_krw || 0) + vOpenEvalSum;
      const returnPct = initCap > 0 ? ((totalEval - initCap) / initCap) * 100 : 0;
      const totalTrades = Number(vStats?.total_trades || 0);
      const winTrades = Number(vStats?.wins || 0);
      const lossTrades = totalTrades - winTrades;
      const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

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

      const ratio = bot.allocation_ratio || (Number(bot.real_allocation_ratio) / 100) || 0.1;
      const realAllocated = Math.round(Number(bot.real_allocated_capital || Math.floor(realTotal * (Number(bot.real_allocation_ratio || 33.3) / 100))));
      const virtualAllocated = Math.round(Number(bot.virtual_initial_capital || 1000000));

      return {
        ...bot,
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
        real_profit_krw: Number(rStats.realized_profit),
        real_trade_count: Number(rStats.total_trades),
        real_open_count: Number(rOpen.open_count || 0),
        real_allocated_capital: realAllocated,
        real_available_krw: Math.round(Number(bot.real_available_krw || 0)),
        virtual_allocated_capital: virtualAllocated,
        allocated_capital: bot.is_real_selected === 1 ? realAllocated : virtualAllocated,
      };
    });
  }

  static getBotById(botId) {
    const db = getDb();
    return db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
  }

  // 1~3개 실전 담당 봇 선택 확정
  // - 유지된 봇: 기존 실전 거래정보/미매도 포지션/투자 비율을 그대로 보유
  // - 교체된 봇: 해제되는 기존 봇의 실전 거래정보(거래내역 + 미매도 포지션)와 투자 비율을
  //   신규 봇이 1:1로 승계하여 이어서 매매 (해제 봇 순서 ↔ 신규 봇 선택 순서로 매칭)
  static async selectRealTradingBots(selectedBotIds) {
    if (!Array.isArray(selectedBotIds) || selectedBotIds.length < 1 || selectedBotIds.length > 3) {
      throw new Error('실전 거래 담당 봇은 1개에서 최대 3개까지 선택해야 합니다.');
    }
    if (new Set(selectedBotIds).size !== selectedBotIds.length) {
      throw new Error('실전 거래 담당 봇은 서로 다른 봇을 선택해야 합니다.');
    }

    const db = getDb();

    // 토스 실시간 주문가능 예수금(원화 + 달러 환산)의 90%를 총 실전 운영원금으로 동적 산출
    let dynamicBudget = 0;
    try {
      const tossBal = await tossClient.getAccountBalance();
      dynamicBudget = this.syncDynamicRealBudget(db, tossBal);
    } catch (e) {}

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

    // 실전 선택 해제는 되었지만 아직 미매도 실전 포지션이 남아있는 봇(과거 교체로 고아가 된 포지션)도 승계 대상에 포함
    const orphanIds = db.prepare(`
      SELECT DISTINCT bot_id FROM bot_positions
      WHERE trade_mode = 'REAL' AND status = 'OPEN'
    `).all().map((r) => r.bot_id).filter((id) => id && !prevIds.includes(id) && !selectedBotIds.includes(id));

    const retainedIds = selectedBotIds.filter((id) => prevIds.includes(id));
    const addedIds = selectedBotIds.filter((id) => !prevIds.includes(id));
    const removedIds = [...prevIds.filter((id) => !selectedBotIds.includes(id)), ...orphanIds];

    // 1.2 승계 매핑: 해제되는 봇의 미청산 포지션이 고아 상태로 방치되지 않도록
    // 신규 추가 봇(addedIds) 또는 남은 선택 봇(selectedBotIds)으로 100% 인계
    const successionMap = []; // { from, to }
    const targetSuccessors = addedIds.length > 0 ? addedIds : selectedBotIds;
    if (targetSuccessors.length > 0 && removedIds.length > 0) {
      removedIds.forEach((fromId, idx) => {
        successionMap.push({ from: fromId, to: targetSuccessors[idx % targetSuccessors.length] });
      });
    }

    db.exec('BEGIN');
    try {
      // 1) 거래정보 승계 (실전 거래내역 전체 + 미매도 실전 포지션)
      const inheritance = [];
      for (const { from, to } of successionMap) {
        const posRes = db.prepare(`
          UPDATE bot_positions
          SET origin_bot_id = COALESCE(origin_bot_id, bot_id),
              bot_id = ?
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
        `).run(to, from);

        const tradeRes = db.prepare(`
          UPDATE trades
          SET origin_bot_id = COALESCE(origin_bot_id, bot_id),
              bot_id = ?
          WHERE bot_id = ? AND trade_mode = 'REAL'
        `).run(to, from);

        inheritance.push({
          from,
          to,
          open_positions: Number(posRes?.changes || 0),
          trades: Number(tradeRes?.changes || 0),
        });
      }

      // 2) 투자 비율 결정: 유지 봇은 기존 비율, 신규 봇은 승계 대상(첫 번째 해제 봇)의 비율 승계
      const ratioMap = new Map();
      retainedIds.forEach((id) => ratioMap.set(id, prevRatioMap.get(id) || 0));
      addedIds.forEach((id) => {
        const src = successionMap.find((m) => m.to === id && prevRatioMap.has(m.from));
        ratioMap.set(id, src ? prevRatioMap.get(src.from) || 0 : 0);
      });
      const assignedSum = [...ratioMap.values()].reduce((a, b) => a + b, 0);
      const zeroIds = selectedBotIds.filter((id) => !(ratioMap.get(id) > 0));
      if (zeroIds.length > 0) {
        // 비율 정보가 없는 봇은 남은 비율을 균등 분배 (남은 비율이 없으면 전체 균등 재배분)
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
        // 합계가 100%가 아니면 선택된 봇 개수에 맞춰 균등 배분으로 복구
        const count = selectedBotIds.length;
        let acc = 0;
        selectedBotIds.forEach((id, idx) => {
          const r = idx === count - 1 ? Number((100 - acc).toFixed(1)) : Number((100 / count).toFixed(1));
          acc += r;
          ratioMap.set(id, r);
        });
      }

      // 3) 미선택 봇은 실전 담당 해제
      const notInPlaceholders = selectedBotIds.map(() => '?').join(', ');
      db.prepare(`
        UPDATE bots
        SET is_real_selected = 0,
            is_real_running = 0,
            real_allocation_ratio = 0,
            real_allocated_capital = 0,
            real_available_krw = 0,
            real_status_msg = '가상 아레나 전용 (실전 미선택)',
            updated_at = ?
        WHERE bot_id NOT IN (${notInPlaceholders})
      `).run(nowIso, ...selectedBotIds);

      // 4) 선택 봇 실전 지정 (승계된 포지션 반영 후 가용 자금 재계산)
      for (const botId of selectedBotIds) {
        const ratio = ratioMap.get(botId);
        const allocated = Math.floor(realTotalBudget * (ratio / 100));

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

        const inherited = inheritance.filter((i) => i.to === botId);
        const inheritedPos = inherited.reduce((a, b) => a + b.open_positions, 0);

        // 1.2 기존에 이미 실전 담당으로 가동 중이던(is_real_running = 1) 봇이 재선택된 경우 기존 가동 상태 그대로 유지
        const prevRun = prevRunningMap.get(botId);
        const targetRunning = prevRun !== undefined ? prevRun : 1;

        let statusMsg = retainedIds.includes(botId)
          ? (targetRunning === 1 ? '실전 담당 유지 및 가동 중' : '실전 담당 유지 (일시 정지 상태)')
          : '실전 담당 지정 및 가동 중';
        if (inherited.length > 0) {
          statusMsg = `실전 담당 지정 및 가동 중 (${inherited.map((i) => i.from).join(', ')} 거래정보 승계 · 미매도 ${inheritedPos}건 인수)`;
        }

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

      if (inheritance.length > 0) {
        console.log('[BotService] 실전 봇 교체 거래정보 승계:', JSON.stringify(inheritance));
      }

      return {
        bots: this.getAllBotsWithArenaMetrics(),
        inheritance,
        retained: retainedIds,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // 환경설정에서 선택된 1~3개 실전 봇의 동적 투자금 비율(%) 및 총 예산 저장
  static async updateRealBudgetAllocations(realTotalBudget, allocations) {
    if (!Array.isArray(allocations) || allocations.length < 1 || allocations.length > 3) {
      throw new Error('실전 거래 담당 봇(1~3개)의 비율을 설정해야 합니다.');
    }

    const sum = allocations.reduce((acc, cur) => acc + Number(cur.ratio || 0), 0);
    if (Math.abs(sum - 100) > 0.5) {
      throw new Error(`선택된 실전 봇들의 투자 비율 합계는 100%여야 합니다. (현재: ${sum.toFixed(1)}%)`);
    }

    const db = getDb();

    // 토스 실시간 주문가능 예수금(원화 + 달러 환산)의 90%를 총 실전 운영원금으로 동적 산출
    let dynamicBudget = 0;
    try {
      const tossBal = await tossClient.getAccountBalance();
      dynamicBudget = this.syncDynamicRealBudget(db, tossBal);
    } catch (e) {}

    const targetBudget = dynamicBudget > 0 ? dynamicBudget : (Number(realTotalBudget) || 10000000);
    const nowIso = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('real_total_budget', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `).run(String(targetBudget), nowIso);

      for (const item of allocations) {
        const ratio = Number(item.ratio);
        const allocated = Math.floor(targetBudget * (ratio / 100));

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
      return this.getAllBotsWithArenaMetrics();
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
        message: `전체 10대 가상 봇의 보유 포지션 및 누적 거래내역이 완전히 삭제되었습니다. 각 봇 초기 자본금 100만 원, 모든 성과 지표(수익률, 손익, 승률, 익절/손절) 0으로 신규 경쟁을 시작합니다.`,
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
}
