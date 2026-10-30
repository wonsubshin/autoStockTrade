import fs from 'fs';
import path from 'path';

/**
 * 토스증권 Open API (v1.2.28) 정식 클라이언트
 * - 공식 엔드포인트: https://openapi.tossinvest.com
 * - OAuth 2.0 Client Credentials 인증 (client_id, client_secret)
 * - 토큰 자동 갱신 및 401(token-revoked) 자동 복구 지원
 * - 계좌 식별자 (accountSeq) 기반 주문 및 자산/예수금 조회
 * - 매수 가능 금액 (buying-power: KRW 예수금) 실시간 조회
 * - 보유 주식 및 평가금액 (holdings: 국내/해외 통합 자산 및 실시간 환율 환산)
 * - 실전 국내주식 주문 발송 (orders: LIMIT 지정가 / MARKET 시장가)
 * - 실전 모드 시 절대 가상 목(Mock) 주문 fallback을 하지 않음 (엄격한 실전 데이터 보장)
 */
export class TossClient {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.cachedAccountSeq = null;
    this.cachedAccountNo = null;
    this.cachedExchangeRate = 1340;
    this.lastExchangeRateTime = 0;
    this.lastRequestTime = 0;
    this.minIntervalMs = 150; // 초당 최대 6~7건 레이트 리밋 보호
  }

  loadConfig() {
    const configPath = path.join(this.projectRoot, 'config', 'broker_config.json');
    const legacyConfigPath = path.join(this.projectRoot, 'config', 'kis_config.json');

    if (fs.existsSync(configPath)) {
      try {
        const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const toss = conf.toss || {};
        return {
          api_key: toss.api_key || '',
          api_secret: toss.api_secret || '',
          account_no: toss.account_no || '',
          base_url: toss.base_url || 'https://openapi.tossinvest.com',
        };
      } catch (e) {
        console.error('[Toss] broker_config.json 파싱 오류:', e.message);
      }
    } else if (fs.existsSync(legacyConfigPath)) {
      try {
        const conf = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8'));
        return {
          api_key: conf.real?.app_key || '',
          api_secret: conf.real?.app_secret || '',
          account_no: conf.real?.account_no || '',
          base_url: 'https://openapi.tossinvest.com',
        };
      } catch (e) {}
    }

    return {
      api_key: '',
      api_secret: '',
      account_no: '',
      base_url: 'https://openapi.tossinvest.com',
    };
  }

  async rateLimitWait() {
    const now = Date.now();
    const wait = Math.max(0, this.lastRequestTime + this.minIntervalMs - now);
    this.lastRequestTime = now + wait;
    if (wait > 0) {
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  // 1. 토스증권 OAuth 2.0 인증 토큰 발급 (POST /oauth2/token)
  async getAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.token && this.tokenExpiresAt > now + 60000) {
      return this.token;
    }

    const config = this.loadConfig();
    if (!config.api_key || !config.api_secret) {
      return null;
    }

    await this.rateLimitWait();

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', config.api_key);
      params.append('client_secret', config.api_secret);

      const resp = await fetch(`${config.base_url}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.access_token) {
          this.token = data.access_token;
          const expiresInSec = data.expires_in ? parseInt(data.expires_in, 10) : 86400;
          this.tokenExpiresAt = now + (expiresInSec * 1000);
          return this.token;
        }
      } else {
        const errText = await resp.text();
        console.warn(`[Toss] 인증 토큰 발급 실패 (${resp.status}):`, errText);
      }
    } catch (e) {
      console.warn(`[Toss] 인증 토큰 발급 네트워크 오류: ${e.message}`);
    }
    return null;
  }

  // 공통 인증 요청 래퍼 (401 / token-revoked 자동 갱신 및 재시도 지원)
  async fetchWithAuth(urlPath, options = {}, needAccountSeq = true, retryCount = 1) {
    const config = this.loadConfig();
    let token = await this.getAuthToken();
    if (!token) {
      throw new Error('토스증권 API 인증 토큰을 발급받을 수 없습니다. API 키/시크릿 설정을 확인해주세요.');
    }

    let accountSeq = null;
    if (needAccountSeq) {
      const accInfo = await this.getAccountSeq();
      accountSeq = accInfo ? accInfo.accountSeq : 1;
    }

    await this.rateLimitWait();

    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    if (needAccountSeq && accountSeq) {
      headers['X-Tossinvest-Account'] = String(accountSeq);
    }

    const fullUrl = urlPath.startsWith('http') ? urlPath : `${config.base_url}${urlPath}`;
    const resp = await fetch(fullUrl, {
      ...options,
      headers,
    });

    if (resp.status === 401 && retryCount > 0) {
      console.warn('[Toss] 토큰 만료 또는 취소 감지(401). 최신 토큰으로 재발급 후 재시도합니다.');
      this.token = null;
      this.tokenExpiresAt = 0;
      await this.getAuthToken(true);
      return this.fetchWithAuth(urlPath, options, needAccountSeq, retryCount - 1);
    }

    return resp;
  }

  // 2. 토스증권 계좌 식별자 (accountSeq) 조회 (GET /api/v1/accounts)
  async getAccountSeq() {
    if (this.cachedAccountSeq) {
      return { accountSeq: this.cachedAccountSeq, accountNo: this.cachedAccountNo };
    }

    const config = this.loadConfig();
    try {
      const resp = await this.fetchWithAuth('/api/v1/accounts', { method: 'GET' }, false);
      if (resp.ok) {
        const data = await resp.json();
        const accounts = data.result || [];
        const matched = accounts.find((a) => String(a.accountNo) === String(config.account_no)) || accounts[0];

        if (matched) {
          this.cachedAccountSeq = matched.accountSeq;
          this.cachedAccountNo = matched.accountNo;
          return { accountSeq: matched.accountSeq, accountNo: matched.accountNo };
        }
      } else {
        console.warn('[Toss] 계좌 목록 응답 오류:', resp.status, await resp.text());
      }
    } catch (e) {
      console.warn('[Toss] 계좌 목록 조회 실패:', e.message);
    }
    return null;
  }

  // 3. USD/KRW 실시간 환율 조회 (GET /api/v1/exchange-rate)
  async getExchangeRate() {
    const now = Date.now();
    if (now - this.lastExchangeRateTime < 300000 && this.cachedExchangeRate > 0) {
      return this.cachedExchangeRate;
    }

    try {
      const resp = await this.fetchWithAuth('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW', { method: 'GET' }, false);
      if (resp.ok) {
        const data = await resp.json();
        const rate = parseFloat(data.result?.rate || '1340');
        if (rate > 0) {
          this.cachedExchangeRate = rate;
          this.lastExchangeRateTime = now;
          return rate;
        }
      }
    } catch (e) {
      console.warn('[Toss] 환율 조회 실패:', e.message);
    }

    return this.cachedExchangeRate || 1340;
  }

  // 4. 토스증권 API 통신 및 인증 상태 확인
  async getApiHealth() {
    const config = this.loadConfig();
    if (!config.api_key || !config.account_no) {
      return {
        status: 'yellow',
        label: '토스증권 API 미설정 (가상 매매 체결 엔진 가동)',
        hasKeys: false,
      };
    }

    const token = await this.getAuthToken();
    if (token) {
      return { status: 'green', label: '토스증권 Open API 정상 연동 완료', hasKeys: true };
    }
    return { status: 'yellow', label: '토스증권 통신 대기 중', hasKeys: true };
  }

  // 5. 토스증권 계좌 실제 예수금, 보유주식 평가액, 총 자산 조회
  async getAccountBalance() {
    const config = this.loadConfig();
    const token = await this.getAuthToken();

    if (token) {
      try {
        const accInfo = await this.getAccountSeq();
        const accountSeq = accInfo ? accInfo.accountSeq : 1;
        const accountNo = accInfo ? accInfo.accountNo : config.account_no;
        const usdRate = await this.getExchangeRate();

        // 1) KRW 주문 가능 예수금 (GET /api/v1/buying-power?currency=KRW)
        let availableCash = 0;
        try {
          const bpResp = await this.fetchWithAuth('/api/v1/buying-power?currency=KRW', { method: 'GET' }, true);
          if (bpResp.ok) {
            const bpData = await bpResp.json();
            availableCash = parseInt(bpData.result?.cashBuyingPower || '0', 10);
          } else {
            console.warn('[Toss] buying-power 조회 실패:', bpResp.status, await bpResp.text());
          }
        } catch (e) {
          console.warn('[Toss] buying-power 호출 오류:', e.message);
        }

        // 2) 보유 주식 현황 및 평가 금액 (GET /api/v1/holdings)
        let stockEvalAmount = 0;
        let totalPurchaseAmount = 0;
        let holdings = [];
        let profitRate = 0.0;

        try {
          const holdResp = await this.fetchWithAuth('/api/v1/holdings', { method: 'GET' }, true);
          if (holdResp.ok) {
            const holdData = await holdResp.json();
            const res = holdData.result || {};

            const krwMarket = parseFloat(res.marketValue?.amount?.krw || '0');
            const usdMarket = parseFloat(res.marketValue?.amount?.usd || '0');
            stockEvalAmount = Math.round(krwMarket + (usdMarket * usdRate));

            const krwPurchase = parseFloat(res.totalPurchaseAmount?.krw || '0');
            const usdPurchase = parseFloat(res.totalPurchaseAmount?.usd || '0');
            totalPurchaseAmount = Math.round(krwPurchase + (usdPurchase * usdRate));

            const totalProfit = stockEvalAmount - totalPurchaseAmount;
            if (totalPurchaseAmount > 0) {
              profitRate = parseFloat(((totalProfit / totalPurchaseAmount) * 100).toFixed(2));
            }

            holdings = (res.items || []).map((it) => {
              const isUsd = it.currency === 'USD';
              const rate = isUsd ? usdRate : 1;
              const lastPrice = parseFloat(it.lastPrice || '0');
              const avgPrice = parseFloat(it.averagePurchasePrice || '0');
              const qty = parseFloat(it.quantity || '0');
              const evalKrw = Math.round(parseFloat(it.marketValue?.amount || '0') * rate);
              const profitKrw = Math.round(parseFloat(it.profitLoss?.amount || '0') * rate);
              const profitPct = parseFloat((parseFloat(it.profitLoss?.rate || '0') * 100).toFixed(2));

              return {
                stockCode: it.symbol,
                stockName: it.name,
                currency: it.currency || 'KRW',
                qty,
                avgBuyPrice: Math.round(avgPrice * rate),
                currentPrice: Math.round(lastPrice * rate),
                evalAmount: evalKrw,
                unrealizedProfitKrw: profitKrw,
                unrealizedProfitPct: profitPct,
              };
            });
          } else {
            console.warn('[Toss] holdings 조회 실패:', holdResp.status, await holdResp.text());
          }
        } catch (e) {
          console.warn('[Toss] holdings 호출 오류:', e.message);
        }

        const totalAssetAmount = availableCash + stockEvalAmount;
        const totalProfitKrw = stockEvalAmount - totalPurchaseAmount;

        return {
          availableCash,
          stockEvalAmount,
          totalAssetAmount,
          totalProfitKrw,
          profitRate,
          holdings,
          accountNo,
          accountSeq,
          provider: '토스증권(실전)',
          isMock: false,
        };
      } catch (e) {
        console.warn('[Toss] 실시간 계좌 잔고 파싱 오류:', e.message);
      }
    }

    // API 키 미설정 시의 기본 반환
    return {
      availableCash: 0,
      stockEvalAmount: 0,
      totalAssetAmount: 0,
      totalProfitKrw: 0,
      profitRate: 0.0,
      holdings: [],
      provider: '토스증권(미연결)',
      isMock: true,
    };
  }

  // 6. 토스증권 국내주식 실전 주문 발송 (POST /api/v1/orders)
  // 실전 주문은 엄격하게 토스증권 실제 API로만 전송되며, 실패 시 어떠한 가상 더미 주문도 생성하지 않습니다.
  async sendOrder({ orderType, stockCode, qty, price }) {
    const config = this.loadConfig();

    if (!config.api_key || !config.account_no) {
      throw new Error('토스증권 API Key 또는 계좌번호가 등록되지 않았습니다. [설정] 메뉴에서 먼저 등록해주세요.');
    }

    const isBuy = orderType === 'BUY';
    const orderPrice = price ? adjustKRXTickSize(price) : 0;
    const clientOrderId = `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payload = {
      clientOrderId,
      symbol: stockCode,
      side: isBuy ? 'BUY' : 'SELL',
      orderType: orderPrice > 0 ? 'LIMIT' : 'MARKET',
      quantity: String(qty),
      ...(orderPrice > 0 ? { price: String(orderPrice) } : {}),
    };

    const resp = await this.fetchWithAuth('/api/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, true);

    const data = await resp.json();
    if (resp.ok) {
      return {
        orderNo: data.result?.orderId || clientOrderId,
        stockCode,
        qty,
        price: orderPrice,
        status: 'SUBMITTED',
        raw: data,
      };
    } else {
      const errorMsg = data.error?.message || JSON.stringify(data);
      console.warn(`[Toss] 실전 주문 응답 거부: ${errorMsg}`);
      throw new Error(`토스증권 주문 실패: ${errorMsg}`);
    }
  }
}

// KRX 한국거래소 호가단위 (Tick Size) 보정 유틸리티
function adjustKRXTickSize(price) {
  if (price < 2000) return price;
  if (price < 5000) return Math.floor(price / 5) * 5;
  if (price < 20000) return Math.floor(price / 10) * 10;
  if (price < 50000) return Math.floor(price / 50) * 50;
  if (price < 200000) return Math.floor(price / 100) * 100;
  if (price < 500000) return Math.floor(price / 500) * 500;
  return Math.floor(price / 1000) * 1000;
}
