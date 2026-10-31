import { PROJECT_ROOT } from '../config/env.mjs';
import { KiwoomClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from '../common/kiwoom_client.mjs';
import { TossClient } from '../common/toss_client.mjs';

export const kiwoomClient = new KiwoomClient(PROJECT_ROOT);
export const tossClient = new TossClient(PROJECT_ROOT);

export { TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS };

export class MarketService {
  static getMarketStatus() {
    return kiwoomClient.getMarketStatus();
  }

  static async getMarketRegime() {
    return await kiwoomClient.getMarketRegime();
  }

  static async getHealth() {
    const kiwoomHealth = await kiwoomClient.getApiHealth();
    const tossHealth = await tossClient.getApiHealth();
    const marketStatus = kiwoomClient.getMarketStatus();
    const regimeInfo = await kiwoomClient.getMarketRegime();

    return {
      kiwoomHealth,
      tossHealth,
      marketStatus,
      regimeInfo,
    };
  }

  static getCandidates() {
    return ALL_CANDIDATE_STOCKS;
  }

  static async getCurrentPrice(code) {
    return await kiwoomClient.getCurrentPrice(code);
  }

  static async getAccountBalance() {
    return await tossClient.getAccountBalance();
  }
}
