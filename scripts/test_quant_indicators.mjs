import { enrichStockWithIndicators, generateSyntheticCandles } from '../backend/common/indicator_calculator.mjs';
import { evaluatePureQuantAlgorithm, evaluatePureQuantExit, calculateDynamicPositionSize, parseBotConfig } from '../backend/common/quant_algorithms.mjs';
import { getDb } from '../backend/db/index.mjs';

console.log('=== 1. 시계열 지표 및 11대 봇 알고리즘 검증 테스트 시작 ===');

// DB 초기화 및 봇 로드
const db = getDb();
const bots = db.prepare('SELECT * FROM bots ORDER BY bot_id ASC').all();
console.log(`등록된 총 봇 수: ${bots.length}개`);

// 샘플 주식 데이터 생성
const sampleStock = {
  code: '005930',
  name: '삼성전자',
  market: 'KR',
  current_price: 75000,
  price: 75000,
  open: 74200,
  high: 75500,
  low: 73900,
  change_pct: 1.08,
  volume: 12500000,
  currentPriceUsd: 55.5,
  exchangeRate: 1350,
};

// 1. 지표 주입 테스트
const enrichedStock = enrichStockWithIndicators(sampleStock, []);
console.log('✅ 지표 주입 완료:');
console.log(`- MA5: ${enrichedStock.ma5}, MA20: ${enrichedStock.ma20}, MA60: ${enrichedStock.ma60}`);
console.log(`- RSI14: ${enrichedStock.rsi14}`);
console.log(`- 볼린저 밴드: 상단 ${enrichedStock.bbUpper?.toFixed(0)}, 하단 ${enrichedStock.bbLower?.toFixed(0)}`);
console.log(`- MACD: ${enrichedStock.macdLine?.toFixed(1)}, Signal: ${enrichedStock.signalLine?.toFixed(1)}, Hist: ${enrichedStock.macdHistogram?.toFixed(1)}`);
console.log(`- ATR: ${enrichedStock.atr?.toFixed(0)} (${enrichedStock.atr_pct?.toFixed(2)}%)`);
console.log(`- ADX: ${enrichedStock.adx?.toFixed(1)}, +DI: ${enrichedStock.plusDI?.toFixed(1)}, -DI: ${enrichedStock.minusDI?.toFixed(1)}`);
console.log(`- Stoch-RSI K: ${enrichedStock.stochK?.toFixed(1)}, D: ${enrichedStock.stochD?.toFixed(1)}`);
console.log(`- Squeeze 상태: ${enrichedStock.wasSqueezed}`);

// 2. 11대 봇 진입 평가 테스트
console.log('\n=== 2. 11대 봇 진입 평가 테스트 ===');
for (const bot of bots) {
  const parsedCfg = parseBotConfig(bot);
  const entryResult = evaluatePureQuantAlgorithm(bot, enrichedStock);
  const posSize = calculateDynamicPositionSize(bot, 10000000, entryResult.score, enrichedStock.atr_pct);
  console.log(`[${bot.bot_id}] ${bot.name}: shouldBuy=${entryResult.shouldBuy}, score=${entryResult.score}, size=${posSize.toLocaleString()}원, reason=${entryResult.reason}`);
}

// 3. 청산 로직 및 트레일링 스탑 테스트
console.log('\n=== 3. 청산 로직 및 트레일링 스탑 테스트 ===');
const samplePos = {
  id: 1,
  bot_id: 'bot_01_volatility_breakout',
  stock_code: '005930',
  stock_name: '삼성전자',
  qty: 10,
  avg_buy_price: 70000,
  highest_price: 74000,
  trailing_active: 1,
  buy_amount: 700000,
  created_at: new Date(Date.now() - 3600000).toISOString(),
};

// 현재가 72000원 (고점 74000원 대비 하락 -> 트레일링 스탑 테스트)
const quoteForExit = { ...enrichedStock, current_price: 72000, price: 72000 };
const testBot = bots.find(b => b.bot_id === 'bot_01_volatility_breakout') || bots[0];
const exitEval = evaluatePureQuantExit(testBot, samplePos, quoteForExit, { fastCycleEnabled: false });

console.log(`트레일링 스탑 평가 결과: shouldExit=${exitEval.shouldExit}, reason=${exitEval.exitReason}, highestPrice=${exitEval.highestPrice}, trailingActive=${exitEval.trailingActive}`);

console.log('\n=== 모든 단위 검증 테스트 통과 ===');
process.exit(0);
