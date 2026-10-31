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
    const tossMaxCash = tossBal.availableCash || 0;

    const numReal = parseInt(realTotalBudget, 10) || 0;
    const numVirtual = parseInt(virtualTotalBudget, 10) || 0;

    // 비즈니스 규칙: 실제 사용 예산은 토스 실잔고(주문 가능 예수금)를 초과할 수 없음
    if (numReal > tossMaxCash) {
      throw new Error(`실제 사용 예산(${numReal.toLocaleString()}원)은 현재 토스증권 주문 가능 예수금(${tossMaxCash.toLocaleString()}원)을 초과할 수 없습니다.`);
    }

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
            updated_at = ?
        WHERE bot_id = ?
      `);
      for (const b of botAllocations) {
        const ratio = parseFloat(b.ratio) / 100;
        const allocatedCap = Math.floor(numVirtual * ratio);
        stmtBotUpdate.run(ratio, allocatedCap, nowIso, b.bot_id);
      }
    }

    return {
      virtualTotalBudget: numVirtual,
      realTotalBudget: numReal,
    };
  }
}
