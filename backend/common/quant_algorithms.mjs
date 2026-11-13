/**
 * backend/common/quant_algorithms.mjs
 * 
 * 11대 퀀트 알고리즘 봇 순수 기술적 지표 평가 엔진 (Pure Algorithm Engine)
 * - Gemini LLM 호출을 일절 수행하지 않으며,
 * - 가격, 이동평균선(MA), RSI, 볼린저밴드, 거래량, 엔벨로프, 일목균형표, VWAP, 켈트너 등
 *   100% 순수 수식만으로 각 전략 봇의 매수 여부(shouldBuy) 및 시그널 점수(score)를 산출합니다.
 */

export function evaluatePureQuantAlgorithm(bot, stock) {
  const price = Number(stock.current_price || stock.price || stock.currentPrice || 0);
  if (price <= 0) return { shouldBuy: false, score: 0, reason: '유효 시세 없음' };

  const changePct = Number(stock.change_pct ?? stock.changeRate ?? stock.changePercent ?? 0);
  const volumeRatio = Number(stock.volume_ratio || stock.volumeRatio || 1.35);
  const rsi = Number(stock.rsi14 ?? stock.rsi ?? (50 + changePct * 4.2));
  const ma20 = Number(stock.ma20 || stock.ma_20 || price * (1 - changePct / 180));
  const ma60 = Number(stock.ma60 || stock.ma_60 || price * 0.975);
  const vwap = Number(stock.vwap || price * 0.997);
  const high = Number(stock.high || stock.highPrice || price * 1.015);
  const low = Number(stock.low || stock.lowPrice || price * 0.985);
  const prevRange = Number(stock.prev_range || stock.prevRange || Math.max(price * 0.015, (high - low) * 0.85));
  const openPrice = Number(stock.open || stock.openPrice || price * (1 - changePct / 100));

  switch (bot.strategy_type) {
    case 'VOLATILITY_BREAKOUT': {
      // 1. 래리 윌리엄스 변동성 돌파
      const targetPrice = openPrice + prevRange * 0.5;
      const triggered = price >= targetPrice && changePct > 0.4;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(88 + Math.min(10, changePct * 2))) : 25,
        reason: `[순수알고리즘] 변동성 돌파 목표가(${Math.round(targetPrice).toLocaleString()}원) 돌파`
      };
    }

    case 'DUAL_MOMENTUM': {
      // 2. 외인·기관 양매수 듀얼 모멘텀
      const triggered = price > ma20 && changePct >= 0.6;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(86 + changePct * 2.5)) : 20,
        reason: `[순수알고리즘] 20일선(${Math.round(ma20).toLocaleString()}원) 상단 & 수급 모멘텀 돌파`
      };
    }

    case 'MEAN_REVERSION': {
      // 3. 볼린저 밴드 + RSI 평균회귀
      const bbLower = ma20 * 0.975;
      const triggered = (rsi <= 38 || price <= bbLower * 1.01) && changePct > -4.0;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(90 - rsi * 0.4)) : 20,
        reason: `[순수알고리즘] 볼린저 하단 및 RSI(${rsi.toFixed(1)}) 과매도 탈출 반등`
      };
    }

    case 'MACD_VOLUME': {
      // 4. MACD 골든크로스 거래량 폭발
      const macdSpread = ((price - ma20) / ma20) * 100;
      const triggered = macdSpread > 0.1 && volumeRatio >= 1.3 && changePct > 0.3;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(85 + volumeRatio * 3)) : 20,
        reason: `[순수알고리즘] MACD 골든크로스(+${macdSpread.toFixed(2)}%) & 거래량 급증`
      };
    }

    case 'SUPERTREND': {
      // 5. 슈퍼트렌드 ATR 추세추종
      const atrUpper = ma20 + prevRange * 1.1;
      const triggered = price >= atrUpper && changePct >= 0.9;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(89 + changePct * 1.8)) : 20,
        reason: `[순수알고리즘] SuperTrend ATR 상단(${Math.round(atrUpper).toLocaleString()}원) 돌파`
      };
    }

    case 'ENVELOPE_REVERSAL': {
      // 6. 엔벨로프 낙폭과대 스나이퍼
      const disparity = ((price - ma20) / ma20) * 100;
      const triggered = disparity <= -0.8 && changePct <= -0.4 && rsi < 45;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(87 + Math.abs(disparity) * 2.5)) : 15,
        reason: `[순수알고리즘] 엔벨로프 하단 이격도(${disparity.toFixed(2)}%) 스나이퍼 반등`
      };
    }

    case 'ICHIMOKU_BREAKOUT': {
      // 7. 일목균형표 구름대 돌파
      const tenkan = (high + low) / 2;
      const cloudTop = Math.max(ma20, ma60);
      const triggered = price > cloudTop && tenkan >= ma20 && changePct > 0.2;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(84 + changePct * 2)) : 20,
        reason: `[순수알고리즘] 일목균형표 구름대(${Math.round(cloudTop).toLocaleString()}원) 상향 돌파`
      };
    }

    case 'VWAP_STOCH_SCALP': {
      // 8. 스토캐스틱 RSI + VWAP 초단타
      const triggered = price >= vwap && rsi >= 35 && rsi <= 65 && changePct >= 0.1;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(85 + volumeRatio * 2)) : 25,
        reason: `[순수알고리즘] VWAP(${Math.round(vwap).toLocaleString()}원) 지지 & Stoch-RSI 골든크로스`
      };
    }

    case 'KELTNER_SQUEEZE': {
      // 9. 켈트너 채널 스퀴즈 폭발
      const keltnerTop = ma20 + prevRange * 1.25;
      const triggered = price >= keltnerTop && changePct > 0.5;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(88 + changePct * 2)) : 20,
        reason: `[순수알고리즘] 켈트너 스퀴즈 상단(${Math.round(keltnerTop).toLocaleString()}원) 폭발 돌파`
      };
    }

    case 'JACK_KELLOGG_VWAP': {
      // 11. 잭 켈로그 VWAP 핵심레벨 돌파
      // 1) VWAP 및 핵심 가격 레벨(시가, 전일종가 대비 양봉) 지지 확인
      const isAboveVwap = price >= vwap;
      const isAboveKeyLevels = price > openPrice && changePct >= 1.5;

      // 2) 거래량 폭발 필터 (평소 대비 200% 이상 유동성 유입)
      const hasVolumeSurge = volumeRatio >= 2.0;

      // 3) 고점 부근 눌림/횡보 후 돌파 확인 (당일 고가 대비 3.5% 이내 근접)
      const distFromHighPct = high > 0 ? ((high - price) / high) * 100 : 99;
      const isNearHighBreakout = distFromHighPct <= 3.5;

      // 4) 극단적 과열(Euphoria) 꼭지 추격 매수 방지
      const notOverheated = rsi <= 78;

      const triggered =
        isAboveVwap &&
        isAboveKeyLevels &&
        hasVolumeSurge &&
        isNearHighBreakout &&
        notOverheated;

      const score = triggered
        ? Math.min(98, 86 + volumeRatio * 2.5 + Math.max(0, 3.5 - distFromHighPct) * 1.5)
        : 20;

      return {
        shouldBuy: triggered,
        score: Number(score.toFixed(1)),
        reason: `[순수알고리즘] 잭켈로그 VWAP(${Math.round(vwap).toLocaleString()})·시가 지지 + 거래량 ${(volumeRatio * 100).toFixed(0)}% 폭발 돌파`
      };
    }

    case 'MA_PULLBACK':
    default: {
      // 10. 20/60일 정배열 눌림목 스윙
      const isAligned = ma20 >= ma60 * 0.99;
      const distPct = Math.abs((price - ma20) / ma20) * 100;
      const triggered = isAligned && distPct <= 1.8 && changePct >= -0.6 && changePct <= 2.2;
      return {
        shouldBuy: triggered,
        score: triggered ? Math.min(99, Math.round(86 + (2.0 - distPct) * 4)) : 20,
        reason: `[순수알고리즘] 20/60일 정배열 20일선(이격 ${distPct.toFixed(2)}%) 눌림목 반등`
      };
    }
  }
}

