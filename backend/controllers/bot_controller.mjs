import { BotService } from '../services/bot_service.mjs';
import { TradeService } from '../services/trade_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class BotController {
  static getBots(req, res) {
    const bots = BotService.getBots();
    return sendJson(res, 200, { bots });
  }

  static async postAction(req, res, botId) {
    try {
      const { action, seedCapital } = await parseJsonBody(req);
      const result = await BotService.handleAction(botId, action, seedCapital);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postTrade(req, res, botId) {
    try {
      const body = await parseJsonBody(req);
      const { side, positionId } = body;
      const stockCode = body.stockCode || body.symbol;
      const result = await TradeService.executeManualTrade({ botId, side, stockCode, positionId });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postUpdate(req, res, botId) {
    try {
      const body = await parseJsonBody(req);
      const result = BotService.updateBot(botId, body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static postPromote(req, res, botId) {
    try {
      const result = TradeService.promoteToReal(botId);
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }
}
