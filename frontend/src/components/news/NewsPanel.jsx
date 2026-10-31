import React, { useState } from 'react';

export default function NewsPanel({
  newsList,
  newsCounts,
  newsPagination,
  newsQuery,
  setNewsQuery,
  selectedTag,
  setSelectedTag,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onFetchNews,
  onRefreshNews,
  isAiNewsStreaming,
  aiNewsText,
  onStartAiNews,
}) {
  const [isAccordionOpen, setIsAccordionOpen] = useState(true);

  const POPULAR_TAGS = [
    '#반도체', '#2차전지', '#바이오', '#AI/로봇', '#자동차',
    '#실적발표', '#금리/연준', '#환율', '#외국인수급', '#공시/계약',
  ];

  return (
    <div>
      <div className="section-header">
        <div className="section-title">📰 국내 증시 뉴스 & 실시간 AI 인텔리전스</div>
        <button className="btn-action" onClick={onRefreshNews}>
          🔄 최신 증시뉴스 즉시 수집
        </button>
      </div>

      {/* Collapsible Accordion: AI News Intelligence Box */}
      <div className="collapsible-box">
        <div
          className="collapsible-header"
          onClick={() => setIsAccordionOpen(!isAccordionOpen)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '18px' }}>🤖</span>
            <span style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>
              Gemini 2.5 Flash 증시 뉴스 종합 시황 AI 분석
            </span>
            <span className="badge-mode real" style={{ fontSize: '11px' }}>
              호재 {newsCounts.bullish}건 / 악재 {newsCounts.bearish}건 / 중립 {newsCounts.neutral}건
            </span>
          </div>
          <button
            className="btn-action"
            style={{ padding: '4px 10px', fontSize: '12px' }}
            onClick={(e) => {
              e.stopPropagation();
              setIsAccordionOpen(!isAccordionOpen);
            }}
          >
            {isAccordionOpen ? '▲ 접기' : '▼ 펼치기'}
          </button>
        </div>

        {isAccordionOpen && (
          <div className="collapsible-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                수집된 {newsCounts.total}건의 증시 뉴스와 시장 수급을 AI가 실시간 종합 분석합니다.
              </div>
              <button
                className="btn-action success"
                onClick={onStartAiNews}
                disabled={isAiNewsStreaming}
              >
                {isAiNewsStreaming ? '🤖 AI 스트리밍 분석 중...' : '🤖 AI 분석하기'}
              </button>
            </div>
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                padding: '16px',
                borderRadius: '8px',
                fontSize: '13.5px',
                lineHeight: '1.7',
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                minHeight: '100px',
              }}
            >
              {aiNewsText || '상단의 [🤖 AI 분석하기] 버튼을 누르면 실시간 시황 보고서가 생성됩니다.'}
              {isAiNewsStreaming && <span className="cursor-blink">|</span>}
            </div>
          </div>
        )}
      </div>

      {/* News Filters & Search */}
      <div className="board-card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            className="input-field"
            style={{ width: '160px', padding: '8px 12px', fontSize: '13px' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span style={{ color: '#64748b' }}>~</span>
          <input
            type="date"
            className="input-field"
            style={{ width: '160px', padding: '8px 12px', fontSize: '13px' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />

          <input
            type="text"
            className="input-field"
            style={{ flex: 1, minWidth: '220px', padding: '8px 12px', fontSize: '13px' }}
            placeholder="통합 검색 (기사 제목, 요약, 언론사, 종목명)..."
            value={newsQuery}
            onChange={(e) => setNewsQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onFetchNews(1)}
          />

          <button
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '13px' }}
            onClick={() => onFetchNews(1)}
          >
            검색
          </button>
          <button
            className="btn-action"
            style={{ padding: '8px 14px', fontSize: '13px' }}
            onClick={() => {
              setNewsQuery('');
              setSelectedTag('');
              setStartDate('');
              setEndDate('');
              setTimeout(() => onFetchNews(1), 50);
            }}
          >
            초기화
          </button>
        </div>

        {/* Popular Tag Badges */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              className={`filter-badge-btn ${selectedTag === tag ? 'active' : ''}`}
              onClick={() => {
                const nextTag = selectedTag === tag ? '' : tag;
                setSelectedTag(nextTag);
                setTimeout(() => onFetchNews(1), 50);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* News Board Table (Strict 48px Fixed Row Height) */}
      <div className="board-card" style={{ padding: '0', overflow: 'hidden' }}>
        <table className="news-board-table">
          <thead>
            <tr>
              <th style={{ width: '100px' }}>감성구분</th>
              <th style={{ width: '140px' }}>테마 태그</th>
              <th>기사 제목 (클릭 시 새 탭 원문 이동)</th>
              <th style={{ width: '110px' }}>언론사</th>
              <th style={{ width: '140px' }}>보도일시</th>
            </tr>
          </thead>
          <tbody>
            {newsList.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', height: '100px', color: '#64748b' }}>
                  조회된 증시 뉴스가 없습니다.
                </td>
              </tr>
            ) : (
              newsList.map((n) => (
                <tr key={n.id}>
                  <td>
                    <span className={`sentiment-badge ${n.sentiment}`}>
                      {n.sentiment === 'BULLISH' ? '▲ 호재' : n.sentiment === 'BEARISH' ? '▼ 악재' : '● 중립'}
                    </span>
                  </td>
                  <td className="cell-ellipsis">
                    <span className="news-tag">{n.keywords || '#국내증시'}</span>
                  </td>
                  <td className="cell-ellipsis">
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="news-title-link"
                      title={`[${n.title}]\n\n${n.summary || ''}`}
                    >
                      {n.title}
                    </a>
                  </td>
                  <td className="cell-ellipsis" style={{ color: '#94a3b8' }}>{n.source}</td>
                  <td style={{ color: '#64748b', fontSize: '12px' }}>
                    {n.published_at ? n.published_at.slice(0, 16).replace('T', ' ') : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="pagination-container">
        <button
          className="page-btn"
          disabled={newsPagination.page <= 1}
          onClick={() => onFetchNews(1)}
        >
          « 처음
        </button>
        <button
          className="page-btn"
          disabled={newsPagination.page <= 1}
          onClick={() => onFetchNews(newsPagination.page - 1)}
        >
          ‹ 이전
        </button>

        {Array.from({ length: Math.min(7, newsPagination.totalPages) }, (_, i) => {
          const startP = Math.max(1, Math.min(newsPagination.page - 3, newsPagination.totalPages - 6));
          const pageNum = startP + i;
          if (pageNum > newsPagination.totalPages) return null;
          return (
            <button
              key={pageNum}
              className={`page-btn ${newsPagination.page === pageNum ? 'active' : ''}`}
              onClick={() => onFetchNews(pageNum)}
            >
              {pageNum}
            </button>
          );
        })}

        <button
          className="page-btn"
          disabled={newsPagination.page >= newsPagination.totalPages}
          onClick={() => onFetchNews(newsPagination.page + 1)}
        >
          다음 ›
        </button>
        <button
          className="page-btn"
          disabled={newsPagination.page >= newsPagination.totalPages}
          onClick={() => onFetchNews(newsPagination.totalPages)}
        >
          마지막 »
        </button>
      </div>
    </div>
  );
}
