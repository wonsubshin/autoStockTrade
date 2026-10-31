import React from 'react';

export default function BotCard({
  bots,
  selectedBotId,
  setSelectedBotId,
  selectedBot,
  selectedStockCode,
  setSelectedStockCode,
  onBotAction,
  onManualTradeTest,
  onAiEvaluateAndTrade,
  isAiEvaluating,
  positionsCount,
  activeTradeMode,
}) {
  const isReal = selectedBot?.trade_mode === 'REAL';
  const isFractionalTarget = !/^[0-9]/.test(selectedStockCode);

  return (
    <>
      {/* Bot Selection Tabs */}
      <div className="bot-tabs-container">
        {bots.map((b) => (
          <button
            key={b.bot_id}
            className={`bot-tab-btn ${b.trade_mode === 'REAL' ? 'real-mode' : 'virtual-mode'} ${selectedBotId === b.bot_id ? 'active' : ''}`}
            onClick={() => setSelectedBotId(b.bot_id)}
          >
            <span>{b.nickname || b.name}</span>
            <span className={`badge-mode ${b.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
              {b.trade_mode === 'REAL' ? '💰 실전' : '🧪 가상'}
            </span>
            <span style={{ fontSize: '11px', color: b.is_running ? '#34d399' : '#94a3b8' }}>
              {b.is_running ? '🟢 가동' : '⚪ 정지'}
            </span>
          </button>
        ))}
      </div>

      {/* Selected Bot Control Actions Bar */}
      {selectedBot && (
        <div className="bot-action-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {selectedBot.is_running ? (
            <button className="btn-action danger" onClick={() => onBotAction('STOP')}>
              ⏹ 거래 중지
            </button>
          ) : (
            <button className="btn-action success" onClick={() => onBotAction('START')}>
              ▶ 거래 시작
            </button>
          )}
          <button className="btn-action warning" onClick={() => onBotAction('TOGGLE_MODE')}>
            🔄 모드 전환 ({selectedBot.trade_mode === 'REAL' ? '🧪 가상으로 전환' : '💰 실전으로 전환'})
          </button>

          {/* Stock Selector (국내주식 온주 / 미국주식 소수점) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <select
              value={selectedStockCode}
              onChange={(e) => setSelectedStockCode(e.target.value)}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '7px 10px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <optgroup label="🇰🇷 국내 대표주 (1주 온주 단위)">
                <option value="005930">🇰🇷 삼성전자 (005930)</option>
                <option value="000660">🇰🇷 SK하이닉스 (000660)</option>
                <option value="068270">🇰🇷 셀트리온 (068270)</option>
                <option value="086520">🇰🇷 에코프로 (086520)</option>
              </optgroup>
              <optgroup label="🇺🇸 미국 우량주 (토스 소수점 금액 주문)">
                <option value="AAPL">🇺🇸 애플 AAPL [소수점]</option>
                <option value="NVDA">🇺🇸 엔비디아 NVDA [소수점]</option>
                <option value="TSLA">🇺🇸 테슬라 TSLA [소수점]</option>
                <option value="MSFT">🇺🇸 마이크로소프트 MSFT [소수점]</option>
                <option value="QQQ">🇺🇸 QQQ ETF [소수점]</option>
                <option value="SBUX">🇺🇸 스타벅스 SBUX [소수점]</option>
              </optgroup>
            </select>
          </div>

          <button className="btn-action" onClick={() => onManualTradeTest('BUY', selectedStockCode)}>
            {selectedBot.trade_mode === 'REAL'
              ? `🛒 실전 매수 (🐍 Python ${isFractionalTarget ? '소수점' : '온주'})`
              : `🛒 가상 매수 (${isFractionalTarget ? '소수점' : '온주'})`}
          </button>
          <button className="btn-action" onClick={() => onManualTradeTest('SELL', selectedStockCode)}>
            {selectedBot.trade_mode === 'REAL' ? '📉 실전 매도 (🐍 Python)' : '📉 가상 매도'}
          </button>

          <button
            className="btn-action"
            style={{
              backgroundColor: 'rgba(147, 51, 234, 0.25)',
              color: '#c084fc',
              border: '1px solid rgba(147, 51, 234, 0.6)',
            }}
            onClick={() => onAiEvaluateAndTrade(true, selectedStockCode)}
            disabled={isAiEvaluating}
          >
            {isAiEvaluating ? '⚡ AI 판단 및 Python 집행 중...' : '🤖 AI 판단 ⨉ Python 즉시 매매'}
          </button>

          {selectedBot.trade_mode === 'VIRTUAL' && (
            <button className="btn-action danger" onClick={() => onBotAction('RESET_VIRTUAL')}>
              ⚠️ 가상 리셋
            </button>
          )}
        </div>
      )}

      {/* Bot Metrics Summary */}
      {selectedBot && (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">{selectedBot.trade_mode === 'REAL' ? '봇 할당 실전자본' : '가상 예수금 (KRW)'}</div>
            <div className="metric-value">
              {selectedBot.trade_mode === 'REAL'
                ? (selectedBot.allocated_capital || 0).toLocaleString() + '원'
                : (selectedBot.virtual_krw || 0).toLocaleString() + '원'}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">보유 중인 포지션 수</div>
            <div className="metric-value">
              {positionsCount}건
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">목표 익절 / 손절 설정</div>
            <div className="metric-value">
              <span className="num-up">+{selectedBot.take_profit_pct}%</span> / <span className="num-down">-{selectedBot.stop_loss_pct}%</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">현재 봇 상태</div>
            <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '6px', lineHeight: 1.4 }}>
              {selectedBot.last_status_msg || '정상 가동 대기 중'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
