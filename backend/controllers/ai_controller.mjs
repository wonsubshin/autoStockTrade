import { AiService } from '../services/ai_service.mjs';
import { sendJson, sendError, parseJsonBody } from '../routes/router_helpers.mjs';

export class AiController {
  // 1. GET /api/ai/briefing : 최신 시황 브리핑, API 키 설정 여부, 잔여 쿼터 조회
  static getBriefing(req, res) {
    try {
      const state = AiService.getBriefingState();
      return sendJson(res, 200, state);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // 2. GET /api/ai/quota : 무료 API 잔여 쿼터 및 자동 스케줄 상태 조회
  static getQuota(req, res) {
    try {
      const quota = AiService.getQuotaStatus();
      return sendJson(res, 200, quota);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // 3. POST /api/ai/save-key : Gemini API 키 저장 (config/stock_config.json)
  static async postSaveKey(req, res) {
    try {
      const body = await parseJsonBody(req);
      const { gemini_api_key } = body || {};
      const keyInfo = AiService.saveGeminiKey(gemini_api_key || '');
      const quota = AiService.getQuotaStatus();
      return sendJson(res, 200, {
        success: true,
        has_key: keyInfo.has_key,
        masked_key: keyInfo.masked_key,
        quota,
      });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // 4. POST /api/ai/analyze : 단건 비스트리밍 분석 실행 및 DB 저장
  static async postAnalyze(req, res) {
    try {
      const result = await AiService.generateAiMarketAnalysis({ triggerType: 'MANUAL' });
      return sendJson(res, 200, {
        success: true,
        latest: result,
        quota: result.quota,
      });
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED' || err.statusCode === 429) {
        return sendJson(res, 429, {
          error: true,
          quotaExceeded: true,
          message: err.message || '금일 무료 api 호출 한도에 도달했습니다. 내일 다시 시도해주세요',
          quota: err.quota || AiService.getQuotaStatus(),
        });
      }
      return sendError(res, 500, err.message);
    }
  }

  // 5. POST (및 GET) /api/ai/stream-analyze : SSE 실시간 스트리밍 분석 실행 및 DB 저장
  static async streamAnalyze(req, res) {
    return await AiService.generateAiMarketAnalysisStream(req, res, { triggerType: 'MANUAL' });
  }

  static getDecisions(req, res, urlObj) {
    const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
    const modelType = urlObj.searchParams.get('model_type') || null;
    const decisions = AiService.getRecentDecisions(limit, modelType);
    const hybridDecisions = AiService.getHybridDecisions();
    const latestAnalysis = AiService.getLatestAnalysis();
    const quota = AiService.getQuotaStatus();
    const briefingState = AiService.getBriefingState();
    return sendJson(res, 200, {
      decisions,
      hybridDecisions,
      latestAnalysis,
      latest: briefingState.latest,
      has_key: briefingState.has_key,
      masked_key: briefingState.masked_key,
      last_trigger_type: briefingState.last_trigger_type,
      quota,
    });
  }

  static async postEvaluateAndTrade(req, res) {
    try {
      const body = await parseJsonBody(req);
      const { botId, executeTrade, candidateCode } = body;
      const result = await AiService.evaluateAndTrade({ botId, candidateCode, executeTrade });
      return sendJson(res, 200, {
        success: true,
        decisions: result.decisions,
        latestAnalysis: result.latestAnalysis,
        executedResult: result.executedResult,
        quota: result.quota,
      });
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED' || err.statusCode === 429) {
        return sendJson(res, 429, {
          error: true,
          quotaExceeded: true,
          message: err.message,
          quota: err.quota || AiService.getQuotaStatus(),
        });
      }
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

