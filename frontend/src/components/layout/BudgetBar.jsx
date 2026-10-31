import React from 'react';

export default function BudgetBar({
  tradingModeFilter,
  setTradingModeFilter,
  activeTradeMode,
  selectedBot,
  accountBalance,
  onRefreshBalance,
}) {
  const isReal = activeTradeMode === 'REAL';
  const profitRate = isReal
    ? (accountBalance?.real?.profitRate || 0)
    : (accountBalance?.virtual?.profitRate || 0);

  return (
    <>
      {/* Mode Filter Bar & Prominent Status Notice */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px', gap: '10px' }}>
        <div className="mode-filter-bar">
          <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '4px', fontWeight: 600 }}>표시 모드:</span>
          <button
            className={`mode-filter-btn ${tradingModeFilter === 'AUTO' ? (isReal ? 'active real' : 'active virtual') : ''}`}
            onClick={() => setTradingModeFilter('AUTO')}
          >
            ⚡ 봇 동기화 ({selectedBot?.trade_mode === 'REAL' ? '실전' : '가상'})
          </button>
          <button
            className={`mode-filter-btn ${tradingModeFilter === 'VIRTUAL' ? 'active virtual' : ''}`}
            onClick={() => setTradingModeFilter('VIRTUAL')}
          >
            🧪 가상 매매 (VIRTUAL)
          </button>
          <button
            className={`mode-filter-btn ${tradingModeFilter === 'REAL' ? 'active real' : ''}`}
            onClick={() => setTradingModeFilter('REAL')}
          >
            💰 실전 투자 (REAL)
          </button>
          <button
            className={`mode-filter-btn ${tradingModeFilter === 'ALL' ? 'active all' : ''}`}
            onClick={() => setTradingModeFilter('ALL')}
          >
            🌐 전체
          </button>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: isReal ? '#fca5a5' : '#6ee7b7' }}>
          운용 모드: {isReal ? '🚨 [실전 매매] 토스증권 계좌 직접 연동' : '🧪 [가상 매매] 키움 호가 정밀 시뮬레이션'}
        </div>
      </div>

      {/* Mode Banner: Clearly distinguishes REAL vs VIRTUAL */}
      {isReal ? (
        <div className="mode-banner real">
          <span className="mode-pulse-dot real"></span>
          <div>
            <strong>🚨 [실전 투자 운용 모드 - REAL TRADING]</strong> 토스증권 실전 계좌와 직접 연동되어 실제 예수금으로 주문이 집행됩니다. 아래 보유 종목 및 체결 내역은 <strong>토스증권 실전 거래 데이터</strong>만 엄격하게 분리되어 표시됩니다.
          </div>
        </div>
      ) : (
        <div className="mode-banner virtual">
          <span className="mode-pulse-dot virtual"></span>
          <div>
            <strong>🧪 [모의 가상 투자 모드 - PAPER TRADING]</strong> 키움증권 실시간 호가/시세 기반 정밀 가상 체결 시뮬레이션 환경입니다. 아래 보유 종목 및 체결 내역은 <strong>가상 매매 데이터</strong>만 표시됩니다.
          </div>
        </div>
      )}

      {/* Account Assets Summary Card for Active Mode */}
      <div className="board-card" style={{ marginBottom: '20px', borderColor: isReal ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.35)' }}>
        <div className="card-title-row">
          <div className="card-title">
            {isReal ? '💼 토스증권 실전 계좌 자산 & 예산 배분 현황' : '🧪 키움 시세 기반 가상 매매 자산 현황'}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn-action" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={onRefreshBalance}>
              🔄 잔고 갱신
            </button>
            <span className={`badge-mode ${isReal ? 'real' : 'virtual'}`}>
              {isReal ? '토스증권 실전 계좌' : '가상 체결 엔진'}
            </span>
          </div>
        </div>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">{isReal ? '주문 가능 예수금 (토스)' : '가상 예수금 (KRW)'}</div>
            <div className="metric-value">
              {isReal
                ? (accountBalance?.real?.availableCash || 0).toLocaleString() + '원'
                : (accountBalance?.virtual?.availableCash || 0).toLocaleString() + '원'}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">{isReal ? '주식 매입/평가 금액 (토스)' : '가상 주식 평가 금액'}</div>
            <div className="metric-value">
              {isReal
                ? (accountBalance?.real?.stockEvalAmount || 0).toLocaleString() + '원'
                : (accountBalance?.virtual?.stockEvalAmount || 0).toLocaleString() + '원'}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">{isReal ? '총 평가 자산 (토스)' : '가상 총 자산'}</div>
            <div className="metric-value">
              {isReal
                ? (accountBalance?.real?.totalAssetAmount || 0).toLocaleString() + '원'
                : (accountBalance?.virtual?.totalAssetAmount || 0).toLocaleString() + '원'}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">운용 수익률 / 배분 예산</div>
            <div className="metric-value">
              <span className={profitRate >= 0 ? 'num-up' : 'num-down'}>
                {profitRate >= 0 ? '+' : ''}{profitRate}%
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
                (할당: {(selectedBot?.allocated_capital || 10000000).toLocaleString()}원)
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
