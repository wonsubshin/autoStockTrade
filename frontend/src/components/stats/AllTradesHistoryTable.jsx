import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';

export default function AllTradesHistoryTable({ bots = [] }) {
  const [trades, setTrades] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    totalCount: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(false);

  // Filters (오직 실제 거래 'REAL'만 조회)
  const [botFilter, setBotFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'CLOSED' | 'HOLDING'
  const [profitFilter, setProfitFilter] = useState('ALL'); // 'ALL' | 'PROFIT' | 'LOSS'
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const tableTopRef = useRef(null);

  // Fetch real trades only from API with server-side pagination
  const fetchTrades = useCallback(async (pageToFetch = pagination.page) => {
    setLoading(true);
    try {
      const params = {
        mode: 'REAL', // 가상 매매 제외, 실제 거래만 조회
        page: pageToFetch,
        limit: 50,
      };
      if (botFilter !== 'ALL') params.botId = botFilter;
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (profitFilter !== 'ALL') params.profitType = profitFilter;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const res = await api.getTrades(params);
      setTrades(res.trades || []);
      if (res.pagination) {
        setPagination(res.pagination);
      }
    } catch (err) {
      console.error('[AllTradesHistoryTable] 실전 거래 내역 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [botFilter, statusFilter, profitFilter, searchTerm, pagination.page]);

  // Initial and filter change effect
  useEffect(() => {
    fetchTrades(1);
  }, [botFilter, statusFilter, profitFilter, searchTerm]);

  // Page change handler
  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === pagination.page) return;
    fetchTrades(newPage);
    if (tableTopRef.current) {
      tableTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchTerm(searchInput);
  };

  const handleSearchReset = () => {
    setSearchInput('');
    setSearchTerm('');
  };

  // Generate pagination buttons window
  const getPaginationWindow = () => {
    const { page, totalPages } = pagination;
    const maxButtons = 7;
    let start = Math.max(1, page - Math.floor(maxButtons / 2));
    let end = start + maxButtons - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - maxButtons + 1);
    }
    const pages = [];
    for (let p = start; p <= end; p++) {
      pages.push(p);
    }
    return pages;
  };

  const startRecord = pagination.totalCount > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const endRecord = Math.min(pagination.page * pagination.limit, pagination.totalCount);

  // 실전 봇 필터링 (is_real_running 또는 실전 할당된 봇)
  const realBots = bots.filter((b) => b.is_real_running || b.trade_mode === 'REAL' || b.selected_real);
  const displayBots = realBots.length > 0 ? realBots : bots;

  return (
    <div className="board-card" ref={tableTopRef} style={{ marginTop: '24px' }}>
      {/* Title & Stats Summary */}
      <div className="card-title-row" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="card-title" style={{ fontSize: '16px' }}>
            📜 실전 매매 체결 및 실현 손익 내역
          </div>
          <span
            className="badge-mode real"
            style={{
              fontSize: '11px',
              padding: '3px 10px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span className="mode-pulse-dot" style={{ width: '6px', height: '6px', background: '#ef4444' }}></span>
            토스증권 실계좌 실제 거래
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              fontWeight: 700,
            }}
          >
            한 페이지 50건 페이징
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>
            실전 거래 <strong style={{ color: '#f1f5f9' }}>{pagination.totalCount.toLocaleString()}</strong>건
            {pagination.totalCount > 0 && ` 중 ${startRecord.toLocaleString()}~${endRecord.toLocaleString()}건`}
            {' '}(페이지 {pagination.page} / {pagination.totalPages || 1})
          </span>
          <button
            className="btn-action"
            style={{ padding: '4px 10px', fontSize: '11.5px', height: '28px' }}
            onClick={() => fetchTrades(pagination.page)}
            disabled={loading}
          >
            {loading ? '조회중...' : '🔄 새로고침'}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Bot Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>담당 봇:</span>
            <select
              className="custom-select"
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                backgroundColor: '#0b0f19',
                color: '#e2e8f0',
                border: '1px solid #1e293b',
                borderRadius: '6px',
                maxWidth: '220px',
              }}
              value={botFilter}
              onChange={(e) => setBotFilter(e.target.value)}
            >
              <option value="ALL">전체 실전 봇</option>
              {displayBots.map((b) => (
                <option key={b.bot_id} value={b.bot_id}>
                  {b.nickname ? `[${b.nickname}] ${b.name}` : b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>체결상태:</span>
            <select
              className="custom-select"
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                backgroundColor: '#0b0f19',
                color: '#e2e8f0',
                border: '1px solid #1e293b',
                borderRadius: '6px',
              }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">전체 상태</option>
              <option value="CLOSED">청산완료 (실현손익 확정)</option>
              <option value="HOLDING">보유중 (미청산)</option>
            </select>
          </div>

          {/* Profit / Loss Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>손익 구분:</span>
            <select
              className="custom-select"
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                backgroundColor: '#0b0f19',
                color: profitFilter === 'PROFIT' ? '#34d399' : profitFilter === 'LOSS' ? '#f87171' : '#e2e8f0',
                border: profitFilter === 'PROFIT' ? '1px solid rgba(16, 185, 129, 0.45)' : profitFilter === 'LOSS' ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #1e293b',
                borderRadius: '6px',
                fontWeight: profitFilter !== 'ALL' ? 700 : 500,
              }}
              value={profitFilter}
              onChange={(e) => setProfitFilter(e.target.value)}
            >
              <option value="ALL">전체 손익 (수익+손해)</option>
              <option value="PROFIT">📈 수익 거래만 (+)</option>
              <option value="LOSS">📉 손해 거래만 (-)</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="text"
            placeholder="종목명 또는 종목코드 검색"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              padding: '5px 10px',
              fontSize: '12px',
              backgroundColor: '#0b0f19',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              width: '190px',
            }}
          />
          <button
            type="submit"
            className="btn-action"
            style={{ padding: '4px 10px', fontSize: '11.5px', height: '28px' }}
          >
            검색
          </button>
          {searchTerm && (
            <button
              type="button"
              className="btn-action"
              style={{ padding: '4px 8px', fontSize: '11px', height: '28px', color: '#94a3b8' }}
              onClick={handleSearchReset}
            >
              ✕ 초기화
            </button>
          )}
        </form>
      </div>

      {/* Table Content */}
      <div className="table-wrapper" style={{ overflowX: 'auto', minHeight: '240px' }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>ID</th>
              <th>담당 봇</th>
              <th>종목명 (종목코드)</th>
              <th>매수단가 / 체결수량 (총매수금)</th>
              <th>매도단가 / 체결수량</th>
              <th>제세공과금</th>
              <th>매수체결시각</th>
              <th>매도체결시각</th>
              <th>실현손익금 (수익률)</th>
              <th style={{ width: '85px' }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                  <div style={{ fontSize: '20px', marginBottom: '8px' }}>⏳</div>
                  실전 매매 데이터를 로딩 중입니다...
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>📭</div>
                  조회 조건에 해당하는 실제 거래(실전 체결) 내역이 없습니다.
                </td>
              </tr>
            ) : (
              trades.map((t) => {
                const isUp = Number(t.profit_krw || 0) > 0;
                const isDown = Number(t.profit_krw || 0) < 0;
                const botLabel = t.bot_nickname || t.bot_name || t.bot_id;

                return (
                  <tr key={t.id}>
                    <td style={{ fontSize: '11.5px', color: '#64748b' }}>#{t.id}</td>
                    <td>
                      <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '12px' }}>
                        {botLabel}
                      </div>
                      {t.bot_nickname && t.bot_name && t.bot_nickname !== t.bot_name && (
                        <div style={{ fontSize: '10.5px', color: '#64748b' }}>{t.bot_name}</div>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {t.stock_name} <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>({t.stock_code})</span>
                    </td>
                    <td>
                      <div>{Number(t.buy_price || 0).toLocaleString()}원 / {t.buy_qty}주</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>({Number(t.buy_amount || 0).toLocaleString()}원)</div>
                    </td>
                    <td>
                      {t.sell_price ? (
                        <div>{Number(t.sell_price || 0).toLocaleString()}원 / {t.sell_qty}주</div>
                      ) : (
                        <span style={{ color: '#64748b' }}>-</span>
                      )}
                    </td>
                    <td style={{ fontSize: '11.5px' }}>
                      {Number(t.fee_and_tax || 0).toLocaleString()}원
                    </td>
                    <td style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {t.buy_date ? t.buy_date.slice(0, 16).replace('T', ' ') : '-'}
                    </td>
                    <td style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {t.sell_date ? t.sell_date.slice(0, 16).replace('T', ' ') : '-'}
                    </td>
                    <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'} style={{ fontWeight: 600 }}>
                      {t.profit_krw !== null && t.profit_krw !== undefined ? (
                        <>
                          {isUp ? '+' : ''}{Number(t.profit_krw || 0).toLocaleString()}원
                          <div style={{ fontSize: '11px' }}>
                            ({isUp ? '+' : ''}{Number(t.profit_pct || 0).toFixed(2)}%)
                          </div>
                        </>
                      ) : (
                        <span style={{ color: '#64748b' }}>-</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: t.status === 'CLOSED' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: t.status === 'CLOSED' ? '#60a5fa' : '#fbbf24',
                          fontWeight: 700,
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

      {/* Pagination Footer (50 Items Per Page) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '16px 8px 6px 8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          한 페이지에 <strong>50건</strong>씩 표시 | 전체 실전 거래 {pagination.totalCount.toLocaleString()}건
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* First Page Button */}
          <button
            className="btn-action"
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              height: '30px',
              opacity: pagination.page === 1 ? 0.4 : 1,
              cursor: pagination.page === 1 ? 'not-allowed' : 'pointer',
            }}
            disabled={pagination.page === 1}
            onClick={() => handlePageChange(1)}
            title="첫 페이지"
          >
            « 처음
          </button>

          {/* Prev Page Button */}
          <button
            className="btn-action"
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              height: '30px',
              opacity: pagination.page === 1 ? 0.4 : 1,
              cursor: pagination.page === 1 ? 'not-allowed' : 'pointer',
            }}
            disabled={pagination.page === 1}
            onClick={() => handlePageChange(pagination.page - 1)}
            title="이전 페이지"
          >
            ‹ 이전
          </button>

          {/* Page Number Buttons */}
          {getPaginationWindow().map((p) => {
            const isCurrent = p === pagination.page;
            return (
              <button
                key={p}
                style={{
                  minWidth: '32px',
                  height: '30px',
                  padding: '0 8px',
                  fontSize: '12px',
                  fontWeight: isCurrent ? 800 : 500,
                  borderRadius: '6px',
                  border: isCurrent ? '1px solid #ef4444' : '1px solid #1e293b',
                  backgroundColor: isCurrent ? '#dc2626' : '#0f172a',
                  color: isCurrent ? '#ffffff' : '#cbd5e1',
                  cursor: isCurrent ? 'default' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => handlePageChange(p)}
              >
                {p}
              </button>
            );
          })}

          {/* Next Page Button */}
          <button
            className="btn-action"
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              height: '30px',
              opacity: pagination.page >= pagination.totalPages ? 0.4 : 1,
              cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
            }}
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => handlePageChange(pagination.page + 1)}
            title="다음 페이지"
          >
            다음 ›
          </button>

          {/* Last Page Button */}
          <button
            className="btn-action"
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              height: '30px',
              opacity: pagination.page >= pagination.totalPages ? 0.4 : 1,
              cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
            }}
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => handlePageChange(pagination.totalPages)}
            title="마지막 페이지"
          >
            끝 »
          </button>
        </div>
      </div>
    </div>
  );
}
