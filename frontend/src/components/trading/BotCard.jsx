import React from 'react';

export default function BotCard({
  bots,
  selectedBotId,
  setSelectedBotId,
  selectedBot,
  selectedStockCode,
  setSelectedStockCode,
  onBotAction,
  onRealToggle,
  onManualTradeTest,
  onAiEvaluateAndTrade,
  isAiEvaluating,
  positionsCount,
  activeTradeMode,
}) {
  const isReal = selectedBot?.trade_mode === 'REAL' || selectedBot?.is_real_selected === 1;
  const isFractionalTarget = !/^[0-9]/.test(selectedStockCode);

  return (
    <>
      {/* Bot Selection Tabs */}
      <div className="bot-tabs-container">
        {bots.map((b) => {
          const isSelected = selectedBotId === b.bot_id;
          const isRealRunning = b.is_real_running === 1;
          return (
            <button
              key={b.bot_id}
              className={`bot-tab-btn ${b.is_real_selected === 1 ? 'real-mode' : 'virtual-mode'} ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedBotId(b.bot_id)}
            >
              <span>{b.nickname || b.name}</span>
              {b.is_real_selected === 1 ? (
                <span className="badge-mode real">
                  💰 실전 {b.real_allocation_ratio || 0}%
                </span>
              ) : (
                <span className="badge-mode virtual">
                  🧪 가상
                </span>
              )}
              <span style={{ fontSize: '11px', color: (isRealRunning || b.is_running) ? '#34d399' : '#94a3b8' }}>
                {(isRealRunning || b.is_running) ? '🟢 가동' : '⚪ 정지'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Bot Control Actions Bar */}
      {selectedBot && (
        <div className="bot-action-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {selectedBot.is_real_selected === 1 ? (
            selectedBot.is_real_running ? (
              <button
                className="btn-action danger"
                onClick={() => onRealToggle ? onRealToggle(selectedBot.bot_id, false) : onBotAction('STOP')}
              >
                ⏹ 실전 거래 중지
              </button>
            ) : (
              <button
                className="btn-action success"
                onClick={() => onRealToggle ? onRealToggle(selectedBot.bot_id, true) : onBotAction('START')}
              >
                ▶ 실전 거래 시작
              </button>
            )
          ) : (
            selectedBot.is_running ? (
              <button className="btn-action danger" onClick={() => onBotAction('STOP')}>
                ⏹ 거래 중지
              </button>
            ) : (
              <button className="btn-action success" onClick={() => onBotAction('START')}>
                ▶ 거래 시작
              </button>
            )
          )}

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
            {selectedBot.is_real_selected === 1 || selectedBot.trade_mode === 'REAL'
              ? `🛒 실전 매수 (🐍 Python ${isFractionalTarget ? '소수점' : '온주'})`
              : `🛒 가상 매수 (${isFractionalTarget ? '소수점' : '온주'})`}
          </button>
          <button className="btn-action" onClick={() => onManualTradeTest('SELL', selectedStockCode)}>
            {selectedBot.is_real_selected === 1 || selectedBot.trade_mode === 'REAL'
              ? '📉 실전 매도 (🐍 Python)'
              : '📉 가상 매도'}
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

          {selectedBot.trade_mode === 'VIRTUAL' && selectedBot.is_real_selected !== 1 && (
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
            <div className="metric-title">
              {selectedBot.is_real_selected === 1 ? '배정된 실전 투자금 (KRW)' : '가상 예수금 (KRW)'}
            </div>
            <div className="metric-value">
              {selectedBot.is_real_selected === 1
                ? (selectedBot.real_allocated_capital || selectedBot.allocated_capital || 0).toLocaleString() + '원'
                : (selectedBot.virtual_krw || 0).toLocaleString() + '원'}
            </div>
            {selectedBot.is_real_selected === 1 && (
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                가용 잔고: {(selectedBot.real_available_krw || 0).toLocaleString()}원 ({selectedBot.real_allocation_ratio || 0}%)
              </div>
            )}
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
              <span className="num-up">+{selectedBot.take_profit_pct}%</span> / <span className="num-down">-{Math.abs(selectedBot.stop_loss_pct)}%</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">현재 봇 상태</div>
            <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '6px', lineHeight: 1.4 }}>
              {selectedBot.is_real_selected === 1 ? (selectedBot.real_status_msg || selectedBot.last_status_msg || '실전 대기 중') : (selectedBot.virtual_status_msg || selectedBot.last_status_msg || '상시 가상 경쟁 중')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
