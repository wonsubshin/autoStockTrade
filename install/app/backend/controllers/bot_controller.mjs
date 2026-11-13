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

  static async postSelectReal(req, res) {
    try {
      const { selectedBotIds } = await parseJsonBody(req);
      const { bots, inheritance, retained } = await BotService.selectRealTradingBots(selectedBotIds);
      const nameOf = (id) => {
        const b = bots.find((x) => x.bot_id === id);
        return b ? (b.nickname || b.name || id) : id;
      };
      const inheritMsg = inheritance.length > 0
        ? '\n\n[거래정보 승계]\n' + inheritance
            .map((i) => `• ${nameOf(i.from)} → ${nameOf(i.to)} (미매도 ${i.open_positions}건, 거래내역 ${i.trades}건)`)
            .join('\n')
        : '';
      return sendJson(res, 200, {
        success: true,
        message: `실전 거래 담당 봇 ${Array.isArray(selectedBotIds) ? selectedBotIds.length : 3}개가 성공적으로 선택 및 지정되었습니다.${inheritMsg}`,
        bots,
        inheritance,
        retained,
      });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postRealToggle(req, res, botId) {
    try {
      const { is_real_running } = await parseJsonBody(req);
      const result = BotService.toggleRealRunning(botId, is_real_running);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postConfig(req, res, botId) {
    try {
      const body = await parseJsonBody(req);
      const bots = BotService.updateStrategyConfig(botId, body);
      return sendJson(res, 200, { ok: true, bots });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postResetConfig(req, res) {
    try {
      const body = await parseJsonBody(req);
      const bots = BotService.resetStrategyConfig(body?.botId || 'ALL');
      return sendJson(res, 200, { ok: true, bots });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }
}

