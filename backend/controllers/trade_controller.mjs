import { TradeService } from '../services/trade_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class TradeController {
  static getTrades(req, res, urlObj) {
    const mode = urlObj.searchParams.get('mode');
    const botId = urlObj.searchParams.get('botId');
    const limit = parseInt(urlObj.searchParams.get('limit') || '100', 10);
    const trades = TradeService.getTrades({ mode, botId, limit });
    return sendJson(res, 200, { trades });
  }

  static async getPositions(req, res, urlObj) {
    const mode = urlObj.searchParams.get('mode');
    const botId = urlObj.searchParams.get('botId');
    const positions = await TradeService.getPositions({ mode, botId });
    return sendJson(res, 200, { positions });
  }

  static getStats(req, res, urlObj) {
    const mode = urlObj.searchParams.get('mode');
    const period = urlObj.searchParams.get('period') || 'daily';
    const stats = TradeService.getStats({ mode, period });
    return sendJson(res, 200, stats);
  }

  static getLeaderboard(req, res) {
    const leaderboard = TradeService.getLeaderboard();
    return sendJson(res, 200, { leaderboard });
  }

  static async postFastReplay(req, res) {
    try {
      const body = await parseJsonBody(req);
      const seedCapital = body.seedCapital || 10000000;
      const result = await TradeService.runFastReplayTest(seedCapital);
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }
}
