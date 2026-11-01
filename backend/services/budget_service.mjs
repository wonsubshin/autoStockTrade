import { getDb } from '../db/index.mjs';
import { tossClient } from './market_service.mjs';

export class BudgetService {
  static async getBudgetSettings() {
    const db = getDb();
    const vRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
    const rRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const tossBal = await tossClient.getAccountBalance();
    const bots = db.prepare('SELECT bot_id, name, nickname, trade_mode, allocation_ratio, allocated_capital, virtual_krw, is_running FROM bots ORDER BY bot_id ASC').all();

    return {
      virtualTotalBudget: vRow ? parseInt(vRow.value, 10) : 30000000,
      realTotalBudget: rRow ? parseInt(rRow.value, 10) : 10000000,
      tossAvailableCash: tossBal.availableCash || 0,
      tossTotalAssetAmount: tossBal.totalAssetAmount || 0,
      bots,
    };
  }

  static async saveBudgetSettings({ virtualTotalBudget, realTotalBudget, botAllocations }) {
    const db = getDb();
    const tossBal = await tossClient.getAccountBalance();

    const numReal = parseInt(realTotalBudget, 10) || 0;
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
        stmtBotUpdate.run(
          ratioFrac,
          allocatedCap,
          ratioPercent,
          realAllocatedCap,
          realAllocatedCap,
          nowIso,
          b.bot_id
        );
      }
    }

    return {
      virtualTotalBudget: numVirtual,
      realTotalBudget: numReal,
    };
  }
}

