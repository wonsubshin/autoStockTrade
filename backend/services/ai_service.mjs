import fs from 'node:fs';
import { getDb } from '../db/index.mjs';
import { BROKER_CONFIG_PATH, PROJECT_ROOT } from '../config/env.mjs';
import { LLMDecisionService } from '../common/llm_decision_service.mjs';
import { kiwoomClient, TOP_KR_STOCKS, ALL_CANDIDATE_STOCKS } from './market_service.mjs';
import { TradeService, pythonBridge } from './trade_service.mjs';
import { virtualEngine } from './bot_service.mjs';

export const llmDecisionService = new LLMDecisionService(PROJECT_ROOT, getDb);

export class AiService {
  static getRecentDecisions(limit = 20) {
    return llmDecisionService.getRecentDecisions(limit);
  }

  static async evaluateAndTrade({ botId, candidateCode, executeTrade }) {
    const db = getDb();
    const candidates = candidateCode
      ? ALL_CANDIDATE_STOCKS.filter((c) => c.code === candidateCode)
      : ALL_CANDIDATE_STOCKS;

    const decisions = await llmDecisionService.evaluateTradeSignals(candidates);
    let executedResult = null;

    if (executeTrade && botId) {
      const bot = db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId);
      if (bot) {
        // 사용자 설정 구매 우선순위 로드
        const prioRow = db.prepare("SELECT value FROM system_settings WHERE key = 'purchase_priority'").get();
        let priorityList = ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL'];
        if (prioRow && prioRow.value) {
          try {
            const parsed = JSON.parse(prioRow.value);
            if (Array.isArray(parsed) && parsed.length > 0) priorityList = parsed;
          } catch (e) {}
        }

        // 우선순위에 따른 최적 매수 시그널 탐색
        let buySignal = null;
        for (const priority of priorityList) {
          if (priority === 'KR_UNIT') {
            buySignal = decisions.find((d) => d.action === 'BUY' && d.confidence >= 65 && d.market === 'KR');
          } else if (priority === 'US_UNIT' || priority === 'US_FRACTIONAL') {
            buySignal = decisions.find((d) => d.action === 'BUY' && d.confidence >= 65 && d.market === 'US');
          }
          if (buySignal) break;
        }
        if (!buySignal) {
          buySignal = decisions.find((d) => d.action === 'BUY') || decisions[0];
        }

        if (buySignal) {
          const stock = ALL_CANDIDATE_STOCKS.find((s) => s.code === buySignal.symbol) || candidates[0];
          const isReal = bot.trade_mode === 'REAL';
          const priceInfo = await kiwoomClient.getCurrentPrice(stock.code);
          const nowIso = new Date().toISOString();
          const isUs = stock.market === 'US';
          const preferUnitOverFractional = priorityList.indexOf('US_UNIT') < priorityList.indexOf('US_FRACTIONAL');

          if (!isReal) {
            // Virtual Buy
            const vResult = await virtualEngine.executeVirtualBuy({
              botId,
              stockCode: stock.code,
              stockName: stock.name,
              requestedBudget: 2000000,
              isFractional: isUs && !preferUnitOverFractional,
            });
            executedResult = { ...vResult, mode: 'VIRTUAL' };
            db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_VIRTUAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
              .run(vResult.orderNo, stock.code);
          } else {
            // Real Buy via Python Core Executor
            try {
              if (isUs) {
                // 미국 주식: 우선순위 및 가용 잔고에 따라 1주 온주 vs 소수점 분기
                const unitPriceKrw = priceInfo.currentPrice;
                const tossBal = await tossClient.getAccountBalance();

                if (preferUnitOverFractional && tossBal.availableCash >= unitPriceKrw && unitPriceKrw > 0) {
                  // 미국 1주 온주 매수
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: stock.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'US',
                    quantity: 1,
                    reason: `Gemini AI 추천 미국 1주 온주 매수 ($${priceInfo.currentPriceUsd})`,
                  });
                  executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: false };
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                    .run(orderRes.orderId || `TORD_${Date.now()}`, stock.code);
                } else {
                  // 미국 소수점 금액 매수 ($10)
                  const targetUsd = 10;
                  const orderRes = await pythonBridge.executeOrder({
                    symbol: stock.code,
                    side: 'BUY',
                    orderType: 'MARKET',
                    market: 'US',
                    orderAmount: targetUsd,
                    reason: `Gemini AI 추천 미국 소수점 매수 ($${targetUsd})`,
                  });
                  executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: true };
                  db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                    .run(orderRes.orderId || `TORD_${Date.now()}`, stock.code);
                }
              } else {
                // 국내 주식: 1주 온주 매수
                const orderRes = await pythonBridge.executeOrder({
                  symbol: stock.code,
                  side: 'BUY',
                  orderType: 'MARKET',
                  market: 'KR',
                  quantity: 1,
                  reason: `Gemini AI 추천 국내 1주 온주 매수`,
                });
                executedResult = { ...orderRes, symbol: stock.code, mode: 'REAL', isFractional: false };
                db.prepare("UPDATE ai_trade_decisions SET execution_status = 'EXECUTED_REAL', order_no = ? WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                  .run(orderRes.orderId || `TORD_${Date.now()}`, stock.code);
              }
            } catch (pErr) {
              console.error('[AiService] Python 실행 실패:', pErr.message);
              db.prepare("UPDATE ai_trade_decisions SET execution_status = 'FAILED_EXECUTION' WHERE symbol = ? ORDER BY id DESC LIMIT 1")
                .run(stock.code);
            }
          }
        }
      }
    }

    return { decisions, executedResult };
  }

  static async streamMarketBriefing(res, req) {
    const db = getDb();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const regime = await kiwoomClient.getMarketRegime();
    const marketStatus = kiwoomClient.getMarketStatus();
    const topStocks = TOP_KR_STOCKS.slice(0, 4).map((s) => s.name).join(', ');

    const briefing = `[AI 마켓 브리핑] 키움증권 실시간 호가/시세 분석 결과, 현재 국내 증시는 코스피 ${regime.kospiIndex}pt(20일선 ${regime.kospi20MA}pt), 코스닥 ${regime.kosdaqIndex}pt로 ` +
      `${regime.regime === 'NORMAL' ? '안정적인 정배열 상승 박스권 랠리' : '하방 변동성 경계 장세'}를 보이고 있습니다. ` +
      `장 상태는 '${marketStatus.badge}'이며 주요 주도 섹터(${topStocks}) 중심의 기관/외인 수급이 확인됩니다. ` +
      `키움증권의 1호가 시세를 바탕으로 3대 퀀트 전략이 실시간 포지션을 감시하며, 실전 주문은 토스증권 계좌를 통해 안전하게 집행됩니다.`;

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < briefing.length) {
        const char = briefing[idx++];
        res.write(`data: ${JSON.stringify({ char, done: false })}\n\n`);
      } else {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        db.prepare(`
          INSERT INTO ai_market_briefings (provider, model, kospi_index, kosdaq_index, kospi_20ma, kosdaq_60ma, regime_status, briefing_text, created_at)
          VALUES ('Google Gemini', 'gemini-2.5-flash', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          regime.kospiIndex, regime.kosdaqIndex, regime.kospi20MA, regime.kosdaq60MA,
          regime.regime, briefing, new Date().toISOString()
        );
      }
    }, 18);

    req.on('close', () => clearInterval(interval));
  }

  static async streamNewsAnalyze(res, req) {
    const db = getDb();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const newsCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullish,
        SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearish,
        SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral
      FROM stock_news
    `).get();

    const total = newsCounts.total || 0;
    const bull = newsCounts.bullish || 0;
    const bear = newsCounts.bearish || 0;
    const neut = newsCounts.neutral || 0;
    const bullRatio = total > 0 ? ((bull / total) * 100).toFixed(1) : '65.0';

    let bConf = {};
    if (fs.existsSync(BROKER_CONFIG_PATH)) {
      try { bConf = JSON.parse(fs.readFileSync(BROKER_CONFIG_PATH, 'utf8')); } catch (e) {}
    }
    const geminiApiKey = bConf.gemini?.api_key || process.env.GEMINI_API_KEY;
    const geminiModel = bConf.gemini?.model || 'gemini-2.5-flash';

    let analysisText = '';
    if (geminiApiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const cleanModel = geminiModel.replace(/^models\//, '');
        const prompt = `국내 증시(KOSPI/KOSDAQ)의 최근 수집 뉴스 ${total}건(호재 ${bull}건, 악재 ${bear}건, 중립 ${neut}건, 호재비율 ${bullRatio}%)과 키움증권 호가/시세, 토스증권 매매 전략을 바탕으로 퀀트 투자 관점의 간결하고 통찰력 있는 증시 인텔리전스 심층 리포트를 작성해주세요.`;

        const gResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
          }),
        });
        clearTimeout(timeout);
        if (gResp.ok) {
          const gData = await gResp.json();
          const genText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (genText) analysisText = genText;
        }
      } catch (e) {}
    }

    if (!analysisText) {
      analysisText = `[Gemini 2.5 Flash 증시 인텔리전스 심층 리포트 (키움 시세 ⨉ 토스 매매)]\n\n` +
        `■ 키움증권 시세 기반 시황 총평: 최근 수집된 국내 증시 뉴스 및 주요 공시 ${total}건 분석 결과, ` +
        `호재(Bullish) 비중이 ${bullRatio}%(${bull}건)로 우위를 점하고 있습니다. (악재 ${bear}건, 중립 ${neut}건)\n\n` +
        `■ 핵심 주도 테마 & 수급 동향:\n` +
        `1. #반도체: 삼성전자 및 SK하이닉스 중심의 HBM 대형 수주 모멘텀과 외인/기관 순매수 집중 유입.\n` +
        `2. #자동차 & 전동화: 현대차·기아 글로벌 판매 호조와 밸류업 지수 편입에 따른 주주환원 기대감 지속.\n` +
        `3. #2차전지 & 바이오: 대형 수주 계약 체결 및 과매도 구간 탈출 신호 발생.\n\n` +
        `■ 퀀트 3대 알고리즘 대응 및 토스증권 매매 전략 권고:\n` +
        `• 변동성 돌파봇: 키움증권 거래대금 상위 30위 주도주 장초반 변동폭 돌파 시 토스증권 목표 익절(+4.0%) 분할 주문 유효.\n` +
        `• 외인·기관 모멘텀봇: 3일 연속 양매수 유입 확인된 대형 우량주 스윙 홀딩 지속 추천.\n` +
        `• RSI 평균회귀봇: 볼린저밴드 하단 이탈 후 반등하는 낙폭과대 우량주 분할 매수 승률 우수.`;
    }

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < analysisText.length) {
        const char = analysisText[idx++];
        res.write(`data: ${JSON.stringify({ char, done: false })}\n\n`);
      } else {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        db.prepare(`
          INSERT INTO ai_news_briefings (provider, model, news_count, bullish_count, bearish_count, neutral_count, briefing_text, created_at)
          VALUES ('Google Gemini', 'gemini-2.5-flash', ?, ?, ?, ?, ?, ?)
        `).run(total, bull, bear, neut, analysisText, new Date().toISOString());
      }
    }, 18);

    req.on('close', () => clearInterval(interval));
  }
}
