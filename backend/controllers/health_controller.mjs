import { MarketService } from '../services/market_service.mjs';
import { getDb } from '../db/index.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class HealthController {
  static async getHealth(req, res, pgSyncManager) {
    const health = await MarketService.getHealth();
    return sendJson(res, 200, {
      ok: true,
      service: 'autoStockTrader',
      architecture: '키움증권(시세) ⨉ Gemini LLM(판단) ⨉ Python/토스(소수점 매매)',
      hybridModel: {
        llmEngine: 'Google Gemini (News/Catalyst AI Inference)',
        pythonExecutor: 'Python Core Toss Executor (Fractional & Unit Orders)',
        fractionalTrading: true,
      },
      uptime: process.uptime(),
      kiwoomHealth: health.kiwoomHealth,
      tossHealth: health.tossHealth,
      apiHealth: health.kiwoomHealth, // backward compatible
      marketStatus: health.marketStatus,
      marketRegime: health.regimeInfo,
      pgConnected: pgSyncManager?.isConnected || false,
      pgLocation: pgSyncManager?.config?.location || 'local',
      timestamp: new Date().toISOString(),
    });
  }

  static async postGate(req, res) {
    const { passcode } = await parseJsonBody(req);
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'gate_passcode'").get();
    const expectedPasscode = row ? row.value : 'sws@2129';

    if (passcode === expectedPasscode) {
      return sendJson(res, 200, { success: true, token: 'AUTH_GATE_PASSED_2026' });
    } else {
      return sendError(res, 401, '입장 코드가 올바르지 않습니다.');
    }
  }
}

