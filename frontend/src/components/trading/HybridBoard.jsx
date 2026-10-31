import React from 'react';

export default function HybridBoard({
  aiDecisions,
  isAiEvaluating,
  onAiEvaluateAndTrade,
}) {
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

      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '14px', lineHeight: 1.5 }}>
        💡 <strong>하이브리드 파이프라인</strong>: 실시간 수집된 증시 뉴스·공시를 <strong>Gemini LLM</strong>이 심층 분석하여 종목별 감성점수와 매매 시그널을 판정하고, 주문 집행은 <strong>Python 코어 실행기(Toss Executor)</strong>가 토스증권 Open API를 통해 안전하게 집행합니다.
      </div>

      <div className="table-wrapper">
        <table className="custom-table">
          <thead>
            <tr>
              <th>종목명 (코드)</th>
              <th>시장/구분</th>
              <th>AI 매매 신호</th>
              <th>감성점수 / 확신도</th>
              <th>LLM 퀀트 분석 핵심 근거</th>
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
              aiDecisions.slice(0, 8).map((d, idx) => {
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
                    <td style={{ fontSize: '12px', color: '#cbd5e1', maxWidth: '320px', lineHeight: 1.4 }}>
                      {d.reasoning}
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
