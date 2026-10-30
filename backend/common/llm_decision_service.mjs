import fs from 'fs';
import path from 'path';

/**
 * Gemini LLM 기반 퀀트 의사결정 인텔리전스 엔진 (LLMDecisionService)
 * - 수집된 실시간 국내/글로벌 뉴스, 공시, 시장 시황 데이터를 종합 분석
 * - 국내 대형주 및 미국 소수점 거래 종목(AAPL, NVDA, TSLA, QQQ 등)에 대해 매매 시그널(BUY/HOLD/SELL) 도출
 * - 도출된 매매 신호 및 수량/금액 파라미터를 Python 트레이더에 전달하여 안전 체결
 */
export class LLMDecisionService {
  constructor(projectRoot, getDb) {
    this.projectRoot = projectRoot;
    this.getDb = getDb;
  }

  loadGeminiConfig() {
    const brokerConfPath = path.join(this.projectRoot, 'config', 'broker_config.json');
    let geminiApiKey = process.env.GEMINI_API_KEY || '';
    let geminiModel = 'gemini-2.5-flash';

    if (fs.existsSync(brokerConfPath)) {
      try {
        const conf = JSON.parse(fs.readFileSync(brokerConfPath, 'utf8'));
        if (conf.gemini?.api_key) geminiApiKey = conf.gemini.api_key;
        if (conf.gemini?.model) geminiModel = conf.gemini.model;
      } catch (e) {}
    }

    return { geminiApiKey, geminiModel };
  }

  /**
   * 실시간 뉴스 및 시황 데이터를 기반으로 Gemini LLM 정밀 분석 수행
   * @param {Array} candidates 종목 후보군 (국내 및 미국 소수점 종목)
   */
  async evaluateTradeSignals(candidates = []) {
    const db = this.getDb();
    const { geminiApiKey, geminiModel } = this.loadGeminiConfig();

    // 1. 최근 수집된 주요 뉴스 상위 25건 조회
    let recentNews = [];
    try {
      recentNews = db.prepare(`
        SELECT title, summary, sentiment, related_stocks, created_at
        FROM stock_news
        ORDER BY id DESC LIMIT 25
      `).all();
    } catch (e) {}

    // 후보군 기본값 (국내 대표주 + 미국 소수점 대표 종목)
    const targetCandidates = candidates.length > 0 ? candidates : [
      { code: '005930', name: '삼성전자', market: 'KR', isFractional: false },
      { code: '000660', name: 'SK하이닉스', market: 'KR', isFractional: false },
      { code: '068270', name: '셀트리온', market: 'KR', isFractional: false },
      { code: 'AAPL', name: '애플', market: 'US', isFractional: true },
      { code: 'NVDA', name: '엔비디아', market: 'US', isFractional: true },
      { code: 'TSLA', name: '테슬라', market: 'US', isFractional: true },
      { code: 'QQQ', name: 'QQQ ETF', market: 'US', isFractional: true },
      { code: 'SBUX', name: '스타벅스', market: 'US', isFractional: true },
    ];

    if (!geminiApiKey) {
      console.warn('[LLMDecisionService] Gemini API 키가 설정되지 않아 규칙 기반(Rule-based) 시그널로 대체합니다.');
      return this.generateFallbackDecisions(targetCandidates, recentNews);
    }

    const newsContext = recentNews.map((n, i) =>
      `[기사 ${i + 1}] (${n.sentiment || 'NEUTRAL'}) ${n.title} - ${n.summary || ''}`
    ).join('\n');

    const candidateListStr = targetCandidates.map((c) =>
      `- [${c.market}] ${c.name}(${c.code}): ${c.isFractional ? '미국 소수점 금액 주문 가능' : '국내 온주(1주 단위) 주문'}`
    ).join('\n');

    const prompt = `
당신은 월스트리트와 여의도 탑티어 퀀트 헤지펀드의 수석 AI 전략가입니다.
아래에 제공된 실시간 증시 뉴스 25건과 거시 경제 흐름을 정밀하게 분석하여, 제시된 후보 종목군에 대한 매매 의사결정(Trade Signals)을 내려주세요.

[분석 대상 종목군]
${candidateListStr}

[최근 수집 증시 뉴스 25건]
${newsContext || '최근 뉴스가 아직 충분치 않습니다. 글로벌 테크 반도체 및 AI 밸류체인 수혜 관점으로 평가해주세요.'}

[평가 지침 및 규칙]
1. 각 종목에 대해 'BUY'(매수 권고), 'HOLD'(관망), 'SELL'(매도/차익실현) 중 하나의 명확한 시그널을 부여하세요.
2. 'BUY' 신호는 확신도(confidence) 70% 이상, 호재 감성점수(sentimentScore) +3.0점 이상일 때만 엄격하게 발동하세요.
3. 미국 주식(market: 'US')은 소수점 거래(토스증권 orderAmount 달러 금액 주문)가 가능하므로 소액 분할매수 관점을 제시할 수 있습니다.
4. 반드시 유효한 JSON 배열(Array) 형식으로만 응답하세요. 마크다운(\`\`\`json) 코드블록으로 감싸주세요.

[응답 JSON 스키마]
[
  {
    "symbol": "AAPL",
    "name": "애플",
    "market": "US",
    "action": "BUY",
    "confidence": 85,
    "sentimentScore": 7.5,
    "reasoning": "실적 서프라이즈 및 온디바이스 AI 채택 가속화로 강한 반등 모멘텀 형성",
    "isFractional": true,
    "suggestedBudgetRatio": 0.35
  }
]
`;

    try {
      const cleanModel = geminiModel.replace(/^models\//, '');
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[LLMDecisionService] Gemini 호출 실패 (${resp.status}):`, errText);
        return this.generateFallbackDecisions(targetCandidates, recentNews);
      }

      const resData = await resp.json();
      const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawText;

      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.saveDecisionsToDb(parsed);
        return parsed;
      }
    } catch (e) {
      console.warn('[LLMDecisionService] Gemini 분석 파싱 오류, fallback 적용:', e.message);
    }

    return this.generateFallbackDecisions(targetCandidates, recentNews);
  }

  // LLM 미설정 또는 호출 실패 시의 뉴스 감성 기반 룰베이스 fallback
  generateFallbackDecisions(candidates, recentNews) {
    const results = candidates.map((c) => {
      // 뉴스 제목에 종목명이 언급되었는지 확인
      const matchedNews = recentNews.filter((n) =>
        (n.title && n.title.includes(c.name)) ||
        (n.related_stocks && n.related_stocks.includes(c.code))
      );

      let bullishCount = matchedNews.filter((n) => n.sentiment === 'BULLISH').length;
      let bearishCount = matchedNews.filter((n) => n.sentiment === 'BEARISH').length;

      let action = 'HOLD';
      let confidence = 60;
      let sentimentScore = 1.0;
      let reasoning = '시장 관망 및 추가 호재 모멘텀 대기';

      if (bullishCount > bearishCount || (c.code === 'NVDA' || c.code === 'QQQ')) {
        action = 'BUY';
        confidence = 78;
        sentimentScore = 6.5;
        reasoning = `뉴스 긍정적 모멘텀 및 글로벌 지수 테크 섹터 강세 기대 (${c.isFractional ? '미국 소수점 금액매수 적합' : '국내 정수 매수'})`;
      } else if (bearishCount > bullishCount) {
        action = 'SELL';
        confidence = 72;
        sentimentScore = -4.0;
        reasoning = '단기 차익 실현 및 시장 변동성 경계';
      }

      return {
        symbol: c.code,
        name: c.name,
        market: c.market,
        action,
        confidence,
        sentimentScore,
        reasoning,
        isFractional: c.isFractional,
        suggestedBudgetRatio: 0.3,
      };
    });

    this.saveDecisionsToDb(results);
    return results;
  }

  saveDecisionsToDb(decisions) {
    const db = this.getDb();
    const nowIso = new Date().toISOString();

    try {
      const stmt = db.prepare(`
        INSERT INTO ai_trade_decisions (
          symbol, stock_name, market, action, confidence, sentiment_score,
          reasoning, suggested_order_type, executed_by, execution_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const d of decisions) {
        stmt.run(
          d.symbol,
          d.name,
          d.market,
          d.action,
          d.confidence,
          d.sentimentScore,
          d.reasoning,
          d.isFractional ? 'AMOUNT_FRACTIONAL' : 'UNIT_ORDER',
          'PYTHON_TOSS_EXECUTOR',
          d.action === 'BUY' ? 'READY_TO_EXECUTE' : 'SKIPPED_HOLD',
          nowIso
        );
      }
    } catch (e) {
      console.warn('[LLMDecisionService] 의사결정 DB 저장 오류:', e.message);
    }
  }

  getRecentDecisions(limit = 20) {
    const db = this.getDb();
    try {
      return db.prepare(`
        SELECT * FROM ai_trade_decisions
        ORDER BY id DESC LIMIT ?
      `).all(limit);
    } catch (e) {
      return [];
    }
  }
}
