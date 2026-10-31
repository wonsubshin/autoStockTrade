import { HealthController } from '../controllers/health_controller.mjs';
import { BotController } from '../controllers/bot_controller.mjs';
import { TradeController } from '../controllers/trade_controller.mjs';
import { MarketController } from '../controllers/market_controller.mjs';
import { AiController } from '../controllers/ai_controller.mjs';
import { NewsController } from '../controllers/news_controller.mjs';
import { SettingsController } from '../controllers/settings_controller.mjs';
import { sendError } from './router_helpers.mjs';

export class Router {
  constructor({ pgSyncManager, newsService }) {
    this.pgSyncManager = pgSyncManager;
    this.newsService = newsService;
  }

  async handleRequest(req, res) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const method = req.method;

    // CORS Preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    try {
      // 1. Health & Gate
      if (pathname === '/api/health' && method === 'GET') {
        return await HealthController.getHealth(req, res, this.pgSyncManager);
      }
      if (pathname === '/api/auth/gate' && method === 'POST') {
        return await HealthController.postGate(req, res);
      }

      // 2. Settings & Budget
      if (pathname === '/api/system/settings' && method === 'GET') {
        return SettingsController.getSettings(req, res);
      }
      if (pathname === '/api/system/settings' && method === 'POST') {
        return await SettingsController.postSettings(req, res);
      }
      if (pathname === '/api/budget/settings' && method === 'GET') {
        return await SettingsController.getBudgetSettings(req, res);
      }
      if (pathname === '/api/budget/settings' && method === 'POST') {
        return await SettingsController.postBudgetSettings(req, res);
      }
      if (pathname === '/api/backup/export' && method === 'GET') {
        return SettingsController.exportBackup(req, res);
      }
      if (pathname === '/api/backup/import' && method === 'POST') {
        return await SettingsController.importBackup(req, res);
      }

      // 3. Bots
      if (pathname === '/api/bots' && method === 'GET') {
        return BotController.getBots(req, res);
      }
      if (pathname.match(/^\/api\/bots\/([^/]+)\/action$/) && method === 'POST') {
        const botId = pathname.split('/')[3];
        return await BotController.postAction(req, res, botId);
      }
      if (pathname === '/api/bots/reset-virtual-all' && method === 'POST') {
        return await BotController.postAction(req, res, 'all');
      }
      if (pathname.match(/^\/api\/bots\/([^/]+)\/virtual-trade$/) && method === 'POST') {
        const botId = pathname.split('/')[3];
        return await BotController.postTrade(req, res, botId);
      }
      if (pathname.match(/^\/api\/bots\/([^/]+)\/update$/) && method === 'POST') {
        const botId = pathname.split('/')[3];
        return await BotController.postUpdate(req, res, botId);
      }
      if (pathname.match(/^\/api\/bots\/([^/]+)\/promote$/) && method === 'POST') {
        const botId = pathname.split('/')[3];
        return BotController.postPromote(req, res, botId);
      }

      // 4. Trades & Positions & Performance
      if (pathname === '/api/trades' && method === 'GET') {
        return TradeController.getTrades(req, res, urlObj);
      }
      if (pathname === '/api/positions' && method === 'GET') {
        return await TradeController.getPositions(req, res, urlObj);
      }
      if (pathname === '/api/stats' && method === 'GET') {
        return TradeController.getStats(req, res, urlObj);
      }
      if (pathname === '/api/performance/leaderboard' && method === 'GET') {
        return TradeController.getLeaderboard(req, res);
      }
      if (pathname === '/api/performance/fast-replay' && method === 'POST') {
        return await TradeController.postFastReplay(req, res);
      }

      // 5. Market & Balance
      if (pathname === '/api/stocks/candidates' && method === 'GET') {
        return MarketController.getCandidates(req, res);
      }
      if (pathname === '/api/account/balance' && method === 'GET') {
        return await MarketController.getAccountBalance(req, res);
      }

      // 6. AI LLM Decisions & Streams
      if (pathname === '/api/ai/decisions' && method === 'GET') {
        return AiController.getDecisions(req, res, urlObj);
      }
      if (pathname === '/api/ai/evaluate-and-trade' && method === 'POST') {
        return await AiController.postEvaluateAndTrade(req, res);
      }
      if (pathname === '/api/ai/stream-briefing' && method === 'GET') {
        return await AiController.streamBriefing(req, res);
      }
      if (pathname === '/api/ai/stream-news-analyze' && method === 'GET') {
        return await AiController.streamNewsAnalyze(req, res);
      }

      // 7. News
      if (pathname === '/api/news' && method === 'GET') {
        return NewsController.getNews(req, res, urlObj);
      }
      if (pathname === '/api/news/refresh' && method === 'POST') {
        return await NewsController.postRefresh(req, res, this.newsService);
      }

      // 404
      return sendError(res, 404, `Endpoint ${method} ${pathname} not found`);
    } catch (err) {
      console.error(`[Router Error] ${method} ${pathname}:`, err);
      return sendError(res, 500, err.message || '서버 내부 오류가 발생했습니다.');
    }
  }
}

