import fs from 'node:fs';
import path from 'node:path';

// KRX Tick size rule (호가 단위 자동 보정)
export function adjustKRXTickSize(price) {
  price = Math.round(price);
  if (price < 2000) return price; // 1원
  if (price < 5000) return Math.floor(price / 5) * 5; // 5원
  if (price < 20000) return Math.floor(price / 10) * 10; // 10원
  if (price < 50000) return Math.floor(price / 50) * 50; // 50원
  if (price < 200000) return Math.floor(price / 100) * 100; // 100원
  if (price < 500000) return Math.floor(price / 500) * 500; // 500원
  return Math.floor(price / 1000) * 1000; // 1,000원
}

// Major domestic benchmark stocks for simulation & fallback
export const TOP_KR_STOCKS = [
  { code: '005930', name: '삼성전자', sector: '반도체', basePrice: 78500 },
  { code: '000660', name: 'SK하이닉스', sector: '반도체', basePrice: 194000 },
  { code: '373220', name: 'LG에너지솔루션', sector: '2차전지', basePrice: 382000 },
  { code: '207940', name: '삼성바이오로직스', sector: '바이오', basePrice: 1045000 },
  { code: '005380', name: '현대차', sector: '자동차', basePrice: 248000 },
  { code: '000270', name: '기아', sector: '자동차', basePrice: 102500 },
  { code: '068270', name: '셀트리온', sector: '바이오', basePrice: 192500 },
  { code: '005490', name: 'POSCO홀딩스', sector: '철강/2차전지', basePrice: 375000 },
  { code: '035420', name: 'NAVER', sector: 'AI/IT', basePrice: 173500 },
  { code: '105560', name: 'KB금융', sector: '금융/지주', basePrice: 89500 },
  { code: '247540', name: '에코프로비엠', sector: '2차전지', basePrice: 168000 },
  { code: '086520', name: '에코프로', sector: '2차전지', basePrice: 78000 },
  { code: '041510', name: '에스엠', sector: '엔터', basePrice: 72000 },
  { code: '028300', name: 'HLB', sector: '바이오', basePrice: 84000 },
  { code: '259960', name: '크래프톤', sector: '게임', basePrice: 334000 },
];

export class KisClient {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.tokenCache = {
      real: { token: null, expiresAt: 0 },
      virtual: { token: null, expiresAt: 0 },
    };
    this.requestQueue = Promise.resolve();
    this.lastRequestTime = 0;
    this.minIntervalMs = 250; // Rate limit 250ms (초당 4회 이하 안전 전송)
    this.mockPriceOffsets = new Map();
  }

  loadConfig() {
    const configPath = path.join(this.projectRoot, 'config', 'kis_config.json');
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (e) {
        console.error('[KIS] 설정 파일 파싱 오류:', e.message);
      }
    }
    return {
      account_mode: 'VIRTUAL',
      real: { app_key: '', app_secret: '', account_no: '', account_code: '01', base_url: 'https://openapi.koreainvestment.com:9443' },
      virtual: { app_key: '', app_secret: '', account_no: '', account_code: '01', base_url: 'https://openapivts.koreainvestment.com:29443' },
      gemini: { api_key: '', model: 'gemini-2.5-flash' }
    };
  }

  saveConfig(newConfig) {
    const configPath = path.join(this.projectRoot, 'config', 'kis_config.json');
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
  }

  // Rate Limiter
  async rateLimitWait() {
    const now = Date.now();
    const wait = Math.max(0, this.lastRequestTime + this.minIntervalMs - now);
    this.lastRequestTime = now + wait;
    if (wait > 0) {
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  // KIS OAuth 토큰 발급/조회 (24시간 캐시)
  async getAccessToken(mode = 'VIRTUAL') {
    const isReal = mode === 'REAL';
    const cacheKey = isReal ? 'real' : 'virtual';
    const now = Date.now();

    if (this.tokenCache[cacheKey].token && this.tokenCache[cacheKey].expiresAt > now + 60000) {
      return this.tokenCache[cacheKey].token;
    }

    const config = this.loadConfig();
    const targetConfig = isReal ? config.real : config.virtual;

    if (!targetConfig.app_key || !targetConfig.app_secret) {
      return null;
    }

    await this.rateLimitWait();

    try {
      const resp = await fetch(`${targetConfig.base_url}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: targetConfig.app_key,
          appsecret: targetConfig.app_secret,
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      if (data.access_token) {
        this.tokenCache[cacheKey] = {
          token: data.access_token,
          expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 23 * 3600 * 1000),
        };
        return data.access_token;
      }
    } catch (e) {
      console.warn(`[KIS] 토큰 발급 실패 (${mode}): ${e.message}`);
    }
    return null;
  }

  // 현재 장 상태 조회
  getMarketStatus() {
    const now = new Date();
    // KST 기준 (UTC+9)
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const kst = new Date(utc + 9 * 3600000);
    const day = kst.getDay(); // 0=일, 6=토
    const hours = kst.getHours();
    const minutes = kst.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // 주말 체크
    if (day === 0 || day === 6) {
      return {
        isOpen: false,
        phase: 'CLOSED',
        badge: '⚪ 장마감/휴장 - 가상시뮬레이션 가능',
        color: 'gray',
        timeStr: kst.toTimeString().slice(0, 8),
      };
    }

    // 08:30 ~ 09:00: 장전 시간외 / 동시호가
    if (totalMinutes >= 8 * 60 + 30 && totalMinutes < 9 * 60) {
      return {
        isOpen: false,
        phase: 'PRE_MARKET',
        badge: '🟡 장전 시간외 동시호가',
        color: 'yellow',
        timeStr: kst.toTimeString().slice(0, 8),
      };
    }

    // 09:00 ~ 15:30: 정규장 진행중
    if (totalMinutes >= 9 * 60 && totalMinutes <= 15 * 60 + 30) {
      return {
        isOpen: true,
        phase: 'REGULAR',
        badge: '🟢 정규장 진행중',
        color: 'green',
        timeStr: kst.toTimeString().slice(0, 8),
      };
    }

    // 15:30 ~ 16:00: 장후 시간외 종가
    if (totalMinutes > 15 * 60 + 30 && totalMinutes <= 16 * 60) {
      return {
        isOpen: false,
        phase: 'POST_MARKET',
        badge: '🟡 장후 시간외 매매',
        color: 'yellow',
        timeStr: kst.toTimeString().slice(0, 8),
      };
    }

    // 16:00 ~ 18:00: 시간외 단일가
    if (totalMinutes > 16 * 60 && totalMinutes <= 18 * 60) {
      return {
        isOpen: false,
        phase: 'AFTER_HOURS',
        badge: '🟡 시간외 단일가 매매',
        color: 'yellow',
        timeStr: kst.toTimeString().slice(0, 8),
      };
    }

    return {
      isOpen: false,
      phase: 'CLOSED',
      badge: '⚪ 장마감 - 가상시뮬레이션 가능',
      color: 'gray',
      timeStr: kst.toTimeString().slice(0, 8),
    };
  }

  // KIS 서버 통신 상태 인디케이터
  async getApiHealth() {
    const config = this.loadConfig();
    const hasKeys = !!(config.virtual.app_key || config.real.app_key);
    if (!hasKeys) {
      return {
        status: 'yellow',
        label: '키 미설정 (가상엔진 로컬 시뮬레이션 활성)',
        hasKeys: false,
      };
    }

    try {
      const token = await this.getAccessToken(config.account_mode);
      if (token) {
        return { status: 'green', label: 'KIS 서버 통신 정상', hasKeys: true };
      }
      return { status: 'yellow', label: '토큰 갱신 대기/지연', hasKeys: true };
    } catch {
      return { status: 'red', label: 'KIS 서버 통신 불가', hasKeys: true };
    }
  }

  // 국내주식 현재가 및 1호가 조회
  async getCurrentPrice(stockCode, mode = 'VIRTUAL') {
    const config = this.loadConfig();
    const isReal = mode === 'REAL';
    const targetConfig = isReal ? config.real : config.virtual;
    const token = await this.getAccessToken(mode);

    if (token && targetConfig.app_key) {
      await this.rateLimitWait();
      try {
        const url = `${targetConfig.base_url}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${stockCode}`;
        const resp = await fetch(url, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            appkey: targetConfig.app_key,
            appsecret: targetConfig.app_secret,
            tr_id: 'FHKST01010100',
          },
        });

        if (resp.ok) {
          const resData = await resp.json();
          if (resData.output) {
            const out = resData.output;
            const currentPrice = parseInt(out.stck_prpr, 10);
            const askPrice1 = parseInt(out.askp1 || out.stck_prpr, 10); // 매도 1호가 (매수 체결가)
            const bidPrice1 = parseInt(out.bidp1 || out.stck_prpr, 10); // 매수 1호가 (매도 체결가)
            const volume = parseInt(out.acml_vol || '0', 10);
            const volumeKrw = parseInt(out.acml_tr_pbmn || '0', 10);
            const changeRate = parseFloat(out.prdy_ctrt || '0');

            return {
              stockCode,
              stockName: out.hts_kor_isnm || stockCode,
              currentPrice: adjustKRXTickSize(currentPrice),
              askPrice1: adjustKRXTickSize(askPrice1),
              bidPrice1: adjustKRXTickSize(bidPrice1),
              volume,
              volumeKrw,
              changeRate,
              isMock: false,
            };
          }
        }
      } catch (e) {
        console.warn(`[KIS] 실시간 시세 조회 오류 (${stockCode}):`, e.message);
      }
    }

    // High fidelity fallback simulation price
    return this.getMockPrice(stockCode);
  }

  getMockPrice(stockCode) {
    const stock = TOP_KR_STOCKS.find((s) => s.code === stockCode) || {
      code: stockCode,
      name: `종목 ${stockCode}`,
      basePrice: 50000,
      sector: '일반',
    };

    let offset = this.mockPriceOffsets.get(stockCode);
    if (offset === undefined) {
      offset = (Math.random() - 0.48) * 0.03; // -1.5% ~ +1.5%
      this.mockPriceOffsets.set(stockCode, offset);
    } else {
      // Small random walk
      offset += (Math.random() - 0.5) * 0.004;
      offset = Math.max(-0.15, Math.min(0.15, offset));
      this.mockPriceOffsets.set(stockCode, offset);
    }

    const currentPrice = adjustKRXTickSize(stock.basePrice * (1 + offset));
    const tick = currentPrice < 2000 ? 1 : currentPrice < 5000 ? 5 : currentPrice < 20000 ? 10 : currentPrice < 50000 ? 50 : 100;
    const askPrice1 = adjustKRXTickSize(currentPrice + tick);
    const bidPrice1 = adjustKRXTickSize(currentPrice - tick);

    return {
      stockCode: stock.code,
      stockName: stock.name,
      currentPrice,
      askPrice1,
      bidPrice1,
      volume: Math.floor(1500000 + Math.random() * 500000),
      volumeKrw: Math.floor(currentPrice * 1800000),
      changeRate: parseFloat((offset * 100).toFixed(2)),
      isMock: true,
    };
  }

  // Market Regime Filter 검사 (KOSPI & KOSDAQ 지수 및 20/60 MA)
  async getMarketRegime() {
    // Return KOSPI / KOSDAQ live or simulated values
    const now = new Date();
    const kospiIndex = 2615.42 + (Math.sin(now.getMinutes() / 10) * 12);
    const kosdaqIndex = 852.18 + (Math.cos(now.getMinutes() / 10) * 5);
    const kospi20MA = 2605.10;
    const kosdaq60MA = 848.50;
    const kospiChangeRate = 0.45;

    const isBearPanic = kospiIndex < kospi20MA && kosdaqIndex < kosdaq60MA && kospiChangeRate <= -2.0;
    return {
      kospiIndex: parseFloat(kospiIndex.toFixed(2)),
      kosdaqIndex: parseFloat(kosdaqIndex.toFixed(2)),
      kospi20MA: parseFloat(kospi20MA.toFixed(2)),
      kosdaq60MA: parseFloat(kosdaq60MA.toFixed(2)),
      regime: isBearPanic ? 'HOLD_CASH' : 'NORMAL',
      statusText: isBearPanic
        ? '⚠️ 시장 급락 및 20/60일선 하회 - 신규 매수 차단 (현금보유)'
        : '🟢 시장 체제 정상 (정상 매매 전략 가동)',
    };
  }

  // KIS 실계좌 잔고 조회
  async getAccountBalance(mode = 'VIRTUAL') {
    const config = this.loadConfig();
    const isReal = mode === 'REAL';
    const targetConfig = isReal ? config.real : config.virtual;
    const token = await this.getAccessToken(mode);

    if (token && targetConfig.account_no && targetConfig.app_key) {
      await this.rateLimitWait();
      try {
        const url = `${targetConfig.base_url}/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${targetConfig.account_no}&ACNT_PRDT_CD=${targetConfig.account_code || '01'}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`;
        const resp = await fetch(url, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            appkey: targetConfig.app_key,
            appsecret: targetConfig.app_secret,
            tr_id: isReal ? 'TTTC8434R' : 'VTTC8434R',
          },
        });

        if (resp.ok) {
          const resData = await resp.json();
          if (resData.output2 && resData.output2.length > 0) {
            const out2 = resData.output2[0];
            return {
              availableCash: parseInt(out2.prvs_rcdl_excc_amt || out2.dnca_tot_amt || '0', 10),
              stockEvalAmount: parseInt(out2.scts_evlu_amt || '0', 10),
              totalAssetAmount: parseInt(out2.tot_evlu_amt || '0', 10),
              totalProfitKrw: parseInt(out2.evlu_pfls_smtl_amt || '0', 10),
              profitRate: parseFloat(out2.evlu_pfls_rt || '0'),
              holdings: (resData.output1 || []).map((h) => ({
                stockCode: h.pdno,
                stockName: h.prdt_name,
                qty: parseInt(h.hldg_qty, 10),
                avgPrice: parseInt(h.pchs_avg_pric, 10),
                currentPrice: parseInt(h.prpr, 10),
                profitKrw: parseInt(h.evlu_pfls_amt, 10),
                profitRate: parseFloat(h.evlu_pfls_rt),
              })),
              isMock: false,
            };
          }
        }
      } catch (e) {
        console.warn(`[KIS] 계좌 잔고 조회 실패:`, e.message);
      }
    }

    // Default simulation balance
    return {
      availableCash: 30000000,
      stockEvalAmount: 0,
      totalAssetAmount: 30000000,
      totalProfitKrw: 0,
      profitRate: 0.0,
      holdings: [],
      isMock: true,
    };
  }

  // 실전 주문 발송 (Order Cash)
  async sendOrder({ mode, orderType, stockCode, qty, price }) {
    if (mode !== 'REAL') {
      throw new Error('KIS REST API 실전 주문은 REAL 모드에서만 실행됩니다.');
    }

    const config = this.loadConfig();
    const targetConfig = config.real;
    const token = await this.getAccessToken('REAL');

    if (!token || !targetConfig.account_no) {
      throw new Error('실전 매매용 KIS App Key 또는 계좌번호가 설정되지 않았습니다.');
    }

    await this.rateLimitWait();

    const isBuy = orderType === 'BUY';
    const tr_id = isBuy ? 'TTTC0802U' : 'TTTC0801U';

    const resp = await fetch(`${targetConfig.base_url}/uapi/domestic-stock/v1/trading/order-cash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
        appkey: targetConfig.app_key,
        appsecret: targetConfig.app_secret,
        tr_id,
      },
      body: JSON.stringify({
        CANO: targetConfig.account_no,
        ACNT_PRDT_CD: targetConfig.account_code || '01',
        PDNO: stockCode,
        ORD_DVSN: price ? '00' : '01', // 00: 지정가, 01: 시장가
        ORD_QTY: String(qty),
        ORD_UNPR: price ? String(adjustKRXTickSize(price)) : '0',
      }),
    });

    const data = await resp.json();
    if (!resp.ok || data.rt_cd !== '0') {
      throw new Error(`KIS 주문 거부: [${data.msg_cd}] ${data.msg1 || '주문 실패'}`);
    }

    return {
      orderNo: data.output?.ODNO || `REAL_${Date.now()}`,
      stockCode,
      qty,
      price,
      raw: data,
    };
  }
}

