import { PROJECT_ROOT } from '../config/env.mjs';
import { KiwoomClient, TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS } from '../common/kiwoom_client.mjs';
import { TossClient } from '../common/toss_client.mjs';

export const kiwoomClient = new KiwoomClient(PROJECT_ROOT);
export const tossClient = new TossClient(PROJECT_ROOT);

// 1안 채택: 미국주식 실시간 시세 조회를 위해 키움 클라이언트에 토스 클라이언트 연결
kiwoomClient.setTossClient(tossClient);

export { TOP_KR_STOCKS, TOP_US_STOCKS, ALL_CANDIDATE_STOCKS };

export class MarketService {
  static async getMarketStatus() {
    const krStatus = kiwoomClient.getMarketStatus();
    const usStatus = await tossClient.getUsMarketStatus();
    return {
      ...krStatus,
      kr: krStatus,
      us: usStatus,
    };
  }

  static async getMarketRegime() {
    return await kiwoomClient.getMarketRegime();
  }

  static async getHealth() {
    const kiwoomHealth = await kiwoomClient.getApiHealth();
    const tossHealth = await tossClient.getApiHealth();
    const marketStatus = await MarketService.getMarketStatus();
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
    const isUsStock = /^[A-Za-z.]+$/.test(code);
    if (isUsStock) {
      return await tossClient.getCurrentPrice(code);
    }
    return await kiwoomClient.getCurrentPrice(code);
  }

  static async getAccountBalance() {
    return await tossClient.getAccountBalance();
  }
}
