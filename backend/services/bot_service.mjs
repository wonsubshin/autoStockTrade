import { getDb } from '../db/index.mjs';
import { kiwoomClient } from './market_service.mjs';
import { VirtualPaperTradingEngine } from '../common/virtual_engine.mjs';

export const virtualEngine = new VirtualPaperTradingEngine(getDb, kiwoomClient);

export class BotService {
  static getBots() {
    return this.getAllBotsWithArenaMetrics();
  }

  static getAllBotsWithArenaMetrics() {
    const db = getDb();
    if (!db) return [];

    const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
    const realTotal = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 10000000;
    const virtTotal = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;

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

      const initCap = Number(bot.virtual_initial_capital || 10000000);
      const totalEval = Number(bot.virtual_krw || 0) + Number(vOpen.open_amount || 0);
      const returnPct = ((totalEval - initCap) / initCap) * 100;
      const winRate = vStats.total_trades > 0 ? (vStats.wins / vStats.total_trades) * 100 : 0;

      // 2. 실전 매매 거래 통계 집계
      const rStats = db.prepare(`
        SELECT COUNT(*) as total_trades,
               COALESCE(SUM(profit_krw), 0) as realized_profit
        FROM trades
        WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'CLOSED'
      `).get(bot.bot_id);

      const rOpen = db.prepare(`
        SELECT COALESCE(SUM(buy_amount), 0) as open_amount,
               COUNT(*) as open_count
        FROM bot_positions
        WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
      `).get(bot.bot_id);

      const ratio = bot.allocation_ratio || (Number(bot.real_allocation_ratio) / 100) || 0.33;
      const realAllocated = bot.real_allocated_capital || Math.floor(realTotal * ratio);
      const virtualAllocated = Math.floor(virtTotal * ratio);

      return {
        ...bot,
        is_virtual_running: 1, // 상시 가상 거래 상태 보장
        virtual_total_assets: totalEval,
        virtual_return_pct: Number(returnPct.toFixed(2)),
        virtual_profit_krw: Number(vStats.realized_profit),
        virtual_win_rate: Number(winRate.toFixed(1)),
        virtual_trade_count: Number(vStats.total_trades),
        virtual_open_count: Number(vOpen.open_count || 0),
        real_profit_krw: Number(rStats.realized_profit),
        real_trade_count: Number(rStats.total_trades),
        real_open_count: Number(rOpen.open_count || 0),
        real_allocated_capital: realAllocated,
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
  static selectRealTradingBots(selectedBotIds) {
    if (!Array.isArray(selectedBotIds) || selectedBotIds.length < 1 || selectedBotIds.length > 3) {
      throw new Error('실전 거래 담당 봇은 최소 1개에서 최대 3개까지 선택해야 합니다.');
    }

    const db = getDb();
    const settingRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const realTotalBudget = Number(settingRow?.value || 10000000);

    const cnt = selectedBotIds.length;
    const baseRatio = Math.floor((100 / cnt) * 10) / 10;
    const nowIso = new Date().toISOString();

    db.exec('BEGIN');
    try {
      // 미선택 봇은 실전 담당 해제
      db.prepare(`
        UPDATE bots
        SET is_real_selected = 0,
            is_real_running = 0,
            real_allocation_ratio = 0,
            real_allocated_capital = 0,
            real_available_krw = 0,
            real_status_msg = '가상 아레나 전용 (실전 미선택)',
            updated_at = ?
      `).run(nowIso);

      let sumRatio = 0;
      selectedBotIds.forEach((botId, idx) => {
        const ratio = idx === cnt - 1 ? Number((100 - sumRatio).toFixed(1)) : baseRatio;
        sumRatio += ratio;
        const allocated = Math.floor(realTotalBudget * (ratio / 100));

        const openReal = db.prepare(`
          SELECT COALESCE(SUM(buy_amount), 0) as amt
          FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
        `).get(botId)?.amt || 0;

        const available = Math.max(0, allocated - Number(openReal));

        db.prepare(`
          UPDATE bots
          SET is_real_selected = 1,
              is_real_running = 1,
              trade_mode = 'REAL',
              real_allocation_ratio = ?,
              real_allocated_capital = ?,
              real_available_krw = ?,
              allocated_capital = ?,
              allocation_ratio = ?,
              real_status_msg = '실전 담당 지정 및 가동 중',
              updated_at = ?
          WHERE bot_id = ?
        `).run(ratio, allocated, available, allocated, ratio / 100, nowIso, botId);
      });

      db.exec('COMMIT');
      return this.getAllBotsWithArenaMetrics();
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // 환경설정에서 선택된 1~3개 실전 봇의 동적 투자금 비율(%) 및 총 예산 저장
  static updateRealBudgetAllocations(realTotalBudget, allocations) {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new Error('배분할 실전 봇 목록이 비어 있습니다.');
    }

    const sum = allocations.reduce((acc, cur) => acc + Number(cur.ratio || 0), 0);
    if (Math.abs(sum - 100) > 0.5) {
      throw new Error(`선택된 실전 봇들의 투자 비율 합계는 100%여야 합니다. (현재: ${sum.toFixed(1)}%)`);
    }

    const db = getDb();
    const nowIso = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('real_total_budget', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `).run(String(realTotalBudget), nowIso);

      for (const item of allocations) {
        const ratio = Number(item.ratio);
        const allocated = Math.floor(realTotalBudget * (ratio / 100));

        const openReal = db.prepare(`
          SELECT COALESCE(SUM(buy_amount), 0) as amt
          FROM bot_positions WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
        `).get(item.bot_id)?.amt || 0;

        const available = Math.max(0, allocated - Number(openReal));

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
      const res = virtualEngine.resetAllVirtual(seedCapital);
      return {
        success: true,
        message: `전체 가상 봇(${res.count}개)의 보유 포지션 및 누적 거래내역이 완전히 삭제되었습니다. 초기 자본금으로 새로운 거래를 시작합니다.`,
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
