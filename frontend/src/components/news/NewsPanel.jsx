import React from 'react';

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
  onStopAiNews,
}) {
  const TAG_OPTIONS = [
    '', '#반도체', '#2차전지', '#바이오', '#자동차', '#AI/로봇',
    '#실적/수출', '#외국인수급', '#공시/계약',
  ];

  return (
    <div className="space-y-6">
      {/* AI News Briefing Stream Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-lg">🤖</span>
            <h3 className="font-bold text-white text-base">Gemini 2.5 Flash 증시 인텔리전스 심층 리포트</h3>
          </div>
          <div>
            {isAiNewsStreaming ? (
              <button
                onClick={onStopAiNews}
                className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition"
              >
                중지
              </button>
            ) : (
              <button
                onClick={onStartAiNews}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-sm"
              >
                AI 분석 리포트 생성
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 text-xs text-slate-300 leading-relaxed min-h-[90px] whitespace-pre-wrap">
          {aiNewsText || '현재 수집된 증시 뉴스와 공시를 바탕으로 Gemini AI가 퀀트 투자 관점의 심층 리포트를 생성합니다.'}
        </div>
      </div>

      {/* News Sentiment Counts Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-center">
          <div className="text-slate-400 text-xs">수집 뉴스 총계</div>
          <div className="text-xl font-black text-white mt-0.5">{newsCounts.total}건</div>
        </div>
        <div className="bg-slate-900/80 border border-rose-500/30 rounded-xl p-3.5 text-center">
          <div className="text-rose-400 text-xs">호재 (Bullish)</div>
          <div className="text-xl font-black text-rose-300 mt-0.5">{newsCounts.bullish}건</div>
        </div>
        <div className="bg-slate-900/80 border border-blue-500/30 rounded-xl p-3.5 text-center">
          <div className="text-blue-400 text-xs">악재 (Bearish)</div>
          <div className="text-xl font-black text-blue-300 mt-0.5">{newsCounts.bearish}건</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-center">
          <div className="text-slate-400 text-xs">중립 (Neutral)</div>
          <div className="text-xl font-black text-slate-300 mt-0.5">{newsCounts.neutral}건</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <input
            type="text"
            placeholder="뉴스 제목, 키워드 검색..."
            value={newsQuery}
            onChange={(e) => setNewsQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onFetchNews(1)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs w-52 focus:outline-none focus:border-blue-500"
          />

          <select
            value={selectedTag}
            onChange={(e) => {
              setSelectedTag(e.target.value);
            }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs"
          >
            <option value="">전체 테마</option>
            {TAG_OPTIONS.filter(Boolean).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-white text-xs"
          />
          <span className="text-slate-500 text-xs">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-white text-xs"
          />

          <button
            onClick={() => onFetchNews(1)}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition"
          >
            검색
          </button>
        </div>

        <button
          onClick={onRefreshNews}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 flex items-center space-x-1"
        >
          <span>🔄</span>
          <span>뉴스 수집 갱신</span>
        </button>
      </div>

      {/* News Items List */}
      <div className="space-y-3">
        {newsList.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
            조건에 일치하는 뉴스가 없습니다.
          </div>
        ) : (
          newsList.map((item) => {
            const isBull = item.sentiment === 'BULLISH';
            const isBear = item.sentiment === 'BEARISH';

            return (
              <div
                key={item.id || item.link}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-400">{item.source}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-500">{new Date(item.published_at).toLocaleString()}</span>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    isBull
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : isBear
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {item.sentiment}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white hover:text-blue-400 transition">
                  <a href={item.link} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                </h4>

                {item.summary && (
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {item.summary}
                  </p>
                )}

                {item.keywords && (
                  <div className="text-[11px] text-slate-500">
                    {item.keywords}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {newsPagination.totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2 pt-2">
          <button
            onClick={() => onFetchNews(Math.max(1, newsPagination.page - 1))}
            disabled={newsPagination.page <= 1}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40 text-xs"
          >
            이전
          </button>
          <span className="text-xs text-slate-400">
            {newsPagination.page} / {newsPagination.totalPages}
          </span>
          <button
            onClick={() => onFetchNews(Math.min(newsPagination.totalPages, newsPagination.page + 1))}
            disabled={newsPagination.page >= newsPagination.totalPages}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40 text-xs"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
