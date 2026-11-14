import { BotService } from '../services/bot_service.mjs';
import { TradeService } from '../services/trade_service.mjs';
import { schedulerService } from '../services/scheduler_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class BotController {
  static getBots(req, res) {
    const bots = BotService.getAllBotsWithArenaMetrics(schedulerService.lastCandidateQuotes || []);
    return sendJson(res, 200, { bots });
  }

  static getWeeklyRotationStatus(req, res) {
    try {
      const status = BotService.getWeeklyRotationStatus();
      return sendJson(res, 200, status);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  static async postRotateWeeklyTop(req, res) {
    try {
      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch (_) {}
      const trigger = body?.trigger || 'MANUAL';
      const result = await BotService.rotateWeeklyTopBotsByFamily(
        schedulerService.lastCandidateQuotes || [],
        { trigger }
      );
      const status = BotService.getWeeklyRotationStatus();
      return sendJson(res, 200, {
        ...result,
        status,
        message: '3대 전략군(돌파·추세·회귀) 주간 1위 봇 3대로 실전 담당 무중단 로테이션이 완료되었습니다.',
      });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
  }

  static async postWeeklyRotationToggle(req, res) {
    try {
      const { enabled } = await parseJsonBody(req);
      const status = BotService.setWeeklyRotationEnabled(enabled);
      return sendJson(res, 200, {
        success: true,
        ...status,
        message: status.enabled
          ? '매주 월요일 08:30 자동 전략군 로테이션이 활성화(ON)되었습니다.'
          : '매주 월요일 08:30 자동 전략군 로테이션이 비활성화(OFF)되었습니다.',
      });
    } catch (err) {
      return sendError(res, 400, err.message);
    }
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

