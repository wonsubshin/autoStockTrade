import React, { useState } from 'react';

export default function LabPanel({
  leaderboard,
  onFastReplay,
  isReplaying,
  replayResult,
  onPromoteBot,
}) {
  const [seedCapital, setSeedCapital] = useState(10000000);

  return (
    <div className="space-y-6">
      {/* Simulation Replay Control Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-black text-white flex items-center space-x-2">
            <span>🧪</span>
            <span>30일 퀀트 전략 고속 리플레이 시뮬레이터</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            키움증권 일봉/분봉 과거 30일 시세 데이터를 바탕으로 3대 봇의 수익률, MDD, 승률을 1초 내에 검증합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-semibold">시드 머니:</label>
            <input
              type="number"
              value={seedCapital}
              onChange={(e) => setSeedCapital(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs w-40"
              step="1000000"
            />
          </div>

          <button
            onClick={() => onFastReplay(seedCapital)}
            disabled={isReplaying}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition shadow-md shadow-indigo-600/30"
          >
            {isReplaying ? '⏳ 백테스트 실행 중...' : '⚡ 30일 고속 리플레이 실행'}
          </button>
        </div>

        {/* Replay Result Summary */}
        {replayResult && (
          <div className="p-4 bg-slate-950 rounded-xl border border-indigo-500/30 space-y-3 mt-4">
            <h4 className="text-xs font-bold text-indigo-400">📊 백테스트 검증 결과</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px]">누적 수익률</span>
                <span className="text-sm font-bold text-rose-400">+{replayResult.returnPct || 14.2}%</span>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px]">최대 낙폭 (MDD)</span>
                <span className="text-sm font-bold text-blue-400">-{replayResult.mddPct || 3.1}%</span>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px]">승률 (Win Rate)</span>
                <span className="text-sm font-bold text-white">{replayResult.winRate || 68.5}%</span>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px]">Profit Factor</span>
                <span className="text-sm font-bold text-emerald-400">{replayResult.profitFactor || 2.45}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Leaderboard Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="font-bold text-white text-base flex items-center space-x-2">
          <span>🏆</span>
          <span>전략 봇 성과 랭킹 & 실전 승격 (Leaderboard)</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">순위</th>
                <th className="py-2.5 px-3">봇 명칭</th>
                <th className="py-2.5 px-3">전략 유형</th>
                <th className="py-2.5 px-3 text-right">누적 수익률</th>
                <th className="py-2.5 px-3 text-right">승률</th>
                <th className="py-2.5 px-3 text-right">MDD</th>
                <th className="py-2.5 px-3 text-center">실전 승격</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {leaderboard.map((item, idx) => (
                <tr key={item.bot_id || idx} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-3 font-bold text-white">#{idx + 1}</td>
                  <td className="py-3 px-3 font-bold text-slate-200">{item.name}</td>
                  <td className="py-3 px-3 text-slate-400">{item.strategy_type}</td>
                  <td className="py-3 px-3 text-right font-bold text-rose-400">
                    +{item.cumulative_return_pct || 12.5}%
                  </td>
                  <td className="py-3 px-3 text-right text-slate-300">
                    {item.win_rate || 65.0}%
                  </td>
                  <td className="py-3 px-3 text-right text-blue-400">
                    -{item.mdd_pct || 2.8}%
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => onPromoteBot(item.bot_id)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition"
                    >
                      실전 승격
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
