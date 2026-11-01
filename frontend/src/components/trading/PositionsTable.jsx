import React from 'react';

export default function PositionsTable({ positions, onSellPosition, activeTradeMode }) {
  const filteredPositions = positions.filter(
    (p) => activeTradeMode === 'ALL' || p.trade_mode === activeTradeMode
  );

  return (
    <div className="board-card">
      <div className="card-title-row">
        <div className="card-title">
          📌 실시간 보유 종목 & 평가 손익 현황 (토스증권 실전 계좌 연동)
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="badge-mode real" style={{ fontSize: '11px' }}>
            토스증권 공식 Open API 실시간
          </span>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            총 {filteredPositions.length}개 보유 중
          </span>
        </div>
      </div>
      <div className="table-wrapper">
        <table className="custom-table">
          <thead>
            <tr>
              <th>종목명 (코드)</th>
              <th>구분</th>
              <th>보유수량</th>
              <th>매수평균가</th>
              <th>현재가</th>
              <th>평가금액</th>
              <th>평가손익</th>
              <th>수익률</th>
              <th>진입일시</th>
              <th>자동 청산 관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredPositions.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '28px', color: '#64748b', fontSize: '13px' }}>
                  {activeTradeMode === 'REAL'
                    ? '💰 현재 실전 보유 중인 종목이 없습니다. (토스증권 실전 계좌 자동 감시 진행 중)'
                    : '🧪 현재 가상 보유 중인 종목이 없습니다. (키움 시세 자동 감시 진행 중)'}
                </td>
              </tr>
            ) : (
              filteredPositions.map((pos) => {
                const isUp = pos.unrealizedProfitKrw > 0;
                const isDown = pos.unrealizedProfitKrw < 0;
                const formattedQty = Number(pos.qty) % 1 === 0
                  ? `${pos.qty.toLocaleString()}주`
                  : `${Number(pos.qty).toFixed(6)}주`;

                return (
                  <tr key={pos.id}>
                    <td style={{ fontWeight: 600 }}>
                      {pos.stock_name} ({pos.stock_code})
                    </td>
                    <td>
                      <span className={`badge-mode ${pos.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                        {pos.trade_mode === 'REAL' ? '💰 실전' : '🧪 가상'}
                      </span>
                    </td>
                    <td>{formattedQty}</td>
                    <td>{pos.avg_buy_price?.toLocaleString()}원</td>
                    <td style={{ fontWeight: 600 }}>{pos.currentPrice?.toLocaleString()}원</td>
                    <td>{Math.round(pos.evalAmount || 0).toLocaleString()}원</td>
                    <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                      {isUp ? '+' : ''}{Math.round(pos.unrealizedProfitKrw || 0).toLocaleString()}원
                    </td>
                    <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                      {isUp ? '+' : ''}{pos.unrealizedProfitPct}%
                    </td>
                    <td style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {new Date(pos.created_at).toLocaleString()}
                    </td>
                    <td>
                      <span className="status-pill green" style={{ fontSize: '11px', padding: '3px 8px' }}>
                        ● 자동 익절/손절 감시중
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
