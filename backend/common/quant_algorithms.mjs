/**
 * backend/common/quant_algorithms.mjs
 * 
 * 11대 퀀트 알고리즘 봇 순수 기술적 지표 평가 및 동적 청산/포지션 사이징 엔진 (Pure Algorithm Engine)
 * - Gemini LLM 호출을 일절 수행하지 않으며,
 * - 캔들 시계열 지표(SMA, EMA, RSI, 볼린저밴드, MACD, ATR, ADX, 일목균형표, Stoch-RSI, 켈트너 등)와
 *   DB bot.config_json 동적 파라미터를 결합하여 진입(Entry) 및 맞춤 청산(Exit)을 수행합니다.
 */

export function parseBotConfig(bot) {
  try {
    return typeof bot.config_json === 'string'
      ? JSON.parse(bot.config_json || '{}')
      : (bot.config_json || {});
  } catch (_) {
    return {};
  }
}

/**
 * 11대 퀀트 봇 순수 알고리즘 진입(Entry) 평가
 */
export function evaluatePureQuantAlgorithm(bot, stock) {
  const price = Number(stock.current_price || stock.price || stock.currentPrice || 0);
  if (price <= 0) return { shouldBuy: false, score: 0, reason: '유효 시세 없음' };

  const cfg = parseBotConfig(bot);
  const changePct = Number(stock.change_pct ?? stock.changeRate ?? stock.changePercent ?? 0);
  const volumeRatio = Number(stock.volume_ratio || stock.volumeRatio || 1.0);
  const openPrice = Number(stock.open || stock.openPrice || price * (1 - changePct / 100));
  const high = Number(stock.high || stock.highPrice || price * 1.01);
  const low = Number(stock.low || stock.lowPrice || price * 0.99);

  const ma5 = Number(stock.ma5 || price);
  const ma20 = Number(stock.ma20 || stock.ma_20 || price * (1 - changePct / 180));
  const ma60 = Number(stock.ma60 || stock.ma_60 || price * 0.98);
  const ema20 = Number(stock.ema20 || ma20);
  const rsi = Number(stock.rsi14 ?? stock.rsi ?? (50 + changePct * 3.5));
  const prevRsi = Number(stock.prevRsi14 ?? rsi);
  const prevRange = Number(stock.prev_range || stock.prevRange || Math.max(price * 0.015, (high - low) * 0.85));
  const atr = Number(stock.atr || prevRange);
  const adx = Number(stock.adx ?? 25);
  const vwap = Number(stock.vwap || price * 0.998);

  switch (bot.strategy_type) {
    // 1. 래리 윌리엄스 변동성 돌파 (VOL-BREAK #1)
    case 'VOLATILITY_BREAKOUT': {
      const kFactor = Number(cfg.k_factor ?? 0.5);
      const volSurge = Number(cfg.vol_surge_ratio ?? 2.0);
      const targetPrice = openPrice + prevRange * kFactor;
      const isBreakout = price >= targetPrice && price > openPrice;
      const hasVolume = volumeRatio >= volSurge * 0.85;
      const triggered = isBreakout && hasVolume && rsi < 80;
      const breakoutPct = targetPrice > 0 ? ((price - targetPrice) / targetPrice) * 100 : 0;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(98, Math.round(84 + volumeRatio * 3 + breakoutPct * 2)) : 20,
        reason: `[VOL-BREAK] 목표가(${Math.round(targetPrice).toLocaleString()}원, K=${kFactor}) 돌파 & 거래량 ${(volumeRatio * 100).toFixed(0)}%`
      };
    }

    // 2. 외인·기관 양매수 듀얼 모멘텀 (INST-DUAL #2)
    case 'DUAL_MOMENTUM': {
      const minInstStreak = Number(cfg.min_inst_streak ?? 3);
      const instStreak = Number(stock.inst_net_buy_streak ?? (changePct >= 1.2 && volumeRatio >= 1.4 ? minInstStreak : 2));
      const ret20d = Number(stock.ret20d ?? changePct * 2.5);
      const isTrendAligned = price > ma20 && ma20 >= ma60 * 0.995;
      const triggered = isTrendAligned && ret20d >= 1.5 && instStreak >= minInstStreak && rsi >= 48 && rsi <= 76;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(97, Math.round(83 + Math.min(10, ret20d * 0.8) + instStreak * 2)) : 20,
        reason: `[INST-DUAL] 20일 모멘텀(+${ret20d.toFixed(1)}%) & 수급(${instStreak}일) + 20일선 정배열`
      };
    }

    // 3. 볼린저 밴드 + RSI 평균회귀 (BB-RSI #3)
    case 'MEAN_REVERSION': {
      const bbStd = Number(cfg.bb_std ?? 2.0);
      const rsiLow = Number(cfg.rsi_low ?? 32);
      const std20 = Number(stock.std20 || ma20 * 0.018);
      const bbLower = Number(stock.bbLower || (ma20 - std20 * bbStd));
      const touchedLowerBand = low <= bbLower * 1.008 && price >= bbLower * 0.995;
      const isBullishRebound = price >= openPrice || price > low * 1.005;
      const isOversoldExit = rsi <= rsiLow || (prevRsi <= rsiLow && rsi > prevRsi);
      const triggered = touchedLowerBand && isBullishRebound && isOversoldExit;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(96, Math.round(88 + Math.max(0, rsiLow - rsi) * 0.8)) : 15,
        reason: `[BB-RSI] 볼린저 하단(${Math.round(bbLower).toLocaleString()}원) 복귀 & RSI(${rsi.toFixed(1)}) 과매도 반등`
      };
    }

    // 4. MACD 골든크로스 거래량 폭발 (MACD-SURGE #4)
    case 'MACD_VOLUME': {
      const volMult = Number(cfg.vol_mult ?? 3.0);
      const hist = Number(stock.macdHistogram ?? 0);
      const prevHist = Number(stock.prevMacdHistogram ?? -1);
      const macdLine = Number(stock.macdLine ?? 0);
      const signalLine = Number(stock.signalLine ?? 0);
      const isGoldenCross = (macdLine >= signalLine && hist > 0 && prevHist <= 0) || (hist > 0 && hist >= prevHist * 1.2);
      const isVolumeSurge = volumeRatio >= volMult * 0.75;
      const triggered = isGoldenCross && isVolumeSurge && price >= ma20 * 0.995;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(98, Math.round(84 + volumeRatio * 3.2)) : 20,
        reason: `[MACD-SURGE] MACD 시그널 상향돌파(Hist +${hist.toFixed(2)}) & 거래량 ${(volumeRatio * 100).toFixed(0)}% 폭발`
      };
    }

    // 5. 슈퍼트렌드 ATR 추세추종 (SUPER-ATR #5)
    case 'SUPERTREND': {
      const mult = Number(cfg.multiplier ?? 3.0);
      const minAdx = Number(cfg.min_adx ?? 25);
      const hl2 = (high + low) / 2;
      const supertrendUpper = Number(stock.supertrendUpper || (hl2 + atr * (mult * 0.55)));
      const triggered = price >= supertrendUpper && adx >= minAdx && price > ma20;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(97, Math.round(82 + (adx - minAdx) * 0.7 + changePct * 1.5)) : 20,
        reason: `[SUPER-ATR] SuperTrend(${Math.round(supertrendUpper).toLocaleString()}원) 돌파 & ADX(${adx.toFixed(1)}) 강세`
      };
    }

    // 6. 엔벨로프 낙폭과대 스나이퍼 (ENV-SNIPER #6)
    case 'ENVELOPE_REVERSAL': {
      const envPct = Number(cfg.envelope_pct ?? -7.0);
      const disparity = ma20 > 0 ? ((price - ma20) / ma20) * 100 : 0;
      const lowDisparity = ma20 > 0 ? ((low - ma20) / ma20) * 100 : 0;
      const isDeepDip = disparity <= envPct * 0.75 || lowDisparity <= envPct;
      const isTickRebound = price > low * 1.005 && price >= openPrice * 0.995;
      const triggered = isDeepDip && isTickRebound && rsi <= 40;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(96, Math.round(85 + Math.abs(disparity) * 1.5)) : 15,
        reason: `[ENV-SNIPER] 20일선 이격도(${disparity.toFixed(2)}%) 엔벨로프 하단 터치 후 틱 반등`
      };
    }

    // 7. 일목균형표 구름대 돌파 (ICHIMOKU #7)
    case 'ICHIMOKU_BREAKOUT': {
      const tenkan = Number(stock.tenkan || (high + low) / 2);
      const kijun = Number(stock.kijun || ma20);
      const cloudTop = Number(stock.cloudTop || Math.max(ma20, ma60));
      const isTKCross = tenkan >= kijun;
      const isAboveCloud = price > cloudTop && openPrice <= cloudTop * 1.025;
      const triggered = isTKCross && isAboveCloud && volumeRatio >= 1.25;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(95, Math.round(84 + volumeRatio * 2.5 + changePct * 1.5)) : 20,
        reason: `[ICHIMOKU] 전환선(${Math.round(tenkan).toLocaleString()}원)≥기준선 호전 & 구름대 상단(${Math.round(cloudTop).toLocaleString()}원) 돌파`
      };
    }

    // 8. 스토캐스틱 RSI + VWAP 초단타 (VWAP-SCALP #8)
    case 'VWAP_STOCH_SCALP': {
      const vwapMargin = Number(cfg.vwap_margin ?? 0.002);
      const stochK = Number(stock.stochK ?? 50);
      const stochD = Number(stock.stochD ?? 50);
      const prevStochK = Number(stock.prevStochK ?? stochK);
      const prevStochD = Number(stock.prevStochD ?? stochD);

      const isVwapSupported = price >= vwap * (1 + vwapMargin);
      const isStochOversoldCross = (stochK <= 35 && stochK >= stochD) || (stochK > stochD && prevStochK <= prevStochD);
      const triggered = isVwapSupported && isStochOversoldCross && volumeRatio >= 1.15;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(96, Math.round(86 + Math.max(0, 35 - stochK) * 0.5 + volumeRatio * 2)) : 20,
        reason: `[VWAP-SCALP] VWAP(${Math.round(vwap).toLocaleString()}원) 상단 지지 & Stoch-RSI(%K ${stochK.toFixed(1)}) 골든크로스`
      };
    }

    // 9. 켈트너 채널 스퀴즈 폭발 (KELTNER #9)
    case 'KELTNER_SQUEEZE': {
      const atrMult = Number(cfg.atr_mult ?? 1.5);
      const kcUpper = Number(stock.kcUpper || (ema20 + atr * atrMult));
      const bbUpper = Number(stock.bbUpper || (ma20 + atr * 1.6));
      const wasSqueezed = Boolean(stock.wasSqueezed ?? true);
      const hist = Number(stock.macdHistogram ?? 0.5);

      const isBreakout = price >= kcUpper * 0.998 && price >= bbUpper * 0.995;
      const triggered = wasSqueezed && isBreakout && hist > 0 && volumeRatio >= 1.35;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(98, Math.round(87 + volumeRatio * 2.5 + changePct * 1.5)) : 20,
        reason: `[KELTNER] 볼린저-켈트너 스퀴즈 응축 후 상단(${Math.round(kcUpper).toLocaleString()}원) 폭발 돌파`
      };
    }

    // 11. 잭 켈로그 VWAP 핵심레벨 돌파 (KELLOGG-VWAP #11)
    case 'JACK_KELLOGG_VWAP': {
      const minVolRatio = Number(cfg.min_vol_ratio ?? 2.0);
      const maxDistHigh = Number(cfg.max_dist_from_high_pct ?? 3.5);
      const maxRsi = Number(cfg.max_rsi ?? 78);

      const isAboveVwap = price >= vwap;
      const isAboveKeyLevels = price > openPrice && changePct >= 1.5;
      const hasVolumeSurge = volumeRatio >= minVolRatio * 0.85;
      const distFromHighPct = high > 0 ? ((high - price) / high) * 100 : 99;
      const isNearHighBreakout = distFromHighPct <= maxDistHigh;
      const notOverheated = rsi <= maxRsi;

      const triggered = isAboveVwap && isAboveKeyLevels && hasVolumeSurge && isNearHighBreakout && notOverheated;
      const score = triggered ? Math.min(99, 86 + volumeRatio * 2.5 + Math.max(0, maxDistHigh - distFromHighPct) * 1.5) : 20;

      return {
        shouldBuy: triggered,
        score: Number(score.toFixed(1)),
        reason: `[KELLOGG-VWAP] VWAP(${Math.round(vwap).toLocaleString()}원)·시가 지지 + 거래량 ${(volumeRatio * 100).toFixed(0)}% 고점 돌파`
      };
    }

    // 10. 20/60일 정배열 눌림목 스윙 (PULLBACK #10)
    case 'MA_PULLBACK':
    default: {
      const tolerance = Number(cfg.pullback_tolerance ?? 0.8);
      const isAligned = ma20 >= ma60 * 0.99;
      const distFromMa20Pct = ma20 > 0 ? ((price - ma20) / ma20) * 100 : 0;
      const isPullbackZone = distFromMa20Pct >= -tolerance && distFromMa20Pct <= tolerance * 1.8;
      const isBouncing = price >= openPrice * 0.998 && price >= ma20 * 0.995 && rsi >= 40 && rsi <= 65;
      const triggered = isAligned && isPullbackZone && isBouncing;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(95, Math.round(86 + (tolerance * 1.8 - Math.abs(distFromMa20Pct)) * 5)) : 20,
        reason: `[PULLBACK] 20/60일 정배열 + 20일선(이격 ${distFromMa20Pct.toFixed(2)}%) 눌림목 지지 반등`
      };
    }
  }
}

/**
 * 11대 퀀트 봇의 전략 유형을 3대 전략군(Strategy Family)으로 분류
 * - BREAKOUT: 돌파·모멘텀군
 * - TREND: 추세·수급군
 * - REVERSION: 평균회귀·역추세·스캘핑군
 */
export function getBotStrategyFamily(bot) {
  const type = String(bot?.strategy_type || '').toUpperCase();
  switch (type) {
    case 'VOLATILITY_BREAKOUT':
    case 'MACD_VOLUME':
    case 'KELTNER_SQUEEZE':
    case 'JACK_KELLOGG_VWAP':
      return 'BREAKOUT';

    case 'DUAL_MOMENTUM':
    case 'SUPERTREND':
    case 'ICHIMOKU_BREAKOUT':
    case 'MA_PULLBACK':
      return 'TREND';

    case 'MEAN_REVERSION':
    case 'ENVELOPE_REVERSAL':
    case 'VWAP_STOCH_SCALP':
    default:
      return 'REVERSION';
  }
}

/**
 * 11대 퀀트 봇 전략별 맞춤 기술적 청산(Exit) 및 트레일링 스탑 판정
 */
export function evaluatePureQuantExit(bot, pos, quote, options = { fastCycleEnabled: false }) {
  quote = quote || {};
  const curPrice = Number(quote.current_price || quote.price || quote.currentPrice || pos.avg_buy_price);
  const avgBuyPrice = Number(pos.avg_buy_price || curPrice);
  const highestPrice = Math.max(Number(pos.highest_price || avgBuyPrice), curPrice);

  // 실현 손익률 및 최고점 대비 낙폭 계산
  const rawProfitPct = avgBuyPrice > 0 ? ((curPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  const peakProfitPct = avgBuyPrice > 0 ? ((highestPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  const drawdownFromPeakPct = highestPrice > 0 ? ((curPrice - highestPrice) / highestPrice) * 100 : 0;

  const takeProfitPct = Number(bot.take_profit_pct || 4.5);
  const stopLossPct = -Math.abs(Number(bot.stop_loss_pct || -2.5));
  const cfg = parseBotConfig(bot);

  const trailingActive = peakProfitPct >= takeProfitPct * 0.65;

  // 1) 목표 익절선 도달
  if (rawProfitPct >= takeProfitPct) {
    const reason = `[목표익절] +${rawProfitPct.toFixed(2)}% 도달 (목표 +${takeProfitPct}%)`;
    return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
  }

  // 2) 고정 손절선 도달
  if (rawProfitPct <= stopLossPct) {
    const reason = `[원칙손절] ${rawProfitPct.toFixed(2)}% 도달 (한도 ${stopLossPct}%)`;
    return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
  }

  // 3) 고점 추적 트레일링 스탑 (목표 익절치의 65% 이상 도달 후 고점 대비 35% 이상 수익 반납 시 익절 확정)
  if (trailingActive && drawdownFromPeakPct <= -(peakProfitPct * 0.35)) {
    const reason = `[트레일링스탑] 최고 +${peakProfitPct.toFixed(2)}% 도달 후 고점 대비 ${drawdownFromPeakPct.toFixed(2)}% 수익보전 익절`;
    return { shouldExit: true, highestPrice, trailingActive: true, exitReason: reason, reason };
  }

  // 4) 전략별 고유 기술적 청산(Technical Exit) 규칙
  const ma20 = Number(quote.ma20 || curPrice);
  const vwap = Number(quote.vwap || curPrice);
  const openPrice = Number(quote.open || curPrice);
  const rsi = Number(quote.rsi14 ?? 50);

  switch (bot.strategy_type) {
    case 'JACK_KELLOGG_VWAP': {
      const vwapBuffer = Number(cfg.vwap_stop_buffer ?? 0.995);
      if (curPrice < vwap * vwapBuffer && curPrice < openPrice) {
        const reason = `[잭켈로그 칼손절] VWAP 및 당일 시가 핵심 지지선 동시 이탈 (수익률 ${rawProfitPct.toFixed(2)}%)`;
        return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
      }
      break;
    }

    case 'MEAN_REVERSION':
    case 'ENVELOPE_REVERSAL': {
      // 역추세 평균회귀 전략은 주가가 20일 중심선(MA20)을 회복하고 수익권(+0.8% 이상)이면 중심선 청산
      if (rawProfitPct >= 0.8 && (curPrice >= ma20 || rsi >= 68)) {
        const reason = `[평균회귀완료] 20일 중심선(${Math.round(ma20).toLocaleString()}원) 회복 청산 (+${rawProfitPct.toFixed(2)}%)`;
        return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
      }
      break;
    }

    case 'MACD_VOLUME': {
      const hist = Number(quote.macdHistogram ?? 0);
      const prevHist = Number(quote.prevMacdHistogram ?? 0);
      if (rawProfitPct >= 0.8 && hist < 0 && prevHist >= 0) {
        const reason = `[MACD데드크로스] 히스토그램 음전환 추세 종료 청산 (+${rawProfitPct.toFixed(2)}%)`;
        return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
      }
      break;
    }

    case 'ICHIMOKU_BREAKOUT': {
      const tenkan = Number(quote.tenkan || curPrice);
      const kijun = Number(quote.kijun || curPrice);
      if (rawProfitPct >= 0.8 && tenkan < kijun && curPrice < kijun) {
        const reason = `[일목기준선이탈] 전환선 역전 및 기준선 하향 이탈 청산 (+${rawProfitPct.toFixed(2)}%)`;
        return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
      }
      break;
    }

    case 'VWAP_STOCH_SCALP': {
      const stochK = Number(quote.stochK ?? 50);
      const stochD = Number(quote.stochD ?? 50);
      if (rawProfitPct >= 0.8 && stochK >= 80 && stochK < stochD) {
        const reason = `[스캘핑과열청산] Stoch-RSI 과매수 데드크로스 익절 (+${rawProfitPct.toFixed(2)}%)`;
        return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
      }
      break;
    }

    default:
      break;
  }

  // 5) 옵션: 초단기 고속 테스트 모드(virtual_fast_cycle_mode === true 또는 '1')일 때만 시간 청산 작동
  if (options.fastCycleEnabled) {
    const heldSec = (Date.now() - new Date(pos.created_at).getTime()) / 1000;
    if ((heldSec >= 25 && (rawProfitPct >= 0.5 || rawProfitPct <= -1.0)) || heldSec >= 75) {
      const reason = `[고속테스트모드] 보유 ${Math.round(heldSec)}초 경과 순환 청산 (${rawProfitPct >= 0 ? '+' : ''}${rawProfitPct.toFixed(2)}%)`;
      return { shouldExit: true, highestPrice, trailingActive, exitReason: reason, reason };
    }
  }

  return { shouldExit: false, highestPrice, trailingActive, exitReason: '보유 유지', reason: '보유 유지' };
}

/**
 * 시그널 신뢰도(score) + 종목 변동성(ATR%) + LLM 레짐 가중치(regimeMultiplier) 결합 동적 포지션 사이징
 * 지원 시그니처:
 *  - calculateDynamicPositionSize(bot, signalScore, stock, availableKrw, regimeMultiplier = 1.0)
 *  - calculateDynamicPositionSize(bot, availableKrw, score, stockOrAtrPct, regimeMultiplier = 1.0)
 *  - calculateDynamicPositionSize(bot, score, atrPct, availableKrw, regimeMultiplier = 1.0)
 */
export function calculateDynamicPositionSize(bot, arg2, arg3, arg4, regimeMultiplier = 1.0) {
  let availableKrw = 1000000;
  let score = 80;
  let atrPct = 2.0;

  if (typeof arg3 === 'object' && arg3 !== null) {
    // 신형 시그니처: (bot, signalScore, stock, availableKrw, regimeMultiplier)
    score = typeof arg2 === 'number' ? arg2 : 80;
    atrPct = Number(arg3?.atr_pct ?? arg3?.atrPct ?? 2.0) || 2.0;
    availableKrw = typeof arg4 === 'number' ? arg4 : 1000000;
  } else if (typeof arg2 === 'number' && typeof arg4 === 'number' && arg2 <= 100 && arg4 > 1000) {
    // 구형 시그니처 A: (bot, score, atrPct, availableKrw)
    score = arg2;
    atrPct = Number(arg3) || 2.0;
    availableKrw = arg4;
  } else {
    // 구형 시그니처 B: (bot, availableKrw, score, stockOrAtrPct)
    availableKrw = typeof arg2 === 'number' ? arg2 : 1000000;
    score = typeof arg3 === 'number' ? arg3 : 80;
    atrPct = typeof arg4 === 'object' && arg4 !== null
      ? (Number(arg4?.atr_pct ?? arg4?.atrPct ?? 2.0) || 2.0)
      : (Number(arg4) || 2.0);
  }

  const safeRegimeMult = Math.min(1.2, Math.max(0.0, Number(regimeMultiplier ?? 1.0)));
  if (safeRegimeMult <= 0 || Number(availableKrw) <= 0) return 0;

  const scoreWeight = Math.min(1.25, Math.max(0.7, Number(score || 80) / 85));
  // 변동성이 너무 큰 종목(ATR > 4%)은 비중을 줄여 리스크 평준화
  const volatilityDamper = atrPct > 4.0 ? 0.7 : atrPct > 2.5 ? 0.85 : 1.0;

  const baseFraction = 0.30; // 기본 1종목당 가용 현금의 30% (최대 3종목 분산)
  const minFraction = 0.12 * Math.min(1.0, safeRegimeMult);
  const finalFraction = Math.min(
    0.40,
    Math.max(minFraction, baseFraction * scoreWeight * volatilityDamper * safeRegimeMult)
  );
  return Math.floor(Number(availableKrw) * finalFraction);
}
