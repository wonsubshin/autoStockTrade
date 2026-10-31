import React from 'react';

export default function HybridBoard({
  candidateStocks,
  selectedStockCode,
  setSelectedStockCode,
  aiDecisions,
  isAiEvaluating,
  onAiEvaluateAndTrade,
  onManualTradeTest,
  activeTradeMode,
}) {
  const isReal = activeTradeMode === 'REAL';
  const selectedStock = candidateStocks.find((s) => s.code === selectedStockCode) || candidateStocks[0];

  return (
    <div className={`rounded-2xl border p-5 space-y-4 transition-all duration-300 ${
      isReal
        ? 'bg-slate-900/90 border-amber-500/30 shadow-xl'
        : 'bg-slate-900/80 border-slate-800'
    }`}>
      {/* Board Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xl">🤖</span>
            <h2 className="text-base font-black text-white">
              Gemini LLM 실시간 뉴스 감성 분석 & Python Core Executor
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              하이브리드 파이프라인
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gemini AI가 실시간 뉴스와 공시를 분석하여 매매 시그널을 생성하고, Python 실행기가 토스증권 API로 소수점/온주 주문을 집행합니다.
          </p>
        </div>

        {/* Action Controls & Stock Selector */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Candidate Stock Selector */}
          <select
            value={selectedStockCode}
            onChange={(e) => setSelectedStockCode(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-white text-xs font-semibold rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500"
          >
            <optgroup label="🇺🇸 미국 주식 (소수점 금액 매수)">
              {candidateStocks
                .filter((s) => s.market === 'US' || s.isFractional)
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code}) - ${s.basePriceUsd} [소수점]
                  </option>
                ))}
            </optgroup>
            <optgroup label="🇰🇷 국내 주식 (1주 온주 매수)">
              {candidateStocks
                .filter((s) => s.market !== 'US' && !s.isFractional)
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code}) - {s.basePrice?.toLocaleString()}원
                  </option>
                ))}
            </optgroup>
          </select>

          {/* 1-Click AI Evaluate & Trade */}
          <button
            onClick={() => onAiEvaluateAndTrade(true, selectedStockCode)}
            disabled={isAiEvaluating}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-md ${
              isReal
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-amber-500/20'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
            } disabled:opacity-50`}
          >
            <span>{isAiEvaluating ? '⏳ 분석 및 체결 중...' : '🤖 AI 뉴스 분석 & 주문 실행'}</span>
          </button>

          {/* 1-Click Python Manual Test */}
          <button
            onClick={() => onManualTradeTest('BUY', selectedStockCode)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
          >
            ⚡ 수동 테스트 매수
          </button>
        </div>
      </div>

      {/* Selected Stock Quick Summary Pill */}
      {selectedStock && (
        <div className="flex items-center space-x-3 text-xs bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
          <span className="text-slate-400 font-medium">선택 종목:</span>
          <span className="text-white font-bold">{selectedStock.name} ({selectedStock.code})</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">시장:</span>
          <span className="font-semibold text-slate-200">
            {selectedStock.market === 'US' ? '🇺🇸 미국 (NASDAQ/NYSE)' : '🇰🇷 국내 (KOSPI/KOSDAQ)'}
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">주문 방식:</span>
          <span className={`font-bold ${selectedStock.isFractional ? 'text-indigo-400' : 'text-emerald-400'}`}>
            {selectedStock.isFractional ? '💵 소수점 금액 주문 ($10 단위)' : '📦 1주 단위 온주 주문'}
          </span>
        </div>
      )}

      {/* AI Decisions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {aiDecisions.length === 0 ? (
          <div className="col-span-full py-8 text-center text-xs text-slate-500">
            생성된 AI 퀀트 매매 판단이 없습니다. 상단의 'AI 뉴스 분석' 버튼을 눌러보세요.
          </div>
        ) : (
          aiDecisions.slice(0, 6).map((d) => {
            const isBuy = d.action === 'BUY';
            const isSell = d.action === 'SELL';

            return (
              <div
                key={d.id || `${d.symbol}_${d.created_at}`}
                className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-sm">{d.stock_name}</span>
                    <span className="text-[11px] text-slate-400">({d.symbol})</span>
                  </div>
                  <span className={`text-[11px] font-black px-2 py-0.5 rounded ${
                    isBuy
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : isSell
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {d.action}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>감성 지수: <b className={d.sentiment_score > 0 ? 'text-rose-400' : d.sentiment_score < 0 ? 'text-blue-400' : 'text-slate-400'}>{d.sentiment_score > 0 ? `+${d.sentiment_score}` : d.sentiment_score}</b></span>
                  <span>신뢰도: <b className="text-white">{d.confidence}%</b></span>
                </div>

                <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                  {d.reasoning}
                </p>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px] text-slate-500">
                  <span>{d.suggested_order_type === 'AMOUNT_FRACTIONAL' ? '미국 소수점' : '국내 온주'}</span>
                  <span className="text-emerald-400">🐍 {d.executed_by || 'Python'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
