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
  const daytimeExchange = accountBalance?.daytimeExchange || accountBalance?.real?.daytimeExchange;

  return (
    <>
      {/* 1.3 평일 주간(09:00~15:30) 95% 환율 우대 사전 달러 환전 권장 배너 */}
      {daytimeExchange?.isRecommended && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.15))',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#fbbf24',
          fontSize: '13px',
          lineHeight: '1.5'
        }}>
          <span style={{ fontSize: '22px' }}>💡</span>
          <div>
            <strong>[주간 95% 환율 우대 사전 환전 권장]</strong> {daytimeExchange.message}
            <div style={{ fontSize: '11.5px', color: '#fcd34d', marginTop: '2px' }}>
              야간 미국 정규장 시간대 원화 자동 환전 시 50% 우대(수수료 0.50%) 및 ±3% 여유금 환전이 적용되므로, 평일 정규장(09:00~15:30, 95% 우대) 내 토스증권 앱에서 미리 달러(USD)로 환전해두시면 수수료를 크게 절감할 수 있습니다.
            </div>
          </div>
        </div>
      )}

      {/* Mode Filter Bar & Prominent Status Notice */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px', gap: '10px' }}>
        <div className="mode-filter-bar">
          <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '4px', fontWeight: 600 }}>표시 모드:</span>
          <button
            className="mode-filter-btn active real"
            onClick={() => setTradingModeFilter && setTradingModeFilter('REAL')}
          >
            💰 실전 투자 (REAL)
          </button>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#fca5a5' }}>
          운용 모드: 🚨 [실전 매매] 토스증권 계좌 직접 연동
        </div>
      </div>

      {/* Mode Banner: Real Trading Notice */}
      <div className="mode-banner real">
        <span className="mode-pulse-dot real"></span>
        <div>
          <strong>🚨 [실전 투자 운용 모드 - REAL TRADING]</strong> 토스증권 실전 계좌와 직접 연동되어 실제 예수금으로 주문이 집행됩니다. 아래 보유 종목 및 체결 내역은 <strong>토스증권 실전 거래 데이터</strong>만 엄격하게 분리되어 표시됩니다.
        </div>
      </div>

      {/* Account Assets Summary Card for Active Mode */}
      <div className="board-card" style={{ marginBottom: '20px', borderColor: 'rgba(239, 68, 68, 0.45)' }}>
        <div className="card-title-row">
          <div className="card-title">
            💼 토스증권 실전 계좌 자산 & 예산 배분 현황
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn-action" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={onRefreshBalance}>
              🔄 잔고 갱신
            </button>
            <span className="badge-mode real">
              토스증권 실전 계좌
            </span>
          </div>
        </div>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">주문 가능 예수금 (원화 / 달러)</div>
            <div className="metric-value">
              {(accountBalance?.real?.availableCash ?? accountBalance?.availableCash ?? 0).toLocaleString()}원
              <span style={{ fontSize: '12px', color: '#10b981', marginLeft: '6px', fontWeight: 700 }}>
                · ${(Number(accountBalance?.real?.availableUsd ?? accountBalance?.availableUsd ?? 0)).toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              통합 환산: 약 {(accountBalance?.real?.totalCashKrw ?? accountBalance?.totalCashKrw ?? ((accountBalance?.real?.availableCash ?? 0) + Math.floor((accountBalance?.real?.availableUsd ?? 0) * 1345))).toLocaleString()}원
            </div>
          </div>
          <div className="metric-card" style={{ border: '1px solid rgba(56, 189, 248, 0.45)', background: 'rgba(56, 189, 248, 0.08)' }}>
            <div className="metric-title" style={{ color: '#38bdf8' }}>총 실전 운영원금 (90% 자동)</div>
            <div className="metric-value" style={{ color: '#38bdf8' }}>
              {(accountBalance?.real?.operatingBudget ?? accountBalance?.operatingBudget ?? 0).toLocaleString()}원
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              ⚡ 원화 + 달러 통합 예수금의 90% 실시간 배분
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">주식 매입/평가 금액 (토스)</div>
            <div className="metric-value">
              {(accountBalance?.real?.stockEvalAmount ?? accountBalance?.stockEvalAmount ?? 0).toLocaleString()}원
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">총 평가 자산 (토스)</div>
            <div className="metric-value">
              {(accountBalance?.real?.totalAssetAmount ?? accountBalance?.totalAssetAmount ?? 0).toLocaleString()}원
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">운용 수익률 / 선택 봇 배분</div>
            <div className="metric-value">
              <span className={profitRate >= 0 ? 'num-up' : 'num-down'}>
                {profitRate >= 0 ? '+' : ''}{profitRate}%
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
                (할당: {Math.round(Number(selectedBot?.real_allocated_capital || selectedBot?.allocated_capital || 0)).toLocaleString()}원, {selectedBot?.real_allocation_ratio || 33.3}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
