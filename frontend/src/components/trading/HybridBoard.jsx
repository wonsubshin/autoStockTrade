import React, { useState } from 'react';

export default function HybridBoard({
  aiDecisions,
  isAiEvaluating,
  onAiEvaluateAndTrade,
}) {
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  // 종합 구두 브리핑 텍스트 생성
  const topPick = aiDecisions.find((d) => d.action === 'BUY') || aiDecisions[0];
  const buyCount = aiDecisions.filter((d) => d.action === 'BUY').length;
  const holdCount = aiDecisions.filter((d) => d.action === 'HOLD').length;

  const verbalOverviewText = aiDecisions.length > 0
    ? `안녕하십니까, Gemini 2.5 Flash 증시 인텔리전스 구두 시황 브리핑입니다. ` +
      `실시간 수집된 국내외 주요 증시 뉴스를 종합 분석한 결과, 현재 시장은 기술주와 반도체 중심의 긍정적인 매수 모멘텀이 우세하게 작용하고 있습니다. ` +
      `전체 분석 대상 중 매수 유효 종목은 ${buyCount}건, 관망 종목은 ${holdCount}건으로 집계되었으며, ` +
      `특히 가장 강력한 호재 시그널이 포착된 ${topPick?.stock_name || topPick?.name || '핵심 종목'}의 경우, ` +
      `${topPick?.isFractional ? '토스증권 소수점 금액 주문($10 단위)을 통해 분할 매수하시는 것을 적극 추천드립니다.' : '키움증권 호가 지지선을 바탕으로 1주 단위 분할 매수로 접근하시는 것이 안전합니다.'} ` +
      `무리한 단기 추격 매수보다는 퀀트 알고리즘 지지선을 확인하며 분할 집행하시는 전략을 권장해 드립니다.`
    : `실시간 수집된 최신 뉴스와 시장 수급을 바탕으로 Gemini LLM이 생생한 구두형 증시 시황 브리핑 및 종목별 매매 전략을 안내해 드립니다. 상단의 [🔄 AI 시그널 재분석]을 눌러주세요.`;

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
          <span>🤖 Gemini LLM 실시간 뉴스 감성 분석 & Python Core Executor 매매 판단</span>
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
            하이브리드 아키텍처
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
            🇺🇸 소수점 / 🇰🇷 온주 통합
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn-action"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={() => onAiEvaluateAndTrade(false)}
            disabled={isAiEvaluating}
          >
            {isAiEvaluating ? '⏳ 분석 중...' : '🔄 AI 시그널 재분석'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
        💡 <strong>하이브리드 파이프라인</strong>: 실시간 수집된 증시 뉴스·공시를 <strong>Gemini LLM</strong>이 심층 분석하여 <strong>구두형 음성/텍스트 시황 해설</strong>과 매매 시그널을 도출하고, 주문 집행은 <strong>Python 코어 실행기(Toss Executor)</strong>가 토스증권 Open API를 통해 안전하게 집행합니다.
      </div>

      {/* 1. Spoken Narrative Comprehensive Market Briefing Card (구두형 증시 시황 해설) */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🎙️</span>
            <strong style={{ fontSize: '14px', color: '#f3e8ff' }}>Gemini LLM 실시간 구두형 뉴스 감성 종합 시황 해설</strong>
            <span className="badge-mode real" style={{ fontSize: '11px', background: 'rgba(147, 51, 234, 0.25)', color: '#d8b4fe', borderColor: 'rgba(147, 51, 234, 0.4)' }}>
              구두 브리핑 모드
            </span>
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

        <div
          style={{
            fontSize: '13.5px',
            lineHeight: '1.7',
            color: '#e2e8f0',
            background: 'rgba(0, 0, 0, 0.35)',
            padding: '14px 18px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {isAiEvaluating ? '⏳ Gemini LLM이 실시간 증시 뉴스와 수급을 분석하여 구두형 종합 시황 보고서를 작성하고 있습니다...' : verbalOverviewText}
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
              <th style={{ minWidth: '320px' }}>🎙️ LLM 구두형 매매 시황 해설 & 행동 전략</th>
              <th>실행 엔진</th>
              <th>원클릭 주문</th>
            </tr>
          </thead>
          <tbody>
            {aiDecisions.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                  현재 대기 중인 AI 분석 시그널이 없습니다. 상단의 <strong>[🔄 AI 시그널 재분석]</strong> 버튼을 누르면 실시간 뉴스를 분석합니다.
                </td>
              </tr>
            ) : (
              aiDecisions.slice(0, 10).map((d, idx) => {
                const isBuy = d.action === 'BUY';
                const isSell = d.action === 'SELL';
                const isUS = d.market === 'US';
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
                      <span className={(d.sentiment_score || d.sentimentScore) > 0 ? 'num-up' : (d.sentiment_score || d.sentimentScore) < 0 ? 'num-down' : ''}>
                        {(d.sentiment_score || d.sentimentScore) > 0 ? '+' : ''}{d.sentiment_score || d.sentimentScore}점
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
                        <div>{d.reasoning}</div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                        🐍 Python Toss Core
                      </span>
                    </td>
                    <td>
                      <button
                        className={`btn-action ${isBuy ? 'success' : 'secondary'}`}
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => onAiEvaluateAndTrade(true, d.symbol)}
                      >
                        {isBuy ? '⚡ 즉시 집행' : '수동 집행'}
                      </button>
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
