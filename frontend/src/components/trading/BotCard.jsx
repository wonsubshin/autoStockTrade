import React from 'react';

export default function BotCard({
  bots,
  selectedBotId,
  setSelectedBotId,
  selectedBot,
  onBotAction,
  onRealToggle,
  positionsCount,
  activeTradeMode,
}) {
  const isReal = selectedBot?.trade_mode === 'REAL' || selectedBot?.is_real_selected === 1;

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
        <div className="bot-action-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
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

          {selectedBot.trade_mode === 'VIRTUAL' && selectedBot.is_real_selected !== 1 && (
            <button className="btn-action danger" onClick={() => onBotAction('RESET_VIRTUAL')}>
              ⚠️ 가상 리셋
            </button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              className="badge-live-pulse"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                borderColor: 'rgba(16, 185, 129, 0.35)',
                color: '#34d399',
                fontSize: '12px',
                padding: '5px 12px',
              }}
            >
              <span className="mode-pulse-dot" style={{ background: '#10b981', width: '7px', height: '7px' }}></span>
              🤖 100% 전자동 알고리즘 자율 매매 시스템 가동 중
            </span>
          </div>
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
