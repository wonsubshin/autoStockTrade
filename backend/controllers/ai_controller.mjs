import { AiService } from '../services/ai_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class AiController {
  static getDecisions(req, res, urlObj) {
    const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
    const decisions = AiService.getRecentDecisions(limit);
    return sendJson(res, 200, { decisions });
  }

  static async postEvaluateAndTrade(req, res) {
    try {
      const body = await parseJsonBody(req);
      const { botId, executeTrade, candidateCode } = body;
      const result = await AiService.evaluateAndTrade({ botId, candidateCode, executeTrade });
      return sendJson(res, 200, {
        success: true,
        decisions: result.decisions,
        executedResult: result.executedResult,
      });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  static async streamBriefing(req, res) {
    return await AiService.streamMarketBriefing(res, req);
  }

  static async streamNewsAnalyze(req, res) {
    return await AiService.streamNewsAnalyze(res, req);
  }
}
