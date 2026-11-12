import { MarketService, tossClient } from '../services/market_service.mjs';
import { BotService, virtualEngine } from '../services/bot_service.mjs';
import { getDb } from '../db/index.mjs';
import { sendJson } from '../routes/router_helpers.mjs';

export class MarketController {
  static getCandidates(req, res) {
    const candidates = MarketService.getCandidates();
    return sendJson(res, 200, { candidates });
  }

  static async getAccountBalance(req, res) {
    const tossBalance = await tossClient.getAccountBalance();
    const virtualSummary = await virtualEngine.getVirtualAccountSummary();

    // 토스 실시간 주문가능 예수금의 90%를 총 실전 운영원금으로 동적 산출 및 봇 배분 실시간 동기화
    const db = getDb();
    const operatingBudget = BotService.syncDynamicRealBudget(db, tossBalance);

    return sendJson(res, 200, {
      real: {
        ...tossBalance,
        operatingBudget,
      },
      virtual: virtualSummary,
      availableCash: tossBalance.availableCash,
      availableUsd: tossBalance.availableUsd,
      totalCashKrw: tossBalance.totalCashKrw,
      operatingBudget,
      stockEvalAmount: tossBalance.stockEvalAmount,
      totalAssetAmount: tossBalance.totalAssetAmount,
      totalProfitKrw: tossBalance.totalProfitKrw,
      profitRate: tossBalance.profitRate,
      daytimeExchange: tossBalance.daytimeExchange,
    });
  }
}

