import { getDb } from '../db/index.mjs';
import { tossClient } from './market_service.mjs';
import { BotService } from './bot_service.mjs';

export class BudgetService {
  static async getBudgetSettings() {
    const db = getDb();
    const tossBal = await tossClient.getAccountBalance();

    // 토스 실시간 주문가능 예수금의 90%를 운영원금으로 동적 산출 및 실전 봇 실시간 분배
    const dynamicRealBudget = BotService.syncDynamicRealBudget(db, tossBal);

    const vRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
    const bots = db.prepare('SELECT bot_id, name, nickname, trade_mode, allocation_ratio, allocated_capital, real_allocation_ratio, real_allocated_capital, real_available_krw, virtual_krw, is_running FROM bots ORDER BY bot_id ASC').all();

    return {
      virtualTotalBudget: vRow ? parseInt(vRow.value, 10) : 10000000,
      realTotalBudget: dynamicRealBudget,
      operatingBudget: dynamicRealBudget,
      tossAvailableCash: tossBal.availableCash || 0,
      tossAvailableUsd: tossBal.availableUsd || 0,
      tossTotalCashKrw: tossBal.totalCashKrw || tossBal.availableCash || 0,
      tossTotalAssetAmount: tossBal.totalAssetAmount || 0,
      bots,
    };
  }

  static async saveBudgetSettings({ virtualTotalBudget, realTotalBudget, botAllocations }) {
    const db = getDb();
    const tossBal = await tossClient.getAccountBalance();

    // 토스 실시간 주문가능 예수금(원화 + 달러 환산)의 90% 자동 계산
    const dynamicReal = BotService.syncDynamicRealBudget(db, tossBal);
    const numReal = dynamicReal > 0 ? dynamicReal : (parseInt(realTotalBudget, 10) || 0);
    const numVirtual = parseInt(virtualTotalBudget, 10) || 0;

    const nowIso = new Date().toISOString();
    const stmtSet = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `);
    stmtSet.run('virtual_total_budget', String(numVirtual), nowIso);
    stmtSet.run('real_total_budget', String(numReal), nowIso);

    if (Array.isArray(botAllocations)) {
      const stmtBotUpdate = db.prepare(`
        UPDATE bots
        SET allocation_ratio = ?,
            allocated_capital = ?,
            real_allocation_ratio = ?,
            real_allocated_capital = ?,
            real_available_krw = ?,
            updated_at = ?
        WHERE bot_id = ?
      `);
      for (const b of botAllocations) {
        const ratioPercent = parseFloat(b.ratio) || 0;
        const ratioFrac = ratioPercent / 100;
        const allocatedCap = Math.floor(numVirtual * ratioFrac);
        const realAllocatedCap = Math.floor(numReal * ratioFrac);

        const openReal = db.prepare(`
          SELECT COALESCE(SUM(buy_amount), 0) as amt
          FROM bot_positions
          WHERE bot_id = ? AND trade_mode = 'REAL' AND status = 'OPEN'
            AND (order_no NOT LIKE 'TOSS_SYNC_%' OR order_no IS NULL)
        `).get(b.bot_id)?.amt || 0;
        const availKrw = Math.max(0, realAllocatedCap - Number(openReal));

        stmtBotUpdate.run(
          ratioFrac,
          allocatedCap,
          ratioPercent,
          realAllocatedCap,
          availKrw,
          nowIso,
          b.bot_id
        );
      }
    }

    return {
      virtualTotalBudget: numVirtual,
      realTotalBudget: numReal,
      operatingBudget: numReal,
    };
  }
}

