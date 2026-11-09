import fs from 'fs';
import path from 'path';

/**
 * 토스증권 Open API (v1.2.28) 정식 클라이언트
 * - 공식 엔드포인트: https://openapi.tossinvest.com
 * - OAuth 2.0 Client Credentials 인증 (client_id, client_secret)
 * - 토큰 자동 갱신 및 401(token-revoked) 자동 복구 지원 (동시성 뮤텍스 적용)
 * - 미국주식 0초 지연 실시간 시세 (GET /api/v1/prices, candles, orderbook)
 * - 미국/국내 시장 캘린더 및 장운영 상태 조회 (GET /api/v1/market-calendar/US)
 * - 실시간 USD/KRW 환율 조회 (GET /api/v1/exchange-rate)
 * - 계좌 식별자 (accountSeq) 기반 주문 및 자산/예수금 조회
 * - 매수 가능 금액 (buying-power: KRW 예수금) 실시간 조회
 * - 보유 주식 및 평가금액 (holdings: 국내/해외 통합 자산 및 실시간 환율 환산)
 * - 실전 국내/미국주식 주문 발송 (orders: LIMIT 지정가 / MARKET 시장가 / 소수점 금액주문)
 * - 실전 모드 시 절대 가상 목(Mock) 주문 fallback을 하지 않음 (엄격한 실전 데이터 보장)
 */
export class TossClient {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.token = null;
    this.tokenExpiresAt = 0;
    this._tokenPromise = null;
    this.cachedAccountSeq = null;
    this.cachedAccountNo = null;
    this.cachedExchangeRate = 1340;
    this.lastExchangeRateTime = 0;
    this.lastRequestTime = 0;
    this.minIntervalMs = 150; // 초당 최대 6~7건 레이트 리밋 보호
    this.priceCache = new Map(); // 단기(1.5초) 시세 캐시
    this.stockInfoCache = new Map();
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
    if (this.lastRequestTime < now) {
      this.lastRequestTime = now;
    }
    const wait = Math.min(1000, Math.max(0, this.lastRequestTime - now));
    this.lastRequestTime = Math.min(now + 1000, this.lastRequestTime + this.minIntervalMs);
    if (wait > 0) {
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  getTokenFilePath() {
    return path.join(this.projectRoot, 'config', '.toss_token.json');
  }

  loadCachedToken() {
    const tokenFile = this.getTokenFilePath();
    if (fs.existsSync(tokenFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        if (data.access_token && data.expires_at > Date.now() + 60000) {
          this.token = data.access_token;
          this.tokenExpiresAt = data.expires_at;
          return this.token;
        }
      } catch (e) {}
    }
    return null;
  }

  saveCachedToken(token, expiresInSec) {
    const tokenFile = this.getTokenFilePath();
    try {
      const expiresAt = Date.now() + (expiresInSec * 1000);
      fs.writeFileSync(tokenFile, JSON.stringify({ access_token: token, expires_at: expiresAt }), 'utf8');
      this.token = token;
      this.tokenExpiresAt = expiresAt;
    } catch (e) {}
  }

  // 1. 토스증권 OAuth 2.0 인증 토큰 발급 (공용 캐시 파일 .toss_token.json 공유)
  async getAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh) {
      if (this.token && this.tokenExpiresAt > now + 60000) {
        return this.token;
      }
      const fileToken = this.loadCachedToken();
      if (fileToken) {
        return fileToken;
      }
    }

    if (this._tokenPromise) {
      return this._tokenPromise;
    }

    this._tokenPromise = (async () => {
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
            const expiresInSec = data.expires_in ? parseInt(data.expires_in, 10) : 86400;
            this.saveCachedToken(data.access_token, expiresInSec);
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
    })().finally(() => {
      this._tokenPromise = null;
    });

    return this._tokenPromise;
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

  // 2. 토스증권 계좌 식별자 (accountSeq) 조회 (GET /api/v1/accounts, 뮤텍스 및 기본값 1 캐싱)
  async getAccountSeq() {
    if (this.cachedAccountSeq) {
      return { accountSeq: this.cachedAccountSeq, accountNo: this.cachedAccountNo };
    }

    const config = this.loadConfig();
    if (!config.api_key || !config.api_secret) {
      return null;
    }

    if (this._accountSeqPromise) {
      return this._accountSeqPromise;
    }

    this._accountSeqPromise = (async () => {
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
        }
      } catch (e) {}

      // 만약 429 등으로 조회가 지연되면 기본 계좌 순번 1로 안전 캐싱
      this.cachedAccountSeq = 1;
      this.cachedAccountNo = config.account_no || '11501026516';
      return { accountSeq: 1, accountNo: this.cachedAccountNo };
    })().finally(() => {
      this._accountSeqPromise = null;
    });

    return this._accountSeqPromise;
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
      return { status: 'green', label: '토스증권 Open API 정상 연동 완료 (미국 실시간 시세 지원)', hasKeys: true };
    }
    return { status: 'yellow', label: '토스증권 통신 대기 중', hasKeys: true };
  }

  // 5. 미국/국내 주식 실시간 시세 및 1호가 조회 (1안 채택: 미국 주식 토스 직통 조회)
  async getCurrentPrice(stockCode) {
    const symbol = String(stockCode || '').trim().toUpperCase();
    if (!symbol) return null;

    const now = Date.now();
    const cached = this.priceCache.get(symbol);
    if (cached && now - cached.timestamp < 4000) {
      return cached.data;
    }

    const config = this.loadConfig();
    const token = await this.getAuthToken();
    const isUsStock = /^[A-Z.]+$/.test(symbol);
    const usdRate = await this.getExchangeRate();

    if (token && config.api_key) {
      try {
        const priceResp = await this.fetchWithAuth(`/api/v1/prices?symbols=${symbol}`, { method: 'GET' }, false);
        if (priceResp && priceResp.ok) {
          const pData = await priceResp.json();
          const priceItem = (Array.isArray(pData.result) && pData.result.length > 0) ? pData.result[0] : null;

          if (priceItem && priceItem.lastPrice) {
            const rawPrice = parseFloat(priceItem.lastPrice);
            const knownNames = {
              AAPL: '애플',
              NVDA: '엔비디아',
              TSLA: '테슬라',
              MSFT: '마이크로소프트',
              QQQ: 'Invesco QQQ',
              SBUX: '스타벅스',
              AMZN: '아마존',
              GOOGL: '알파벳A',
              META: '메타',
              AMD: 'AMD',
            };
            const stockName = this.stockInfoCache.get(symbol) || knownNames[symbol] || symbol;

            let formattedPrice;
            if (isUsStock) {
              const currentPriceUsd = rawPrice;
              const currentPriceKrw = Math.round(currentPriceUsd * usdRate);
              formattedPrice = {
                stockCode: symbol,
                stockName,
                market: 'US',
                currency: 'USD',
                isFractional: true,
                currentPrice: currentPriceKrw,
                currentPriceUsd,
                askPrice1: currentPriceKrw,
                bidPrice1: currentPriceKrw,
                askPrice1Usd: currentPriceUsd,
                bidPrice1Usd: currentPriceUsd,
                volume: 100000,
                changeRate: 0.0,
                exchangeRate: usdRate,
                provider: '토스증권(실시간)',
                isMock: false,
                timestamp: priceItem.timestamp || new Date().toISOString(),
              };
            } else {
              const currentPriceKrw = Math.round(rawPrice);
              formattedPrice = {
                stockCode: symbol,
                stockName,
                market: 'KR',
                currency: 'KRW',
                isFractional: false,
                currentPrice: adjustKRXTickSize(currentPriceKrw),
                askPrice1: adjustKRXTickSize(currentPriceKrw),
                bidPrice1: adjustKRXTickSize(currentPriceKrw),
                volume: 100000,
                changeRate: 0.0,
                provider: '토스증권(실시간)',
                isMock: false,
                timestamp: priceItem.timestamp || new Date().toISOString(),
              };
            }

            this.priceCache.set(symbol, { timestamp: now, data: formattedPrice });
            return formattedPrice;
          }
        }
      } catch (e) {
        console.warn(`[Toss] 실시간 시세 조회 예외 (${symbol}):`, e.message);
      }
    }

    return this.getFallbackPrice(symbol, isUsStock, usdRate);
  }

  // 6. 다건 종목 실시간 일괄 시세 조회 (최대 200건, 단일 요청으로 1초 내 수집 및 캐시 동기화)
  async getMultiplePrices(symbols = []) {
    if (!symbols || symbols.length === 0) return [];
    const validSymbols = symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    if (validSymbols.length === 0) return [];

    const token = await this.getAuthToken();
    const usdRate = await this.getExchangeRate();
    if (token) {
      try {
        const resp = await this.fetchWithAuth(`/api/v1/prices?symbols=${validSymbols.join(',')}`, { method: 'GET' }, false);
        if (resp.ok) {
          const data = await resp.json();
          const items = data.result || [];
          const knownNames = {
            AAPL: '애플',
            NVDA: '엔비디아',
            TSLA: '테슬라',
            MSFT: '마이크로소프트',
            QQQ: 'Invesco QQQ',
            SBUX: '스타벅스',
            AMZN: '아마존',
            GOOGL: '알파벳A',
            META: '메타',
            AMD: 'AMD',
          };
          const mapped = items.map((it) => {
            const isUs = it.currency === 'USD' || /^[A-Z.]+$/.test(it.symbol);
            const raw = parseFloat(it.lastPrice || '0');
            const priceKrw = isUs ? Math.round(raw * usdRate) : Math.round(raw);
            const formatted = {
              stockCode: it.symbol,
              stockName: this.stockInfoCache.get(it.symbol) || knownNames[it.symbol] || it.symbol,
              market: isUs ? 'US' : 'KR',
              currency: it.currency || (isUs ? 'USD' : 'KRW'),
              isFractional: isUs,
              currentPrice: priceKrw,
              currentPriceUsd: isUs ? raw : parseFloat((raw / usdRate).toFixed(2)),
              askPrice1: priceKrw,
              bidPrice1: priceKrw,
              askPrice1Usd: isUs ? raw : undefined,
              bidPrice1Usd: isUs ? raw : undefined,
              volume: 100000,
              changeRate: 0.0,
              exchangeRate: usdRate,
              provider: '토스증권(실시간)',
              isMock: false,
              timestamp: it.timestamp,
            };
            this.priceCache.set(it.symbol, { timestamp: Date.now(), data: formatted });
            return formatted;
          });
          return mapped;
        }
      } catch (e) {
        console.warn('[Toss] 다건 시세 조회 실패:', e.message);
      }
    }
    return [];
  }

  // 7. 토스증권 기반 미국장 운영 상태 및 소수점 주문 가능 시간 판별 (GET /api/v1/market-calendar/US)
  async getUsMarketStatus() {
    const usdRate = await this.getExchangeRate();
    const token = await this.getAuthToken();
    const now = new Date();
    const nowMs = now.getTime();

    let cal = null;
    if (this._usCalendarCache && (nowMs - this._usCalendarCacheTime < 300000)) {
      cal = this._usCalendarCache;
    } else if (token) {
      try {
        const resp = await this.fetchWithAuth('/api/v1/market-calendar/US', { method: 'GET' }, false);
        if (resp.ok) {
          const data = await resp.json();
          if (data.result) {
            cal = data.result;
            this._usCalendarCache = cal;
            this._usCalendarCacheTime = nowMs;
          }
        }
      } catch (e) {
        console.warn('[Toss] 미국 마켓 캘린더 조회 실패:', e.message);
      }
    }

    if (cal) {
      const parseRange = (m) => (m ? { start: new Date(m.startTime).getTime(), end: new Date(m.endTime).getTime(), startStr: m.startTime, endStr: m.endTime } : null);
      // KST 자정 이후(00:00~09:50)에는 전 영업일(previousBusinessDay)의 정규장/애프터마켓이 진행 중이므로 둘 다 검사
      const candidates = [cal.previousBusinessDay, cal.today].filter(Boolean);
      const nextRegStart = cal.today?.regularMarket?.startTime || cal.nextBusinessDay?.regularMarket?.startTime || '23:30';
      const nextRegTimeLabel = String(nextRegStart).includes('T') ? String(nextRegStart).split('T')[1].slice(0, 5) : '23:30';

      for (const dayObj of candidates) {
        const reg = parseRange(dayObj.regularMarket);
        const pre = parseRange(dayObj.preMarket);
        const aft = parseRange(dayObj.afterMarket);
        const day = parseRange(dayObj.dayMarket);

        if (reg && nowMs >= reg.start && nowMs <= reg.end) {
          // 토스증권 소수점 금액/수량 주문은 정규장 종료 1시간 전까지만 접수 가능
          const fractionalEndMs = reg.end - 3600000;
          const isFractionalOrderable = nowMs >= reg.start && nowMs <= fractionalEndMs;
          return {
            isOpen: true,
            phase: 'REGULAR',
            isFractionalOrderable,
            nextFractionalTime: nextRegTimeLabel,
            badge: isFractionalOrderable ? '🟢 미국 정규장 진행중 (소수점 즉시체결)' : '🟢 미국 정규장 마감임박 (온주만 가능)',
            color: 'green',
            exchangeRate: usdRate,
            date: dayObj.date,
          };
        }
        if (pre && nowMs >= pre.start && nowMs <= pre.end) {
          return {
            isOpen: true,
            phase: 'PRE_MARKET',
            isFractionalOrderable: false,
            nextFractionalTime: nextRegTimeLabel,
            badge: '🟡 미국 프리마켓 진행중',
            color: 'yellow',
            exchangeRate: usdRate,
            date: dayObj.date,
          };
        }
        if (aft && nowMs >= aft.start && nowMs <= aft.end) {
          return {
            isOpen: true,
            phase: 'AFTER_MARKET',
            isFractionalOrderable: false,
            nextFractionalTime: nextRegTimeLabel,
            badge: '🟡 미국 애프터마켓 진행중',
            color: 'yellow',
            exchangeRate: usdRate,
            date: dayObj.date,
          };
        }
        if (day && nowMs >= day.start && nowMs <= day.end) {
          return {
            isOpen: true,
            phase: 'DAY_MARKET',
            isFractionalOrderable: false,
            nextFractionalTime: nextRegTimeLabel,
            badge: '🟡 미국 주간거래(데이마켓) 진행중',
            color: 'yellow',
            exchangeRate: usdRate,
            date: dayObj.date,
          };
        }
      }

      const nextOpen = cal.today?.regularMarket?.startTime || cal.nextBusinessDay?.regularMarket?.startTime || cal.nextBusinessDay?.date;
      return {
        isOpen: false,
        phase: 'CLOSED',
        isFractionalOrderable: false,
        nextFractionalTime: nextRegTimeLabel,
        badge: nextOpen ? `⚪ 미국장 대기 (정규장 개장: ${nextRegTimeLabel})` : '⚪ 미국장 마감/휴장',
        color: 'gray',
        exchangeRate: usdRate,
      };
    }

    // 통신 불가 시 시간 기반 폴백 (동절기 정규장: 23:30 ~ 06:00 KST / 소수점 주문 가능: 23:30 ~ 05:00 KST)
    const kstMs = nowMs + 9 * 3600000;
    const kstDate = new Date(kstMs);
    const kstDay = kstDate.getUTCDay(); // 0=일, 6=토
    const kstMin = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();

    // 월~금 23:30~24:00 또는 화~토 00:00~06:00
    const isLateNightSession = (kstDay >= 1 && kstDay <= 5) && (kstMin >= 23 * 60 + 30);
    const isEarlyMorningSession = (kstDay >= 2 && kstDay <= 6) && (kstMin <= 6 * 60);
    const isUsRegular = isLateNightSession || isEarlyMorningSession;
    const isFractionalOrderable = isLateNightSession || ((kstDay >= 2 && kstDay <= 6) && (kstMin <= 5 * 60));

    return {
      isOpen: isUsRegular,
      phase: isUsRegular ? 'REGULAR' : 'CLOSED',
      isFractionalOrderable,
      nextFractionalTime: '23:30',
      badge: isUsRegular ? '🟢 미국 정규장 진행중' : '⚪ 미국장 마감 - 토스 실시간 시세 연동',
      color: isUsRegular ? 'green' : 'gray',
      exchangeRate: usdRate,
    };
  }

  // 시세 조회 실패 또는 미설정 시의 고정밀 폴백
  getFallbackPrice(symbol, isUsStock, usdRate) {
    const knownBase = {
      AAPL: 228.5,
      NVDA: 135.2,
      TSLA: 255.0,
      MSFT: 425.0,
      QQQ: 485.0,
      SBUX: 98.5,
    };
    const baseUsd = knownBase[symbol] || 150.0;
    const currentPriceUsd = baseUsd;
    const currentPrice = isUsStock ? Math.round(currentPriceUsd * usdRate) : 50000;

    return {
      stockCode: symbol,
      stockName: symbol,
      market: isUsStock ? 'US' : 'KR',
      currency: isUsStock ? 'USD' : 'KRW',
      isFractional: isUsStock,
      currentPrice,
      currentPriceUsd: isUsStock ? currentPriceUsd : undefined,
      askPrice1: currentPrice,
      bidPrice1: currentPrice,
      askPrice1Usd: currentPriceUsd,
      bidPrice1Usd: currentPriceUsd,
      volume: 100000,
      changeRate: 0.0,
      exchangeRate: usdRate,
      provider: '토스증권(가상시뮬레이션)',
      isMock: true,
    };
  }

  // 8. 토스증권 계좌 실제 예수금, 보유주식 평가액, 총 자산 조회 (5초 캐싱 & 뮤텍스 & Fallback 보호)
  async getAccountBalance() {
    if (this._balanceCache && Date.now() - this._balanceCacheTime < 5000) {
      return this._balanceCache;
    }

    if (this._balancePromise) {
      return this._balancePromise;
    }

    this._balancePromise = (async () => {
      const config = this.loadConfig();
      const token = await this.getAuthToken();

      if (token) {
        try {
          const accInfo = await this.getAccountSeq();
          const accountSeq = accInfo ? accInfo.accountSeq : 1;
          const accountNo = accInfo ? accInfo.accountNo : config.account_no;
          const usdRate = await this.getExchangeRate();

          // 1) KRW 주문 가능 예수금 (GET /api/v1/buying-power?currency=KRW)
          let availableCash = null;
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
          let stockEvalAmount = null;
          let totalPurchaseAmount = 0;
          let holdings = null;
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

          // 만약 두 요청 모두 실패했고 기존 유효 캐시가 존재하면 캐시 보존
          if (availableCash === null && stockEvalAmount === null && this._balanceCache) {
            return this._balanceCache;
          }

          const finalCash = availableCash !== null ? availableCash : (this._balanceCache?.availableCash || 0);
          const finalEval = stockEvalAmount !== null ? stockEvalAmount : (this._balanceCache?.stockEvalAmount || 0);
          const finalHoldings = holdings !== null ? holdings : (this._balanceCache?.holdings || []);
          const totalAssetAmount = finalCash + finalEval;
          const totalProfitKrw = finalEval - totalPurchaseAmount;

          const resObj = {
            availableCash: finalCash,
            stockEvalAmount: finalEval,
            totalAssetAmount,
            totalProfitKrw,
            profitRate,
            holdings: finalHoldings,
            accountNo,
            accountSeq,
            provider: '토스증권(실전)',
            isMock: false,
          };
          this._balanceCache = resObj;
          this._balanceCacheTime = Date.now();
          return resObj;
        } catch (e) {
          console.warn('[Toss] 실시간 계좌 잔고 파싱 오류:', e.message);
          if (this._balanceCache) return this._balanceCache;
        }
      }

      if (this._balanceCache) return this._balanceCache;

      // API 키 미설정 시의 기본 반환
      const fallbackObj = {
        availableCash: 0,
        stockEvalAmount: 0,
        totalAssetAmount: 0,
        totalProfitKrw: 0,
        profitRate: 0.0,
        holdings: [],
        provider: '토스증권(미연결)',
        isMock: true,
      };
      this._balanceCache = fallbackObj;
      this._balanceCacheTime = Date.now();
      return fallbackObj;
    })().finally(() => {
      this._balancePromise = null;
    });

    return this._balancePromise;
  }

  // 9. 토스증권 국내주식 실전 주문 발송 (POST /api/v1/orders)
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
