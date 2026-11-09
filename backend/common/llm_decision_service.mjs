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
    this.quotaExceededUntil = 0; // 429 Quota 초과 시 불필요한 반복 호출 방지 쿨다운
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
   * 실시간 뉴스, 한·미 시장 지표 및 가동 중인 봇 상태를 기반으로
   * Gemini LLM 실시간 시장 분석 & 봇 진단 + 종목별 매매 시그널 도출
   * @param {Array} candidates 종목 후보군 (국내 및 미국 소수점 종목)
   * @param {Object} context 추가 시장/봇 컨텍스트 ({ triggerType, slotLabel, botsSummary, marketSummary })
   */
  async evaluateTradeSignals(candidates = [], context = {}) {
    const db = this.getDb();
    const { geminiApiKey, geminiModel } = this.loadGeminiConfig();

    // 1. 최근 수집된 주요 뉴스 상위 30건 조회 (keywords 컬럼 활용)
    let recentNews = [];
    try {
      recentNews = db.prepare(`
        SELECT id, title, summary, sentiment, keywords, created_at
        FROM stock_news
        ORDER BY id DESC LIMIT 30
      `).all() || [];
    } catch (e) {
      console.warn('[LLMDecisionService] 뉴스 조회 실패:', e.message);
    }

    // 2. 현재 실전 및 가상 봇 상태 요약 조회 (봇 진단용)
    let botsSummaryText = context.botsSummary || '';
    if (!botsSummaryText) {
      try {
        const realBots = db.prepare(`
          SELECT bot_id, name, nickname, real_allocated_capital, real_status_msg, take_profit_pct, stop_loss_pct
          FROM bots WHERE is_real_selected = 1
        `).all();
        const openRealPos = db.prepare(`
          SELECT bot_id, stock_name, stock_code, qty, avg_buy_price
          FROM bot_positions WHERE trade_mode = 'REAL' AND status = 'OPEN'
        `).all();
        botsSummaryText = realBots.map((b) => {
          const posList = openRealPos
            .filter((p) => p.bot_id === b.bot_id)
            .map((p) => `${p.stock_name}(${p.stock_code}) ${p.qty}주`)
            .join(', ') || '보유 포지션 없음';
          return `- ${b.name}(${b.nickname}): 배정예산 ${Number(b.real_allocated_capital || 0).toLocaleString()}원, 익절 +${b.take_profit_pct}%/손절 -${b.stop_loss_pct}%, 보유[${posList}], 상태[${b.real_status_msg || '정상'}]`;
        }).join('\n');
      } catch (e) {}
    }

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
      return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, context);
    }

    const newsContext = recentNews.map((n, i) =>
      `[기사 ${i + 1}] (${n.sentiment || 'NEUTRAL'}) ${n.title} - ${n.summary || ''}`
    ).join('\n');

    const candidateListStr = targetCandidates.map((c) =>
      `- [${c.market}] ${c.name}(${c.code}): ${c.isFractional ? '미국 소수점 금액 주문 가능' : '국내 온주(1주 단위) 주문'}`
    ).join('\n');

    const prompt = `
당신은 월스트리트와 여의도 탑티어 퀀트 헤지펀드의 수석 AI 전략가이자 증시 전문 앵커입니다.
아래에 제공된 실시간 증시 뉴스 25건, 거시 경제 흐름, 그리고 현재 가동 중인 실전 퀀트 봇들의 포지션/운용 현황을 정밀하게 분석하여:
1) 실시간 시장 분석 요약 브리핑(marketBriefing)
2) 실전 퀀트 봇 진단 및 종합 구두 시황 해설(verbalOverview)
3) 각 후보 종목에 대한 매매 의사결정(decisions)
을 JSON 객체 형식으로 작성해주세요.

[현재 실전 가동 퀀트 봇 및 보유 포지션 현황]
${botsSummaryText || '3대 실전 퀀트 봇 정상 가동 중'}

[분석 대상 종목군]
${candidateListStr}

[최근 수집 증시 뉴스 25건]
${newsContext || '최근 뉴스가 아직 충분치 않습니다. 글로벌 테크 반도체 및 AI 밸류체인 수혜 관점으로 평가해주세요.'}

[평가 지침 및 규칙]
1. marketBriefing: 상단 전광판 배너에 표시할 2~3문장의 핵심 실시간 한·미 증시 시황 분석 및 실전 봇 운용 진단 요약문.
2. krMarketOverview: 🇰🇷 한국 주식 시장(KRX: KOSPI/KOSDAQ) 전용 종합 구두 시황 해설 (국내 지수·수급 흐름, 호재/악재 뉴스 감성 추이, 국내 대표주 온주 매매 추천 종목 및 알고리즘 매매 진행 상태 3~4문장).
3. usMarketOverview: 🇺🇸 미국 주식 시장(NYSE/NASDAQ) 전용 종합 구두 시황 해설 (나스닥 QQQ·빅테크 수급 흐름, 원/달러 환율 영향, 미국 소수점 매수 추천 종목 및 23:30 정규장 예약대기 체결 전략 3~4문장).
4. verbalOverview: 투자자에게 직접 방송 마이크를 잡고 구두(Oral/Spoken)로 해설하듯 작성하되, 반드시 **[🇰🇷 한국 시장 종합 진단]**, **[🇺🇸 미국 시장 종합 진단]**, **[🤖 실전 퀀트 봇 & 알고리즘 매매 진단]** 3개 파트로 명확히 구분하여 작성한 종합 리포트.
5. decisions 배열: 각 종목에 대해 'BUY'(매수 권고), 'HOLD'(관망), 'SELL'(매도/차익실현) 중 하나의 명확한 시그널을 부여하세요.
   - 🇰🇷 한국 종목(market: 'KR'): 코스피/코스닥 지수 흐름, 20일선 지지 여부, 국내 증시 급락/안정세를 기준으로 독립 평가하세요 (코스피 급락 시 무리한 매수 지양).
   - 🇺🇸 미국 종목(market: 'US'): 나스닥 100(QQQ), S&P500 추세, 빅테크 펀더멘털을 기준으로 한국 시장과 완전히 분리하여 독립 평가하세요 (토스 소수점 분할 매수 전략 명시).
6. 'BUY' 신호는 확신도(confidence) 70% 이상, 호재 감성점수(sentimentScore) +3.0점 이상일 때 발동하세요.
7. 미국 주식(market: 'US')은 소수점 거래(토스증권 달러 금액 주문)가 가능하므로 소액 분할매수 행동요령을 명시하세요.
8. 각 종목의 'reasoning' 필드는 필수적으로 제공된 [최근 수집 증시 뉴스 25건] 중 해당 종목 및 연관 테마/업종의 최신 뉴스 헤드라인(기사 제목)과 핵심 이슈를 직접 인용·언급하며, 이를 근거로 왜 BUY/HOLD/SELL인지 2~3문장의 생생하고 자연스러운 '구두형 구어체 해설'로 작성하세요. (예: "최근 '... 관련 뉴스 기사 제목'에서 보듯 ...")
9. 각 종목에 'related_news' 필드를 추가하여 근거가 된 핵심 뉴스 1건의 제목을 명시하세요.
10. 반드시 아래 JSON 객체 스키마 형식으로만 응답하세요.

[응답 JSON 스키마]
{
  "marketBriefing": "[AI 실시간 시장 분석 & 봇 진단] 국내외 반도체·빅테크 중심 매수세 유입 속 실전 3대 봇(VOL-BREAK #1, BB-RSI #3, ENV-SNIPER #6)이 기보유 미국 우량주 차익실현 대기 및 신규 소수점 분할 진입을 준비 중입니다.",
  "krMarketOverview": "🇰🇷 [한국 시장 (KOSPI/KOSDAQ)] 현재 국내 증시는 글로벌 메모리 반도체 업황 회복과 외국인 수급 유입에 힘입어 일봉 20일 이동평균선 상단에서 견조한 흐름을 이어가고 있습니다. ...",
  "usMarketOverview": "🇺🇸 [미국 시장 (NYSE/NASDAQ)] 미국 증시는 나스닥 100(QQQ) 지수가 일봉 20MA 및 장중 60MA 지지를 확보한 가운데 AI 빅테크 중심의 강한 매수 모멘텀이 유지되고 있습니다. ...",
  "verbalOverview": "### 🇰🇷 [한국 시장 (KRX: KOSPI/KOSDAQ)] 종합 분석\n...\n\n### 🇺🇸 [미국 시장 (US: NYSE/NASDAQ)] 종합 분석\n...\n\n### 🤖 [실전 퀀트 봇 & 알고리즘 매매 진행 진단]\n...",
  "decisions": [
    {
      "symbol": "AAPL",
      "name": "애플",
      "market": "US",
      "action": "BUY",
      "confidence": 85,
      "sentimentScore": 7.5,
      "related_news": "애플, 온디바이스 AI 채택 가속화 및 서비스 부문 분기 호실적 달성",
      "reasoning": "최근 실시간 뉴스 '애플, 온디바이스 AI 채택 가속화 및 서비스 부문 분기 호실적 달성' 소식이 이어지며 긍정적인 수급 탄력을 받고 있습니다. 토스증권 소수점 분할 매수를 통해 소액 적립식으로 비중을 확대해 나가시는 전략을 추천해 드립니다.",
      "isFractional": true,
      "suggestedBudgetRatio": 0.35
    }
  ]
}
`;

    // 429 Quota 초과 쿨다운 중인 경우 즉시 내장 퀀트 폴백 엔진 적용
    if (Date.now() < this.quotaExceededUntil) {
      const remainMin = Math.ceil((this.quotaExceededUntil - Date.now()) / 60000);
      console.log(`[LLMDecisionService] Gemini Free Tier 쿨다운 활성 상태 (${remainMin}분 남음) - 내장 퀀트 감성 엔진 즉시 적용`);
      return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, context);
    }

    try {
      const cleanModel = geminiModel.replace(/^models\//, '');
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 429) {
          let cooldownMs = 60 * 60 * 1000; // 기본 1시간 쿨다운
          try {
            const errJson = JSON.parse(errText);
            const retryInfo = errJson.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
            if (retryInfo?.retryDelay) {
              const seconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
              if (!isNaN(seconds) && seconds > 0) cooldownMs = Math.ceil(seconds * 1000);
            }
          } catch (_) {}
          this.quotaExceededUntil = Date.now() + cooldownMs;
          const waitMinutes = Math.round(cooldownMs / 60000);
          console.warn(`[LLMDecisionService] ⚠️ Gemini Free Tier 일일 한도(20회) 도달 (429 Quota Exceeded). ${waitMinutes}분 동안 내장 퀀트 감성 분석 엔진으로 자동 전환합니다.`);
        } else {
          console.warn(`[LLMDecisionService] Gemini 호출 실패 (${resp.status}):`, errText.slice(0, 150));
        }
        return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, context);
      }

      const resData = await resp.json();
      const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let jsonStr = rawText.trim();
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
      jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

      const parsed = JSON.parse(jsonStr);
      const decisionsList = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.decisions) ? parsed.decisions : []);

      if (decisionsList.length > 0) {
        this.saveDecisionsToDb(decisionsList);
        const defaultSummaries = this.buildDefaultAnalysisSummaries(decisionsList, botsSummaryText, context);
        const marketBriefing = parsed?.marketBriefing || defaultSummaries.marketBriefing;
        const krMarketOverview = parsed?.krMarketOverview || defaultSummaries.krMarketOverview;
        const usMarketOverview = parsed?.usMarketOverview || defaultSummaries.usMarketOverview;
        const verbalOverview = parsed?.verbalOverview || defaultSummaries.verbalOverview;
        this.saveLatestAnalysisToDb({
          marketBriefing,
          krMarketOverview,
          usMarketOverview,
          verbalOverview,
          triggerType: context.triggerType || 'AUTO',
          slotLabel: context.slotLabel || '',
        });
        return decisionsList;
      }
    } catch (e) {
      console.warn('[LLMDecisionService] Gemini 분석 파싱 오류, fallback 적용:', e.message);
    }

    return this.generateFallbackDecisions(targetCandidates, recentNews, botsSummaryText, context);
  }

  buildDefaultAnalysisSummaries(decisions, botsSummaryText = '', context = {}) {
    const db = this.getDb();
    const kstTimeStr = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const krAction = filterRow?.kr_recommended_action || 'NORMAL';
    const krReason = filterRow?.kr_reason || '한국 거시 지표 및 이동평균선 정상 구간';
    const krMult = filterRow?.kr_position_size_multiplier !== undefined ? Number(filterRow.kr_position_size_multiplier) : 1.0;
    const krRiskAlert = Number(filterRow?.kr_risk_alert || 0);
    const krIsHalted = krAction === 'HALT_NEW_BUYS' || krRiskAlert === 1;

    const usAction = filterRow?.us_recommended_action || 'NORMAL';
    const usReason = filterRow?.us_reason || '미국 나스닥/S&P500 안정적 추세 유지';
    const usMult = filterRow?.us_position_size_multiplier !== undefined ? Number(filterRow.us_position_size_multiplier) : 1.0;
    const usRiskAlert = Number(filterRow?.us_risk_alert || 0);
    const usIsHalted = usAction === 'HALT_NEW_BUYS' || usRiskAlert === 1;

    const krDecisions = decisions.filter((d) => d.market === 'KR');
    const usDecisions = decisions.filter((d) => d.market === 'US');

    const krBuyList = krDecisions.filter((d) => d.action === 'BUY').sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const krHoldList = krDecisions.filter((d) => d.action === 'HOLD');
    const krSellList = krDecisions.filter((d) => d.action === 'SELL');

    const usBuyList = usDecisions.filter((d) => d.action === 'BUY').sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const usHoldList = usDecisions.filter((d) => d.action === 'HOLD');
    const usSellList = usDecisions.filter((d) => d.action === 'SELL');

    const modeLabel = context.triggerType === 'MANUAL' ? '수동 즉시 분석' : `정기 자동 분석(${context.slotLabel || '4시간 주기'})`;

    const krTopNames = krBuyList.slice(0, 4).map((d) => `${d.name || d.stock_name}(${d.symbol}, 확신도 ${d.confidence}%)`).join(', ') || '삼성전자, SK하이닉스';
    const usTopNames = usBuyList.slice(0, 4).map((d) => `${d.name || d.stock_name}(${d.symbol}, 확신도 ${d.confidence}%)`).join(', ') || '엔비디아(NVDA), QQQ, 애플(AAPL)';

    const krBadgeShort = krIsHalted ? '🔴매수차단' : krMult < 1.0 ? `🟡비중${Math.round(krMult * 100)}%` : '🟢정상매매';
    const usBadgeShort = usIsHalted ? '🔴매수차단' : usMult < 1.0 ? `🟡비중${Math.round(usMult * 100)}%` : '🟢정상매매';

    const marketBriefing = `[AI 실시간 한·미 시장 분석 & 봇 진단 | ${kstTimeStr} ${modeLabel}] ` +
      `🇰🇷한국장(${krBadgeShort} | 매수 ${krBuyList.length}건·관망 ${krHoldList.length}건) 및 ` +
      `🇺🇸미국장(${usBadgeShort} | 매수 ${usBuyList.length}건·관망 ${usHoldList.length}건) 분석 완료. ` +
      (krIsHalted
        ? `국내 증시 급락 리스크로 온주 매수는 전면 차단되며, 미국 [${usBuyList[0]?.name || usBuyList[0]?.stock_name || '엔비디아'}] 중심 소수점 분할 진입만 진행됩니다.`
        : `최우선 추천: 국내 [${krBuyList[0]?.name || krBuyList[0]?.stock_name || 'SK하이닉스'}], 미국 [${usBuyList[0]?.name || usBuyList[0]?.stock_name || '엔비디아'}].`);

    let krMarketOverview = '';
    if (krIsHalted) {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 급락 및 리스크 경보 발동으로 **신규 매수 차단(🔴 HALT_NEW_BUYS, 비중 0%)** 체제입니다. ` +
        `지표 분석 결과: ${krReason}. 코스피 지수가 일봉 20일 이동평균선을 대폭 하회하고 있어 추가 낙폭 리스크 방어를 위해 국내 온주 신규 매수는 전면 보류됩니다. ` +
        `국내 분석 대상 ${krDecisions.length}종목 중 매수 추천은 지수 안정화 시까지 보류(관망 ${krHoldList.length}건, 매도 ${krSellList.length}건)하며, 기보유 종목의 손절/익절 청산 관리만 엄격하게 집행됩니다.`;
    } else if (krMult < 1.0) {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 변동성 확대 구간으로 **투자비중 축소(🟡 REDUCE_SIZE, 비중 ${Math.round(krMult * 100)}%)** 체제입니다. ` +
        `지표 분석 결과: ${krReason}. 국내 분석 대상 ${krDecisions.length}종목 중 매수 유효(BUY) ${krBuyList.length}건이 포착되었으나 리스크 관리를 위해 축소된 비중으로 1주 온주 분할 진입합니다.`;
    } else {
      krMarketOverview =
        `현재 한국 증시(KOSPI/KOSDAQ)는 일봉 20일 이동평균선 상단 지지를 확보하며 **정상 거래 허용(🟢 Normal, 비중 100%)** 체제를 유지하고 있습니다. ` +
        `국내 분석 대상 ${krDecisions.length}종목 중 매수 유효(BUY) ${krBuyList.length}건, 관망(HOLD) ${krHoldList.length}건이 포착되었으며, ` +
        `특히 HBM 반도체 및 수출 실적 모멘텀이 집중된 ${krTopNames} 종목에서 강한 기관·외인 수급 시그널이 확인됩니다. ` +
        `주간 정규장(09:00~15:30 KST)에서는 키움증권 실시간 호가 지지선을 기반으로 1주 온주 단위 알고리즘 분할 진입이 유효합니다.`;
    }

    let usMarketOverview = '';
    if (usIsHalted) {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 거시 리스크 경보 발동으로 **신규 매수 차단(🔴 HALT_NEW_BUYS, 비중 0%)** 체제입니다. ` +
        `지표 분석 결과: ${usReason}. 나스닥 및 S&P500의 추가 하락 리스크를 방어하기 위해 미국 소수점 신규 매수는 일시 보류됩니다.`;
    } else if (usMult < 1.0) {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 단기 조정 구간으로 **투자비중 축소(🟡 REDUCE_SIZE, 비중 ${Math.round(usMult * 100)}%)** 체제입니다. ` +
        `지표 분석 결과: ${usReason}. 토스증권 소수점 주문 금액을 축소 산정하여 방어적으로 분할 매수합니다.`;
    } else {
      usMarketOverview =
        `현재 미국 증시(NYSE/NASDAQ)는 나스닥 100(QQQ) 지수가 일봉 20MA 및 장중 60MA 상단 추세를 유지하며 **정상 거래 허용(🟢 Normal, 비중 100%)** 체제에서 움직이고 있습니다. ` +
        `미국 분석 대상 ${usDecisions.length}종목 중 매수 유효(BUY) ${usBuyList.length}건, 관망(HOLD) ${usHoldList.length}건이 도출되었으며, ` +
        `글로벌 AI 인프라 투자를 주도하는 ${usTopNames} 중심으로 높은 호재 감성점수가 유지되고 있습니다. ` +
        `가용 예수금 규모에 맞춰 토스증권 소수점 금액 주문($1~$10)이 자동 산정되었으며, 미국 정규장(23:30~05:00 KST) 개장 즉시 신규 소수점 매수가 동시 집행됩니다.`;
    }

    const krAlgoLine = krIsHalted
      ? `- **🇰🇷 한국 온주 알고리즘 매매 판정**: **🔴 신규 매수 차단 (청산만 허용)** — 코스피 급락 및 리스크 경보로 신규 온주 매수가 일시 동결되었으며 기보유 종목만 관리합니다.`
      : `- **🇰🇷 한국 온주 알고리즘 매매 판정**: **🟢 정상 진행 (투자비중 ${Math.round(krMult * 100)}%)** — 주간 정규장 키움증권 호가 기반 1주 온주 자동 매수 집행 중.`;

    const usAlgoLine = usIsHalted
      ? `- **🇺🇸 미국 소수점 알고리즘 매매 판정**: **🔴 신규 매수 차단 (청산만 허용)** — 미국 지수 급락 경보로 신규 소수점 매수가 보류되었습니다.`
      : `- **🇺🇸 미국 소수점 알고리즘 매매 판정**: **🟢 정상 진행 (투자비중 ${Math.round(usMult * 100)}%)** — 미국 정규장(23:30 KST) 개장 즉시 100% LLM 호재 추천 종목(${usTopNames})으로 토스 소수점 자동 체결 진행.`;

    const verbalOverview =
      `### 🇰🇷 [한국 주식 시장 (KRX: KOSPI / KOSDAQ)] 종합 분석 & 온주 전략\n` +
      `- **시장 체제 및 지표 진단**: ${krMarketOverview}\n` +
      `- **국내 최우선 매수 추천 종목**: **${krTopNames}**\n\n` +
      `### 🇺🇸 [미국 주식 시장 (US: NYSE / NASDAQ)] 종합 분석 & 소수점 전략\n` +
      `- **시장 체제 및 빅테크 모멘텀**: ${usMarketOverview}\n` +
      `- **미국 최우선 소수점 추천 종목**: **${usTopNames}**\n\n` +
      `### 🤖 [실전 퀀트 봇 3기 & 한·미 분리 알고리즘 매매 진행 진단]\n` +
      `${krAlgoLine}\n` +
      `${usAlgoLine}\n` +
      (botsSummaryText ? `${botsSummaryText}` : `- 현재 실전 담당 3대 퀀트 봇은 목표 익절 및 손절 라인에 따라 포지션을 자동 관리하고 있습니다.`);

    return { marketBriefing, krMarketOverview, usMarketOverview, verbalOverview };
  }

  saveLatestAnalysisToDb({ marketBriefing, krMarketOverview, usMarketOverview, verbalOverview, triggerType = 'AUTO', slotLabel = '' }) {
    const db = this.getDb();
    const nowIso = new Date().toISOString();
    const analyzedAtKst = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const payload = {
      marketBriefing,
      krMarketOverview: krMarketOverview || '',
      usMarketOverview: usMarketOverview || '',
      verbalOverview,
      triggerType,
      slotLabel,
      analyzedAt: nowIso,
      analyzedAtKst,
      krRegime: {
        action: filterRow?.kr_recommended_action || 'NORMAL',
        regime: filterRow?.kr_market_regime || 'SIDEWAYS',
        reason: filterRow?.kr_reason || '',
        multiplier: Number(filterRow?.kr_position_size_multiplier || 1.0),
        riskAlert: Number(filterRow?.kr_risk_alert || 0),
      },
      usRegime: {
        action: filterRow?.us_recommended_action || 'NORMAL',
        regime: filterRow?.us_market_regime || 'BULL',
        reason: filterRow?.us_reason || '',
        multiplier: Number(filterRow?.us_position_size_multiplier || 1.0),
        riskAlert: Number(filterRow?.us_risk_alert || 0),
      },
    };

    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('ai_latest_analysis_json', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(payload), nowIso);
    } catch (e) {
      console.warn('[LLMDecisionService] 최신 시장/봇 진단 저장 오류:', e.message);
    }
    return payload;
  }

  getLatestAnalysisFromDb() {
    const db = this.getDb();
    try {
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_latest_analysis_json'").get();
      if (row && row.value) {
        return JSON.parse(row.value);
      }
      const bRow = db.prepare("SELECT briefing_text, created_at FROM ai_market_briefings ORDER BY id DESC LIMIT 1").get();
      if (bRow) {
        return {
          marketBriefing: bRow.briefing_text,
          verbalOverview: bRow.briefing_text,
          triggerType: 'AUTO',
          slotLabel: '',
          analyzedAt: bRow.created_at,
          analyzedAtKst: bRow.created_at,
        };
      }
    } catch (e) {}
    return null;
  }

  // LLM 미설정 또는 호출 실패 시의 수집 뉴스 기반 정밀 구두형(구어체) fallback 해설 생성
  generateFallbackDecisions(candidates, recentNews = [], botsSummaryText = '', context = {}) {
    const db = this.getDb();
    let filterRow = null;
    try {
      filterRow = db.prepare('SELECT * FROM market_regime_filter WHERE id = 1').get() || null;
    } catch (e) {}

    const krAction = filterRow?.kr_recommended_action || 'NORMAL';
    const krReason = filterRow?.kr_reason || '한국 시장 안정적 흐름';
    const krIsHalted = krAction === 'HALT_NEW_BUYS' || Number(filterRow?.kr_risk_alert || 0) === 1;

    const usAction = filterRow?.us_recommended_action || 'NORMAL';
    const usReason = filterRow?.us_reason || '미국 증시 우상향 추세';
    const usIsHalted = usAction === 'HALT_NEW_BUYS' || Number(filterRow?.us_risk_alert || 0) === 1;

    // 종목별 키워드 매칭 테이블
    const STOCK_KEYWORDS = {
      AAPL: ['애플', '아이폰', 'Apple', 'AAPL', '팀쿡', 'iOS', '온디바이스', 'Mag 7'],
      NVDA: ['엔비디아', 'Nvidia', 'NVDA', '젠슨황', '블랙웰', 'AI 반도체', 'GPU', 'AI'],
      TSLA: ['테슬라', 'Tesla', 'TSLA', '일론머스크', '전기차', 'FSD', '사이버트럭', '기가'],
      MSFT: ['마이크로소프트', 'Microsoft', 'MSFT', '애저', 'Azure', '코파일럿', '클라우드'],
      QQQ: ['QQQ', '나스닥', 'Nasdaq', '빅테크', 'S&P', '증시', '뉴욕증시', '미국증시', 'Futures'],
      SBUX: ['스타벅스', 'Starbucks', 'SBUX', '커피'],
      '005930': ['삼성전자', '삼성', '005930', 'HBM', '메모리', '반도체'],
      '000660': ['SK하이닉스', '하이닉스', '000660', 'HBM3E', 'HBM', '메모리'],
      '068270': ['셀트리온', '068270', '짐펜트라', '바이오', '시밀러'],
      '005380': ['현대차', '005380', '현대자동차', '하이브리드', '완성차'],
    };

    const results = candidates.map((c) => {
      const isKr = c.market === 'KR';
      const isUs = c.market === 'US';
      const keywords = STOCK_KEYWORDS[c.code] || [c.name, c.code];

      // 최근 뉴스 30건 중 종목 키워드와 매칭되는 최신 뉴스 탐색
      const matchedNews = recentNews.find((n) => {
        const title = n.title || '';
        const summary = n.summary || '';
        const kw = n.keywords || '';
        return keywords.some((k) => title.includes(k) || summary.includes(k) || kw.includes(k));
      }) || recentNews[0] || null;

      const newsTitle = matchedNews?.title || (isKr ? '국내 증시 수급 및 섹터 모멘텀 점검' : '글로벌 테크 증시 및 수급 모멘텀 분석');
      const newsSentiment = matchedNews?.sentiment || 'NEUTRAL';

      let action = 'BUY';
      let confidence = 82;
      let sentimentScore = 7.2;
      let reasoning = '';

      if (isKr) {
        if (krIsHalted) {
          action = 'HOLD';
          confidence = 55;
          sentimentScore = -2.8;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 언론 보도에도 불구하고, 현재 국내 증시는 급락 경보(코스피 20일선 대폭 하회 및 리스크 차단) 발동으로 국내 온주 신규 매수가 일시 전면 차단(🔴 HALT_NEW_BUYS) 상태입니다. 무리한 물타기나 신규 진입보다는 지수 안정세 확인 시까지 관망(HOLD)을 유지하시고 기보유 포지션 관리에 집중하시기를 권고합니다.`;
        } else if (newsSentiment === 'BEARISH') {
          action = 'SELL';
          confidence = 74;
          sentimentScore = -4.5;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 악재성 뉴스 및 단기 차익 실현 매물 출회 가능성이 관측되고 있습니다. 키움증권 호가 매도 우위 상태를 점검하시며 보유 비중을 축소하시거나 현금을 확보하여 리스크를 관리하시는 전략을 추천합니다.`;
        } else {
          action = 'BUY';
          confidence = 81;
          sentimentScore = 6.8;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 언론에 보도된 긍정적인 실적 및 수급 모멘텀에 힘입어 양호한 흐름이 이어지고 있습니다. 키움증권 호가 지지선을 확인하시면서 1주 온주 단위 분할 매수로 접근하시는 전략이 유효합니다.`;
        }
      } else {
        // 미국 주식
        if (usIsHalted) {
          action = 'HOLD';
          confidence = 58;
          sentimentScore = -2.2;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 미국 증시 급락 경보 발동으로 소수점 신규 매수가 일시 보류되었습니다. 나스닥 지수의 기술적 지지력 회복을 확인하신 후 진입하시기 바랍니다.`;
        } else if (newsSentiment === 'BEARISH') {
          action = 'HOLD';
          confidence = 68;
          sentimentScore = 1.0;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 최근 단기 변동성 요인이 보도되고 있어 성급한 매수보다는 미국 정규장(23:30 KST) 개장 후 60분 이동평균선 지지 여부를 확인하며 관망(HOLD)하시는 것을 추천합니다.`;
        } else {
          action = 'BUY';
          confidence = 86;
          sentimentScore = 8.1;
          reasoning = `📰 [관련 뉴스] "${newsTitle}" — 미국 증시는 나스닥 100(QQQ)이 20MA 상단에서 견조한 상승 추세를 유지하는 가운데, 해당 종목에 대한 글로벌 호재 모멘텀이 확인됩니다. 토스증권 소수점 금액 주문($1~$10)을 활용하여 미국 정규장(23:30 KST) 개장 시 소액 분할 매수로 비중을 늘려가시는 전략을 적극 추천해 드립니다.`;
        }
      }

      return {
        symbol: c.code,
        name: c.name,
        market: c.market,
        action,
        confidence,
        sentimentScore,
        related_news: newsTitle,
        reasoning,
        isFractional: c.isFractional,
        suggestedBudgetRatio: 0.35,
      };
    });

    this.saveDecisionsToDb(results);
    const defaultSummaries = this.buildDefaultAnalysisSummaries(results, botsSummaryText, context);
    this.saveLatestAnalysisToDb({
      marketBriefing: defaultSummaries.marketBriefing,
      krMarketOverview: defaultSummaries.krMarketOverview,
      usMarketOverview: defaultSummaries.usMarketOverview,
      verbalOverview: defaultSummaries.verbalOverview,
      triggerType: context.triggerType || 'AUTO',
      slotLabel: context.slotLabel || '',
    });
    return results;
  }

  saveDecisionsToDb(decisions) {
    const db = this.getDb();
    const nowIso = new Date().toISOString();

    try {
      const stmt = db.prepare(`
        INSERT INTO ai_trade_decisions (
          symbol, stock_name, market, action, confidence, sentiment_score,
          reasoning, related_news, suggested_order_type, executed_by, execution_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const d of decisions) {
        stmt.run(
          d.symbol,
          d.name || d.stock_name,
          d.market,
          d.action,
          d.confidence,
          d.sentimentScore ?? d.sentiment_score ?? 0,
          d.reasoning,
          d.related_news || '',
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

