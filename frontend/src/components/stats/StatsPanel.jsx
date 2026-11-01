import React from 'react';

export default function StatsPanel({
  statsData,
  statsPeriodTab,
  setStatsPeriodTab,
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div className="period-tab-group">
          <button
            className={`period-tab-btn ${statsPeriodTab === 'daily' ? 'active' : ''}`}
            onClick={() => setStatsPeriodTab('daily')}
          >
            일별 (Daily)
          </button>
          <button
            className={`period-tab-btn ${statsPeriodTab === 'weekly' ? 'active' : ''}`}
            onClick={() => setStatsPeriodTab('weekly')}
          >
            주별 (Weekly)
          </button>
          <button
            className={`period-tab-btn ${statsPeriodTab === 'monthly' ? 'active' : ''}`}
            onClick={() => setStatsPeriodTab('monthly')}
          >
            월별 (Monthly)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="badge-mode real"
            style={{
              fontSize: '12px',
              padding: '6px 14px',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
            }}
          >
            <span className="mode-pulse-dot" style={{ background: '#ef4444', width: '8px', height: '8px' }}></span>
            💰 실전 매매 전용 통계 (토스증권 실계좌 체결 기준)
          </span>
        </div>
      </div>

      {/* Overall Cumulative Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-title">실전 누적 실현 손익합계 (2026.10~)</div>
          <div className="metric-value">
            <span className={(statsData?.totalProfitKrw || 0) >= 0 ? 'num-up' : 'num-down'}>
              {(statsData?.totalProfitKrw || 0) >= 0 ? '+' : ''}
              {(statsData?.totalProfitKrw || 0).toLocaleString()}원
            </span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-title">총 실전 체결 거래수</div>
          <div className="metric-value">{statsData?.totalTrades || 0}회</div>
        </div>
        <div className="metric-card">
          <div className="metric-title">실전 종합 승률 (Win Rate)</div>
          <div className="metric-value">
            <span className={(statsData?.winRate || 0) >= 50 ? 'num-up' : 'num-down'}>
              {statsData?.winRate || 0}%
            </span>
          </div>
        </div>
      </div>

      {/* Periodical Performance Table */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">
            📅 {statsPeriodTab === 'daily' ? '일별' : statsPeriodTab === 'weekly' ? '주별' : '월별'} 실전 실현 손익 및 체결 성과 내역
          </div>
        </div>
        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th>기간 (Period)</th>
                <th>실전 실현 손익금</th>
                <th>실전 체결 횟수</th>
                <th>승률</th>
              </tr>
            </thead>
            <tbody>
              {!statsData?.timeline || statsData.timeline.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '36px 20px', color: '#94a3b8', fontSize: '13px', lineHeight: 1.6 }}>
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>💼</div>
                    <strong style={{ color: '#f1f5f9', fontSize: '14px' }}>토스증권 실계좌에서 체결 및 청산 완료된 실전 거래 내역이 없습니다.</strong>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                      실전 자동매매 봇이 거래를 집행하고 포지션을 청산하면 실현 손익 통계가 이곳에 자동으로 기록됩니다.
                    </div>
                  </td>
                </tr>
              ) : (
                statsData.timeline.map((item) => {
                  const isUp = item.profitKrw > 0;
                  const isDown = item.profitKrw < 0;
                  return (
                    <tr key={item.period}>
                      <td style={{ fontWeight: 600 }}>{item.period}</td>
                      <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                        {isUp ? '+' : ''}{item.profitKrw.toLocaleString()}원
                      </td>
                      <td>{item.tradesCount}건</td>
                      <td className={item.winRate >= 50 ? 'num-up' : 'num-down'}>{item.winRate}%</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Contribution Ranking Table */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">🏆 종목별 실전 수익 기여도 순위</div>
        </div>
        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>종목명 (종목코드)</th>
                <th>누적 실현 손익</th>
                <th>실전 매매 횟수</th>
                <th>종목별 승률</th>
              </tr>
            </thead>
            <tbody>
              {!statsData?.stockRanking || statsData.stockRanking.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8', fontSize: '13px' }}>
                    💼 실전 매매 체결 완료된 종목 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                statsData.stockRanking.map((stock, idx) => {
                  const isUp = stock.totalProfitKrw > 0;
                  const isDown = stock.totalProfitKrw < 0;
                  return (
                    <tr key={stock.stockCode}>
                      <td>{idx + 1}위</td>
                      <td style={{ fontWeight: 600 }}>{stock.stockName} ({stock.stockCode})</td>
                      <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                        {isUp ? '+' : ''}{stock.totalProfitKrw.toLocaleString()}원
                      </td>
                      <td>{stock.tradesCount}회</td>
                      <td className={stock.winRate >= 50 ? 'num-up' : 'num-down'}>{stock.winRate}%</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
