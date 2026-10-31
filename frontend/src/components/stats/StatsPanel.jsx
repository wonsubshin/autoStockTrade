import React from 'react';

export default function StatsPanel({
  statsData,
  statsPeriodTab,
  setStatsPeriodTab,
  statsModeFilter,
  setStatsModeFilter,
}) {
  const totalProfit = statsData?.totalProfitKrw || 0;
  const totalTrades = statsData?.totalTrades || 0;
  const winRate = statsData?.winRate || 0;
  const timeline = statsData?.timeline || [];
  const stockRanking = statsData?.stockRanking || [];

  return (
    <div className="space-y-6">
      {/* Controls & Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
        {/* Period Tabs */}
        <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {[
            { id: 'daily', label: '일별' },
            { id: 'weekly', label: '주별' },
            { id: 'monthly', label: '월별' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatsPeriodTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                statsPeriodTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Mode Filter */}
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400">통계 대상:</span>
          {['ALL', 'VIRTUAL', 'REAL'].map((m) => (
            <button
              key={m}
              onClick={() => setStatsModeFilter(m)}
              className={`px-2.5 py-1 rounded-lg font-bold border transition ${
                statsModeFilter === m
                  ? 'bg-slate-800 text-white border-slate-600'
                  : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
              }`}
            >
              {m === 'ALL' ? '전체' : m === 'VIRTUAL' ? '가상' : '실전'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400">누적 실현 손익</div>
          <div className={`text-2xl font-black mt-1 ${
            totalProfit > 0 ? 'text-rose-400' : totalProfit < 0 ? 'text-blue-400' : 'text-white'
          }`}>
            {totalProfit > 0 ? '+' : ''}{totalProfit.toLocaleString()}원
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400">총 거래 횟수</div>
          <div className="text-2xl font-black text-white mt-1">
            {totalTrades}회
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400">전체 승률</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            {winRate}%
          </div>
        </div>
      </div>

      {/* Timeline Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm">📅 기간별 손익 추이 ({statsPeriodTab.toUpperCase()})</h3>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2 px-3">기간</th>
                <th className="py-2 px-3 text-right">손익(원)</th>
                <th className="py-2 px-3 text-right">거래수</th>
                <th className="py-2 px-3 text-right">승률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {timeline.map((item) => (
                <tr key={item.period} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-semibold text-white">{item.period}</td>
                  <td className={`py-2.5 px-3 text-right font-bold ${
                    item.profitKrw > 0 ? 'text-rose-400' : item.profitKrw < 0 ? 'text-blue-400' : 'text-slate-400'
                  }`}>
                    {item.profitKrw > 0 ? '+' : ''}{item.profitKrw.toLocaleString()}원
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">{item.tradesCount}건</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-medium">{item.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Ranking Contribution Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm">🥇 종목별 수익 기여도 랭킹</h3>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2 px-3">종목명/코드</th>
                <th className="py-2 px-3 text-right">누적 기여 손익</th>
                <th className="py-2 px-3 text-right">거래수</th>
                <th className="py-2 px-3 text-right">승률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {stockRanking.map((s) => (
                <tr key={s.stockCode} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-semibold text-white">
                    {s.stockName} <span className="text-[11px] text-slate-500 font-normal">({s.stockCode})</span>
                  </td>
                  <td className={`py-2.5 px-3 text-right font-bold ${
                    s.totalProfitKrw > 0 ? 'text-rose-400' : s.totalProfitKrw < 0 ? 'text-blue-400' : 'text-slate-400'
                  }`}>
                    {s.totalProfitKrw > 0 ? '+' : ''}{s.totalProfitKrw.toLocaleString()}원
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">{s.tradesCount}건</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400 font-medium">{s.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
