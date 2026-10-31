import { getDb } from '../db/index.mjs';
import { kiwoomClient } from './market_service.mjs';
import { VirtualPaperTradingEngine } from '../common/virtual_engine.mjs';

export const virtualEngine = new VirtualPaperTradingEngine(getDb, kiwoomClient);

export class BotService {
  static getBots() {
    const db = getDb();
    const realBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'real_total_budget'").get();
    const virtBudgetRow = db.prepare("SELECT value FROM system_settings WHERE key = 'virtual_total_budget'").get();
    const realTotal = realBudgetRow ? parseInt(realBudgetRow.value, 10) : 0;
    const virtTotal = virtBudgetRow ? parseInt(virtBudgetRow.value, 10) : 30000000;

    const rawBots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
    return rawBots.map((b) => {
      const ratio = b.allocation_ratio || 0.33;
      const realAllocated = Math.floor(realTotal * ratio);
      const virtualAllocated = Math.floor(virtTotal * ratio);
      return {
        ...b,
        real_allocated_capital: realAllocated,
        virtual_allocated_capital: virtualAllocated,
        allocated_capital: b.trade_mode === 'REAL' ? realAllocated : virtualAllocated,
      };
    });
  }

  static getBotById(botId) {
    const db = getDb();
    return db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
  }

  static async handleAction(botId, action, seedCapital) {
    const db = getDb();
    const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
    if (!bot) throw new Error('해당 봇을 찾을 수 없습니다.');

    const nowIso = new Date().toISOString();

    if (action === 'START') {
      db.prepare("UPDATE bots SET is_running = 1, last_status_msg = '가동 중 (실시간 전략 실행)', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
      return { success: true, message: `[${bot.name}] 거래가 시작되었습니다.` };
    }

    if (action === 'STOP') {
      db.prepare("UPDATE bots SET is_running = 0, last_status_msg = '사용자 수동 중지됨', updated_at = ? WHERE bot_id = ?").run(nowIso, botId);
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
      const capital = seedCapital || 10000000;
      virtualEngine.resetVirtualBalance(botId, capital);
      return { success: true, message: `[${bot.name}] 가상 계좌가 초기화되었습니다. (시드: ${capital.toLocaleString()}원)` };
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
