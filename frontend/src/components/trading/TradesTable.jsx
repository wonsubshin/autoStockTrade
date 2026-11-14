import React from 'react';
import { getStrategyFamilyMeta, StrategyFamilyBadge } from '../../utils/strategyFamilies';

export default function TradesTable({
  trades = [],
  activeTradeMode = 'REAL',
  selectedBot = null,
  bots = [],
  onSelectBot = null,
}) {
  const filteredTrades = trades.filter(
    (t) => activeTradeMode === 'ALL' || t.trade_mode === activeTradeMode
  );

  const botTitle = selectedBot
    ? `${selectedBot.name} (${selectedBot.nickname || selectedBot.bot_id})`
    : null;

  return (
    <div className="board-card">
      <div className="card-title-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="card-title">
            📋 체결 및 실현 손익 내역
            {botTitle ? (
              <span style={{ color: '#818cf8', marginLeft: '8px', fontSize: '14px', fontWeight: 700 }}>
                — {botTitle}
              </span>
            ) : (
              <span style={{ fontSize: '13px', color: '#94a3b8', marginLeft: '6px' }}>
                ({activeTradeMode === 'REAL' ? '토스증권 실전 매매' : '가상 아레나'})
              </span>
            )}
          </div>
          {selectedBot && (
            <>
              <StrategyFamilyBadge bot={selectedBot} showCode />
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  fontWeight: 600,
                }}
              >
                개별 봇 전용 내역
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {bots.length > 0 && onSelectBot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>봇 변경:</span>
              <select
                className="custom-select"
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                }}
                value={selectedBot?.bot_id || ''}
                onChange={(e) => onSelectBot(e.target.value)}
              >
                {bots.map((b) => {
                  const fm = getStrategyFamilyMeta(b);
                  return (
                    <option key={b.bot_id} value={b.bot_id}>
                      {`${fm.icon} [${fm.tinyLabel}] ${b.nickname ? `[${b.nickname}] ${b.name}` : b.name}`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
            최근 {filteredTrades.length}건
          </span>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="custom-table">
          <thead>
            <tr>
              <th>매매구분</th>
              <th>종목명 (코드)</th>
              <th>매수단가/수량 (총매수금)</th>
              <th>매도단가/수량</th>
              <th>제세공과금</th>
              <th>매수체결시각</th>
              <th>매도체결시각</th>
              <th>실현손익금 (수익률)</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '36px 20px', color: '#94a3b8', fontSize: '13px', lineHeight: 1.6 }}>
                  {activeTradeMode === 'REAL' ? (
                    <div>
                      <div style={{ fontSize: '26px', marginBottom: '8px' }}>💼</div>
                      <strong style={{ color: '#f1f5f9', fontSize: '14px' }}>
                        {selectedBot ? `[${selectedBot.nickname || selectedBot.name}] ` : ''}토스증권 실전 계좌에서 체결 및 청산 완료된 실현 손익 내역이 없습니다.
                      </strong>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                        선택된 봇이 알고리즘 전략 조건에 따라 매수 및 청산을 집행하며, 실제 거래 완료 시 정확한 실현 손익이 이곳에 개별 집계됩니다.
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '24px', marginBottom: '6px' }}>🧪</div>
                      <strong style={{ color: '#f1f5f9' }}>
                        {selectedBot ? `[${selectedBot.nickname || selectedBot.name}] ` : ''}체결 완료된 가상 모의 거래 내역이 없습니다.
                      </strong>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filteredTrades.map((t) => {
                const isUp = (t.profit_krw || 0) > 0;
                const isDown = (t.profit_krw || 0) < 0;
                return (
                  <tr key={t.id}>
                    <td>
                      <span className={`badge-mode ${t.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                        {t.trade_mode === 'REAL' ? '💰 실전' : '🧪 가상'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{t.stock_name} ({t.stock_code})</td>
                    <td>{Number(t.buy_price || 0).toLocaleString()}원 / {t.buy_qty}주 ({Number(t.buy_amount || 0).toLocaleString()}원)</td>
                    <td>
                      {t.sell_price ? `${Number(t.sell_price || 0).toLocaleString()}원 / ${t.sell_qty}주` : '-'}
                    </td>
                    <td>{Number(t.fee_and_tax || 0).toLocaleString()}원</td>
                    <td style={{ fontSize: '11px', color: '#94a3b8' }}>{t.buy_date ? t.buy_date.slice(0, 16).replace('T', ' ') : '-'}</td>
                    <td style={{ fontSize: '11px', color: '#94a3b8' }}>{t.sell_date ? t.sell_date.slice(0, 16).replace('T', ' ') : '-'}</td>
                    <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                      {t.profit_krw !== null && t.profit_krw !== undefined ? (
                        <>
                          {isUp ? '+' : ''}{Number(t.profit_krw || 0).toLocaleString()}원
                          <span style={{ fontSize: '11px', marginLeft: '4px' }}>
                            ({isUp ? '+' : ''}{t.profit_pct}%)
                          </span>
                        </>
                      ) : '-'}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: t.status === 'CLOSED' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: t.status === 'CLOSED' ? '#60a5fa' : '#fbbf24',
                        }}
                      >
                        {t.status === 'CLOSED' ? '청산완료' : '보유중'}
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
