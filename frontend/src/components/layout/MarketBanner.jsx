import React from 'react';

export default function MarketBanner({
  aiBriefingText,
  isBriefingStreaming,
  onStartBriefing,
}) {
  return (
    <div className="top-briefing-box">
      <span className="briefing-badge">Gemini AI 증시 브리핑 (국내: 키움 시세 / 미국: 토스 실시간 시세)</span>
      <div className="briefing-text">
        {aiBriefingText || 'Gemini 2.5 Flash가 실시간 키움증권 호가 및 토스증권 매매 전략을 분석하여 실시간 브리핑을 제공합니다.'}
        {isBriefingStreaming && <span className="cursor-blink">|</span>}
      </div>
      <button
        className="btn-action"
        style={{ padding: '4px 8px', fontSize: '11px' }}
        onClick={onStartBriefing}
        disabled={isBriefingStreaming}
      >
        {isBriefingStreaming ? '⚡ 생성 중...' : '🔄 실시간 재분석'}
      </button>
    </div>
  );
}
