import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.mjs';
import { BROKER_CONFIG_PATH, PROJECT_ROOT } from '../config/env.mjs';
import { BudgetService } from '../services/budget_service.mjs';
import { BotService } from '../services/bot_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class SettingsController {
  static getSettings(req, res) {
    const db = getDb();
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
    const settingsMap = {};
    for (const r of rows) settingsMap[r.key] = r.value;
    if (!settingsMap.purchase_priority) {
      settingsMap.purchase_priority = JSON.stringify(['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']);
    }
    if (!settingsMap.gate_passcode) {
      settingsMap.gate_passcode = process.env.GATE_PASSCODE || 'sws@2129';
    }
    if (!settingsMap.virtual_fast_cycle_mode) {
      settingsMap.virtual_fast_cycle_mode = '0';
    }

    let tunnelUrl = process.env.PUBLIC_URL || '';
    if (!tunnelUrl && PROJECT_ROOT) {
      const tunnelLogPath = path.join(PROJECT_ROOT, 'logs', 'tunnel.log');
      if (fs.existsSync(tunnelLogPath)) {
        try {
          const logContent = fs.readFileSync(tunnelLogPath, 'utf8');
          const matches = logContent.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
          if (matches && matches.length > 0) {
            tunnelUrl = matches[matches.length - 1];
          }
        } catch (e) {}
      }
    }

    let bConf = {
      account_mode: 'VIRTUAL',
      kiwoom: { app_key: '', app_secret: '' },
      toss: { api_key: '', api_secret: '', account_no: '' },
      gemini: { api_key: '' },
    };
    if (fs.existsSync(BROKER_CONFIG_PATH)) {
      try {
        bConf = JSON.parse(fs.readFileSync(BROKER_CONFIG_PATH, 'utf8'));
      } catch (e) {}
    }

    return sendJson(res, 200, {
      settings: settingsMap,
      tunnelUrl: tunnelUrl || null,
      brokerConfig: {
        account_mode: bConf.account_mode || 'VIRTUAL',
        has_kiwoom_keys: !!(bConf.kiwoom?.app_key && bConf.kiwoom?.app_secret),
        has_toss_keys: !!(bConf.toss?.api_key && bConf.toss?.api_secret && bConf.toss?.account_no),
        has_gemini_key: !!(bConf.gemini?.api_key || process.env.GEMINI_API_KEY),
        kiwoom_app_key: bConf.kiwoom?.app_key ? '••••••••••••••••' : '',
        kiwoom_app_secret: bConf.kiwoom?.app_secret ? '••••••••••••••••' : '',
        toss_api_key: bConf.toss?.api_key ? '••••••••••••••••' : '',
        toss_api_secret: bConf.toss?.api_secret ? '••••••••••••••••' : '',
        toss_account_no: bConf.toss?.account_no ? '••••••••' : '',
        gemini_api_key: bConf.gemini?.api_key || process.env.GEMINI_API_KEY ? '••••••••••••••••' : '',
      },
    });
  }

  static async postSettings(req, res) {
    const db = getDb();
    const body = await parseJsonBody(req);
    const nowIso = new Date().toISOString();

    if (body.settings) {
      const stmt = db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `);
      for (const [k, v] of Object.entries(body.settings)) {
        stmt.run(k, String(v), nowIso);
      }
    }

    if (body.brokerConfig || body.kisConfig) {
      let currentConf = {
        account_mode: 'VIRTUAL',
        kiwoom: { app_key: '', app_secret: '', base_url: 'https://openapi.kiwoom.com' },
        toss: { api_key: '', api_secret: '', account_no: '', base_url: 'https://api.tossinvest.com' },
        gemini: { api_key: '', model: 'gemini-2.5-flash' },
      };
      if (fs.existsSync(BROKER_CONFIG_PATH)) {
        try {
          currentConf = JSON.parse(fs.readFileSync(BROKER_CONFIG_PATH, 'utf8'));
        } catch (e) {}
      }

      const bc = body.brokerConfig || body.kisConfig;
      if (bc.account_mode) currentConf.account_mode = bc.account_mode;

      if (bc.kiwoom_app_key && !bc.kiwoom_app_key.startsWith('•')) currentConf.kiwoom.app_key = bc.kiwoom_app_key;
      if (bc.kiwoom_app_secret && !bc.kiwoom_app_secret.startsWith('•')) currentConf.kiwoom.app_secret = bc.kiwoom_app_secret;

      if (bc.toss_api_key && !bc.toss_api_key.startsWith('•')) currentConf.toss.api_key = bc.toss_api_key;
      if (bc.toss_api_secret && !bc.toss_api_secret.startsWith('•')) currentConf.toss.api_secret = bc.toss_api_secret;
      if (bc.toss_account_no && !bc.toss_account_no.startsWith('•')) currentConf.toss.account_no = bc.toss_account_no;

      if (bc.gemini_api_key && !bc.gemini_api_key.startsWith('•')) {
        currentConf.gemini.api_key = bc.gemini_api_key;
        process.env.GEMINI_API_KEY = bc.gemini_api_key;
      }

      fs.writeFileSync(BROKER_CONFIG_PATH, JSON.stringify(currentConf, null, 2), 'utf8');
    }

    return sendJson(res, 200, { success: true, message: '설정이 성공적으로 저장되었습니다.' });
  }

  static async getBudgetSettings(req, res) {
    try {
      const result = await BudgetService.getBudgetSettings();
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  static async postBudgetSettings(req, res) {
    try {
      const body = await parseJsonBody(req);
      const result = await BudgetService.saveBudgetSettings(body);
      return sendJson(res, 200, {
        success: true,
        message: '예산 및 봇별 배분율이 성공적으로 저장되었습니다.',
        ...result,
      });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static exportBackup(req, res) {
    const db = getDb();
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      system_settings: db.prepare('SELECT * FROM system_settings').all(),
      bots: db.prepare('SELECT * FROM bots').all(),
      trades: db.prepare('SELECT * FROM trades').all(),
      bot_positions: db.prepare('SELECT * FROM bot_positions').all(),
      virtual_performance_logs: db.prepare('SELECT * FROM virtual_performance_logs').all(),
      ai_market_briefings: db.prepare('SELECT * FROM ai_market_briefings').all(),
      stock_news: db.prepare('SELECT * FROM stock_news').all(),
      ai_news_briefings: db.prepare('SELECT * FROM ai_news_briefings').all(),
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="kis_quant_backup_${Date.now()}.json"`,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(exportData, null, 2));
  }

  static async importBackup(req, res) {
    const db = getDb();
    const data = await parseJsonBody(req);
    if (!data || !data.bots || !data.system_settings) {
      return sendError(res, 400, '올바른 백업 JSON 형식이 아닙니다.');
    }

    const stmtSet = db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at');
    for (const s of data.system_settings || []) {
      stmtSet.run(s.key, s.value, s.updated_at || new Date().toISOString());
    }

    const stmtBot = db.prepare(`
      INSERT INTO bots (bot_id, name, nickname, strategy_type, trade_mode, description,
                        allocation_ratio, allocated_capital, virtual_krw, is_running,
                        min_volume_krw, stop_loss_pct, take_profit_pct, config_json, last_status_msg, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (bot_id) DO UPDATE SET
        name = EXCLUDED.name, nickname = EXCLUDED.nickname, virtual_krw = EXCLUDED.virtual_krw,
        is_running = EXCLUDED.is_running, stop_loss_pct = EXCLUDED.stop_loss_pct, take_profit_pct = EXCLUDED.take_profit_pct
    `);
    for (const b of data.bots || []) {
      stmtBot.run(
        b.bot_id, b.name, b.nickname, b.strategy_type, b.trade_mode, b.description,
        b.allocation_ratio, b.allocated_capital, b.virtual_krw, b.is_running,
        b.min_volume_krw, b.stop_loss_pct, b.take_profit_pct, b.config_json, b.last_status_msg, b.updated_at
      );
    }

    return sendJson(res, 200, { success: true, message: '데이터가 성공적으로 복원되었습니다.' });
  }

  static async postRealAllocation(req, res) {
    try {
      const { realTotalBudget, allocations } = await parseJsonBody(req);
      const bots = await BotService.updateRealBudgetAllocations(realTotalBudget, allocations);
      return sendJson(res, 200, {
        success: true,
        message: '선택된 실전 담당 봇들의 투자금 배분 비율이 성공적으로 저장되었습니다.',
        bots,
      });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }
}

