import { MarketService, tossClient } from '../services/market_service.mjs';
import { virtualEngine } from '../services/bot_service.mjs';
import { sendJson } from '../routes/router_helpers.mjs';

export class MarketController {
  static getCandidates(req, res) {
    const candidates = MarketService.getCandidates();
    return sendJson(res, 200, { candidates });
  }

  static async getAccountBalance(req, res) {
    const tossBalance = await tossClient.getAccountBalance();
    const virtualSummary = await virtualEngine.getVirtualAccountSummary();

    return sendJson(res, 200, {
      real: tossBalance,
      virtual: virtualSummary,
      availableCash: tossBalance.availableCash,
      stockEvalAmount: tossBalance.stockEvalAmount,
      totalAssetAmount: tossBalance.totalAssetAmount,
      totalProfitKrw: tossBalance.totalProfitKrw,
      profitRate: tossBalance.profitRate,
    });
  }
}
