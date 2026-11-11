import React, { useState } from 'react';
import { MarkdownViewer } from '../layout/MarketBanner';

function formatKstTimestamp(isoOrStr) {
  if (!isoOrStr) return '';
  const d = new Date(isoOrStr);
  if (isNaN(d.getTime())) return String(isoOrStr);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

export default function HybridBoard({
  aiDecisions,
  latestAnalysis,
  aiQuota,
  isAiEvaluating,
  onAiEvaluateAndTrade,
}) {
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  const remaining = aiQuota?.remainingManualCalls ?? 14;
  const manualLimit = aiQuota?.manualDailyLimit ?? 14;
  const nextAutoSlot = aiQuota?.nextAutoSlotLabel || '12:00';

  // 최근 분석 실행 시각 및 트리거 포맷팅 (뉴스 시황과 동일 형식)
  const analyzedAtRaw =
    latestAnalysis?.analyzedAt ||
    latestAnalysis?.analyzedAtKst ||
    latestAnalysis?.created_at ||
    latestAnalysis?.createdAt ||
    (aiDecisions && aiDecisions[0]?.created_at) ||
    (aiDecisions && aiDecisions[0]?.evaluatedAt);
  const createdAtStr = formatKstTimestamp(analyzedAtRaw);
  const triggerType = latestAnalysis?.triggerType || latestAnalysis?.trigger_type || 'AUTO';

  // 한국 시장(KR) 및 미국 시장(US) 독립 체제 및 매매 판정 상태 파악
  const krRegime = latestAnalysis?.krRegime || latestAnalysis?.llm_algo_status?.kr || {};
  const usRegime = latestAnalysis?.usRegime || latestAnalysis?.llm_algo_status?.us || {};

  const isKrHalted = krRegime.action === 'HALT_NEW_BUYS' || krRegime.statusCode === 'HALT_NEW_BUYS' || Number(krRegime.riskAlert || 0) === 1;
  const isKrReduced = !isKrHalted && (krRegime.action === 'REDUCE_SIZE' || krRegime.statusCode === 'REDUCE_SIZE' || (krRegime.multiplier > 0 && krRegime.multiplier < 1.0));

  const isUsHalted = usRegime.action === 'HALT_NEW_BUYS' || usRegime.statusCode === 'HALT_NEW_BUYS' || Number(usRegime.riskAlert || 0) === 1;
  const isUsReduced = !isUsHalted && (usRegime.action === 'REDUCE_SIZE' || usRegime.statusCode === 'REDUCE_SIZE' || (usRegime.multiplier > 0 && usRegime.multiplier < 1.0));

  const krBadgeText = isKrHalted
    ? '🔴 국내 온주 매수 차단 (청산만 허용)'
    : isKrReduced
    ? `🟡 국내 온주 매매 (비중 ${Math.round((krRegime.multiplier || 0.5) * 100)}% 축소)`
    : '🟢 국내 온주 정상 매매 (비중 100%)';

  const usBadgeText = isUsHalted
    ? '🔴 미국 소수점 매수 차단 (청산만 허용)'
    : isUsReduced
    ? `🟡 미국 소수점 매매 (비중 ${Math.round((usRegime.multiplier || 0.5) * 100)}% 축소)`
    : '🟢 미국 소수점 정상 매매 (비중 100%)';

  // 한국 시장(KR) vs 미국 시장(US) 의사결정 분리 집계
  const krDecisions = aiDecisions.filter((d) => d.market === 'KR');
  const usDecisions = aiDecisions.filter((d) => d.market === 'US');

  const krBuyList = krDecisions
    .filter((d) => d.action === 'BUY')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const krHoldList = krDecisions.filter((d) => d.action === 'HOLD');
  const krSellList = krDecisions.filter((d) => d.action === 'SELL');

  const usBuyList = usDecisions
    .filter((d) => d.action === 'BUY')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const usHoldList = usDecisions.filter((d) => d.action === 'HOLD');
  const usSellList = usDecisions.filter((d) => d.action === 'SELL');

  const krTopNames =
    krBuyList
      .slice(0, 4)
      .map((d) => `${d.stock_name || d.name}(${d.symbol}, ${d.confidence}%)`)
      .join(', ') || 'SK하이닉스, 삼성전자, 셀트리온, 현대차';

  const usTopNames =
    usBuyList
      .slice(0, 4)
      .map((d) => `${d.stock_name || d.name}(${d.symbol}, ${d.confidence}%)`)
      .join(', ') || '엔비디아(NVDA), QQQ, 애플(AAPL), 마이크로소프트(MSFT)';

  const buyCount = aiDecisions.filter((d) => d.action === 'BUY').length;
  const holdCount = aiDecisions.filter((d) => d.action === 'HOLD').length;

  const krMarketSummaryText =
    latestAnalysis?.krMarketOverview ||
    (isKrHalted
      ? `현재 한국 증시(KOSPI/KOSDAQ)는 급락 및 리스크 경보 발동으로 신규 매수 차단(🔴 HALT_NEW_BUYS) 체제입니다. 코스피 지수가 일봉 20일 이동평균선을 대폭 하회하고 있어 추가 낙폭 리스크 방어를 위해 국내 온주 신규 매수는 전면 보류되며 기보유 종목의 청산에 집중합니다.`
      : `현재 한국 증시(KOSPI/KOSDAQ)는 일봉 20일 이동평균선 상단 지지를 확보하며 정상 거래 허용(🟢 Normal) 체제를 유지하고 있습니다. 국내 분석 대상 ${krDecisions.length || 15}종목 중 매수 유효 ${krBuyList.length}건이 포착되었습니다.`);

  const usMarketSummaryText =
    latestAnalysis?.usMarketOverview ||
    (isUsHalted
      ? `현재 미국 증시(NYSE/NASDAQ)는 거시 리스크 경보 발동으로 신규 소수점 매수 차단(🔴 HALT_NEW_BUYS) 체제입니다.`
      : `현재 미국 증시(NYSE/NASDAQ)는 나스닥 100(QQQ) 지수가 일봉 20MA 및 장중 60MA 상단 추세를 유지하며 정상 거래 허용(🟢 Normal) 체제에서 움직이고 있습니다. 글로벌 AI 인프라 투자를 주도하는 ${usTopNames} 중심으로 높은 호재 감성점수가 유지되고 있습니다.`);

  const formatVerbalOverview = (rawOverview, fallbackDefault) => {
    if (!rawOverview) return fallbackDefault;
    if (typeof rawOverview === 'string') return rawOverview;
    if (typeof rawOverview === 'object') {
      const parts = [];
      const krText = rawOverview.krMarket || rawOverview.kr;
      const usText = rawOverview.usMarket || rawOverview.us;
      const botText = rawOverview.botDiagnostic || rawOverview.bot || rawOverview.bots;

      if (krText) {
        parts.push(`### 🇰🇷 [한국 주식 시장 (KRX: KOSPI / KOSDAQ)] 종합 분석 & 온주 전략\n- ${krText}`);
      }
      if (usText) {
        parts.push(`### 🇺🇸 [미국 주식 시장 (US: NYSE / NASDAQ)] 종합 분석 & 소수점 전략\n- ${usText}`);
      }
      if (botText) {
        parts.push(`### 🤖 [실전 퀀트 봇 & 알고리즘 매매 진단]\n- ${botText}`);
      }

      if (parts.length > 0) {
        return parts.join('\n\n');
      }

      const values = Object.entries(rawOverview)
        .map(([k, val]) => (typeof val === 'string' ? `- **${k}**: ${val}` : ''))
        .filter(Boolean);
      if (values.length > 0) return values.join('\n\n');
    }
    return fallbackDefault;
  };

  const defaultVerbalText =
    aiDecisions.length > 0
      ? `### 🇰🇷 [한국 주식 시장 (KRX: KOSPI / KOSDAQ)] 종합 분석 & 온주 전략\n` +
        `- ${krMarketSummaryText}\n\n` +
        `### 🇺🇸 [미국 주식 시장 (US: NYSE / NASDAQ)] 종합 분석 & 소수점 전략\n` +
        `- ${usMarketSummaryText}`
      : `실시간 수집된 최신 뉴스와 시장 수급을 바탕으로 Gemini LLM이 한국 시장과 미국 시장을 구분하여 생생한 시황 브리핑 및 봇 진단을 안내해 드립니다. 상단의 [🔄 AI 실시간 시장분석 & 봇진단]을 눌러주세요.`;

  const verbalOverviewText = formatVerbalOverview(latestAnalysis?.verbalOverview, defaultVerbalText);

  const handleSpeak = (textToSpeak) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      alert('현재 브라우저에서는 음성 합성(TTS) 기능을 지원하지 않습니다.');
      return;
    }

    if (isPlayingVoice) {
      window.speechSynthesis.cancel();
      setIsPlayingVoice(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak || verbalOverviewText);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setIsPlayingVoice(false);
    utterance.onerror = () => setIsPlayingVoice(false);

    setIsPlayingVoice(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      className="board-card"
      style={{
        background: 'linear-gradient(135deg, rgba(24, 24, 37, 0.95), rgba(15, 23, 42, 0.95))',
        borderColor: 'rgba(147, 51, 234, 0.35)',
        marginBottom: '20px',
      }}
    >
      <div className="card-title-row">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>🤖 AI 실시간 시장 분석 & 봇 진단 (Gemini LLM ⨉ Python Core Executor)</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(147, 51, 234, 0.2)',
              color: '#c084fc',
              border: '1px solid rgba(147, 51, 234, 0.4)',
            }}
          >
            자동배치: ⚡30분 Flash & 🏛️60분 Pro (다음 {nextAutoSlot})
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#93c5fd',
              border: '1px solid rgba(59, 130, 246, 0.4)',
            }}
          >
            🇰🇷 국내 온주 ⨉ 🇺🇸 미국 소수점 분리 판정
          </span>

          {/* 최근 분석 실행 시각 및 트리거 (뉴스 시황과 동일 형식) */}
          {createdAtStr && (
            <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
              ({createdAtStr} · {triggerType === 'MANUAL' ? '⚡수동분석' : '⏰자동갱신'})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: remaining > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.2)',
              color: remaining > 0 ? '#34d399' : '#f87171',
              border: remaining > 0 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.45)',
              fontWeight: 700,
            }}
            title={`일일 총 무료 한도 ${aiQuota?.dailyTotalLimit || 50}회 중 정기 자동배치 예약(${aiQuota?.autoReservedCalls || 36}회)을 제외한 금일 수동 Gemini API 잔여 호출 건수 (다음 자동갱신: ${nextAutoSlot})`}
          >
            금일 무료 API 잔여: {remaining} / {manualLimit}회 (자동예약 제외)
          </span>
          <button
            className="btn-action"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={() => onAiEvaluateAndTrade(false)}
            disabled={isAiEvaluating}
          >
            {isAiEvaluating ? '⏳ 분석 중...' : '🔄 AI 실시간 시장분석 & 봇진단'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px', lineHeight: 1.5 }}>
        💡 <strong>다중 LLM 하이브리드 자동 배치 (30분 Flash & 60분 Pro) & 수동 즉시 분석</strong>: <strong>30분 주기(매시 00분·30분) Gemini Flash</strong>가 실시간 속보 뉴스와 단기 시황을 신속 진단하고, <strong>1시간 주기(매시 정각) Gemini Pro</strong>가 거시 경제 및 심층 퀀트 데이터를 종합 분석합니다. 실전 매매는 두 모델의 교차검증(Consensus)을 통해 최종 집행되며, 수동 분석 요청 시에도 즉시 반영됩니다.
      </div>

      {/* 한·미 분리 LLM 알고리즘 매매 판정 & 작동 지침 안내 박스 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        {/* 🇰🇷 한국 온주 알고리즘 매매 상태 */}
        <div
          style={{
            background: isKrHalted ? 'rgba(239, 68, 68, 0.08)' : 'rgba(9, 13, 24, 0.7)',
            border: isKrHalted ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '15px' }}>🇰🇷</span>
              <strong style={{ fontSize: '13px', color: '#e2e8f0' }}>한국 시장 LLM 매매 판정</strong>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                background: isKrHalted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                color: isKrHalted ? '#f87171' : '#34d399',
                border: isKrHalted ? '1px solid #ef4444' : '1px solid #10b981',
              }}
            >
              {krBadgeText}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '6px' }}>
            {krRegime.reason || krRegime.detailText || (isKrHalted ? '코스피 급락 및 20일선 하회로 신규 매수 차단 (기보유 종목 청산만 집행)' : '국내 지수 및 이동평균선 정상 구간')}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            📊 국내 시그널: 매수 <strong style={{ color: '#34d399' }}>{krBuyList.length}건</strong> · 관망 <strong>{krHoldList.length}건</strong> · 매도 <strong style={{ color: '#f87171' }}>{krSellList.length}건</strong>
          </div>
        </div>

        {/* 🇺🇸 미국 소수점 알고리즘 매매 상태 */}
        <div
          style={{
            background: isUsHalted ? 'rgba(239, 68, 68, 0.08)' : 'rgba(9, 13, 24, 0.7)',
            border: isUsHalted ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(99, 102, 241, 0.4)',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '15px' }}>🇺🇸</span>
              <strong style={{ fontSize: '13px', color: '#e2e8f0' }}>미국 시장 LLM 매매 판정</strong>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                background: isUsHalted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.25)',
                color: isUsHalted ? '#f87171' : '#a5b4fc',
                border: isUsHalted ? '1px solid #ef4444' : '1px solid #6366f1',
              }}
            >
              {usBadgeText}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '6px' }}>
            {usRegime.reason || usRegime.detailText || (isUsHalted ? '미국 증시 리스크 경보로 신규 매수 보류' : '나스닥 100(QQQ) 20MA 상단 지지 및 빅테크 견조한 모멘텀 (정규장 예약 체결)')}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            📊 미국 시그널: 매수 <strong style={{ color: '#34d399' }}>{usBuyList.length}건</strong> · 관망 <strong>{usHoldList.length}건</strong> · 매도 <strong style={{ color: '#f87171' }}>{usSellList.length}건</strong> (토스 소수점 자동체결)
          </div>
        </div>
      </div>

      {/* 1. Spoken Narrative Comprehensive Market Briefing Card (구두형 증시 시황 해설 & 봇 진단) */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid rgba(147, 51, 234, 0.3)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px' }}>🎙️</span>
            <strong style={{ fontSize: '14px', color: '#f3e8ff' }}>Gemini LLM 실시간 시장 분석 & 봇 진단 종합 리포트</strong>
            <span className="badge-mode real" style={{ fontSize: '11px', background: 'rgba(147, 51, 234, 0.25)', color: '#d8b4fe', borderColor: 'rgba(147, 51, 234, 0.4)' }}>
              {latestAnalysis?.triggerType === 'MANUAL' ? '⚡ 수동 분석 반영됨' : '⚡ 30분 Flash & 🏛️ 60분 Pro 하이브리드 자동 분석'}
            </span>
            {createdAtStr && (
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                ({createdAtStr} · {triggerType === 'MANUAL' ? '⚡수동분석' : '⏰자동갱신'})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-action"
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                background: isPlayingVoice ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.2)',
                color: isPlayingVoice ? '#fca5a5' : '#93c5fd',
                borderColor: isPlayingVoice ? '#ef4444' : 'rgba(59, 130, 246, 0.4)',
              }}
              onClick={() => handleSpeak(verbalOverviewText)}
            >
              {isPlayingVoice ? '⏹️ 음성 중지' : '🔊 구두 해설 음성 듣기 (TTS)'}
            </button>
          </div>
        </div>

        {/* 한국 시장(KRX) vs 미국 시장(US) 구분 종합 분석 카드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: '14px',
            marginBottom: '14px',
          }}
        >
          {/* 1) 한국 시장 종합 리포트 */}
          <div
            style={{
              background: isKrHalted ? 'rgba(239, 68, 68, 0.06)' : 'rgba(9, 13, 24, 0.72)',
              border: isKrHalted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '8px',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '15px' }}>🇰🇷</span>
                <strong style={{ fontSize: '13.5px', color: isKrHalted ? '#fca5a5' : '#6ee7b7' }}>
                  한국 시장 (KRX: KOSPI/KOSDAQ) 종합 진단
                </strong>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: isKrHalted ? 'rgba(239, 68, 68, 0.2)' : isKrReduced ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.18)',
                    color: isKrHalted ? '#f87171' : isKrReduced ? '#fbbf24' : '#34d399',
                    border: isKrHalted ? '1px solid rgba(239, 68, 68, 0.45)' : isKrReduced ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(16, 185, 129, 0.4)',
                  }}
                >
                  {isKrHalted ? '🔴 신규 매수 차단' : isKrReduced ? '🟡 비중 50% 축소 매매' : '🟢 정상 매매'} (매수 {krBuyList.length} · 관망 {krHoldList.length} · 매도 {krSellList.length})
                </span>
              </div>
              <button
                type="button"
                className="btn-action"
                style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={() => handleSpeak(`한국 주식 시장 종합 분석입니다. ${krMarketSummaryText}`)}
              >
                🔊 한국장 듣기
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              🎯 <strong>국내 최우선 매수(BUY) 추천</strong>:{' '}
              <span style={{ color: isKrHalted ? '#fca5a5' : '#38bdf8', fontWeight: 600 }}>
                {isKrHalted ? '급락 리스크로 신규 매수 전면 보류 (관망 권고)' : krTopNames}
              </span>
            </div>
            <div style={{ fontSize: '13px', lineHeight: 1.65, color: '#e2e8f0' }}>
              {krMarketSummaryText}
            </div>
          </div>

          {/* 2) 미국 시장 종합 리포트 */}
          <div
            style={{
              background: isUsHalted ? 'rgba(239, 68, 68, 0.06)' : 'rgba(9, 13, 24, 0.72)',
              border: isUsHalted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: '8px',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '15px' }}>🇺🇸</span>
                <strong style={{ fontSize: '13.5px', color: isUsHalted ? '#fca5a5' : '#a5b4fc' }}>
                  미국 시장 (US: NYSE/NASDAQ) 종합 진단
                </strong>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: isUsHalted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                    color: isUsHalted ? '#f87171' : '#a5b4fc',
                    border: isUsHalted ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(99, 102, 241, 0.45)',
                  }}
                >
                  {isUsHalted ? '🔴 신규 매수 차단' : isUsReduced ? '🟡 비중 50% 축소 매매' : '🟢 정상 매매'} (매수 {usBuyList.length} · 관망 {usHoldList.length} · 매도 {usSellList.length})
                </span>
              </div>
              <button
                type="button"
                className="btn-action"
                style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={() => handleSpeak(`미국 주식 시장 종합 분석입니다. ${usMarketSummaryText}`)}
              >
                🔊 미국장 듣기
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              🎯 <strong>미국 최우선 소수점(BUY) 추천</strong>:{' '}
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{usTopNames}</span>
            </div>
            <div style={{ fontSize: '13px', lineHeight: 1.65, color: '#e2e8f0' }}>
              {usMarketSummaryText}
            </div>
          </div>
        </div>

        {/* 3) 상세 마크다운 종합 리포트 본문 */}
        <div
          style={{
            fontSize: '13.5px',
            lineHeight: '1.7',
            color: '#e2e8f0',
            background: 'rgba(0, 0, 0, 0.35)',
            padding: '14px 18px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            maxHeight: '420px',
            overflowY: 'auto',
          }}
        >
          {isAiEvaluating ? (
            '⏳ Gemini LLM이 실시간 수집 뉴스와 한국 시장(KRX) 및 미국 시장(NYSE/NASDAQ) 지표를 종합 분석하여 시황 리포트를 작성하고 있습니다...'
          ) : (
            <MarkdownViewer content={verbalOverviewText} isStreaming={false} />
          )}
        </div>
      </div>

      {/* 2. Detailed Spoken Strategy Table for Evaluated Candidate Stocks */}
      <div className="table-wrapper">
        <table className="custom-table">
          <thead>
            <tr>
              <th>종목명 (코드)</th>
              <th>시장/구분</th>
              <th>AI 매매 신호</th>
              <th>감성점수 / 확신도</th>
              <th style={{ minWidth: '340px' }}>🎙️ LLM 구두형 매매 시황 해설 & 뉴스 근거</th>
              <th>실행 엔진</th>
              <th>자동 집행</th>
            </tr>
          </thead>
          <tbody>
            {aiDecisions.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                  현재 대기 중인 AI 분석 시그널이 없습니다. 상단의 <strong>[🔄 AI 실시간 시장분석 & 봇진단]</strong> 버튼을 누르면 실시간 뉴스를 분석합니다.
                </td>
              </tr>
            ) : (
              aiDecisions.slice(0, 10).map((d, idx) => {
                const isBuy = d.action === 'BUY';
                const isSell = d.action === 'SELL';
                const isUS = d.market === 'US';
                const relNews = d.related_news || d.relatedNews;

                return (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>
                      {d.stock_name || d.name} ({d.symbol})
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isUS ? 'rgba(99, 102, 241, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: isUS ? '#a5b4fc' : '#6ee7b7',
                          border: isUS ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                        }}
                      >
                        {isUS ? '🇺🇸 미국 소수점' : '🇰🇷 국내 온주'}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: isBuy ? 'rgba(16, 185, 129, 0.2)' : isSell ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: isBuy ? '#34d399' : isSell ? '#f87171' : '#fbbf24',
                          border: isBuy ? '1px solid #10b981' : isSell ? '1px solid #ef4444' : '1px solid #f59e0b',
                        }}
                      >
                        {isBuy ? '🟢 강력 매수 (BUY)' : isSell ? '🔴 매도 권고 (SELL)' : '🟡 관망 (HOLD)'}
                      </span>
                    </td>
                    <td>
                      <span className={(d.sentiment_score ?? d.sentimentScore ?? 0) > 0 ? 'num-up' : (d.sentiment_score ?? d.sentimentScore ?? 0) < 0 ? 'num-down' : ''}>
                        {(d.sentiment_score ?? d.sentimentScore ?? 0) > 0 ? '+' : ''}{d.sentiment_score ?? d.sentimentScore}점
                      </span>
                      <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
                        (확신 {d.confidence}%)
                      </span>
                    </td>
                    <td style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.6, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn-action"
                          style={{ padding: '2px 6px', fontSize: '11px', flexShrink: 0, marginTop: '2px' }}
                          title="이 종목 구두 해설 듣기"
                          onClick={() => handleSpeak(`${d.stock_name || d.name} 종목 구두 해설입니다. ${d.reasoning}`)}
                        >
                          🔊
                        </button>
                        <div style={{ flex: 1 }}>
                          {relNews && (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: 'rgba(56, 189, 248, 0.15)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                marginBottom: '6px',
                                maxWidth: '100%',
                                wordBreak: 'break-all',
                              }}
                            >
                              <span>📰 관련 뉴스:</span>
                              <strong>{relNews}</strong>
                            </div>
                          )}
                          <div style={{ wordBreak: 'keep-all' }}>{d.reasoning}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                        🐍 Python Toss Core
                      </span>
                    </td>
                    <td>
                      <span
                        className="status-pill green"
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        ● 자동 매매 반영
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
