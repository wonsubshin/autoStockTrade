import React from 'react';

export default function BudgetBar({ budgetSettings, activeTradeMode, onOpenSettings }) {
  const isReal = activeTradeMode === 'REAL';
  const totalBudget = isReal
    ? (budgetSettings.realTotalBudget || 0)
    : (budgetSettings.virtualTotalBudget || 0);

  const tossCash = budgetSettings.tossAvailableCash || 0;
  const tossTotal = budgetSettings.tossTotalAssetAmount || 0;

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-300 ${
      isReal
        ? 'bg-gradient-to-r from-amber-950/40 to-slate-900 border-amber-500/40 shadow-lg shadow-amber-950/20'
        : 'bg-gradient-to-r from-slate-900 to-slate-900/60 border-slate-800'
    }`}>
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left: Total Budget & Mode */}
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className={`text-xs font-black px-2 py-0.5 rounded ${
              isReal ? 'bg-amber-500 text-slate-950' : 'bg-emerald-600 text-white'
            }`}>
              {isReal ? '💰 실전 운영 예산' : '🧪 가상 시뮬레이션 예산'}
            </span>
            <span className="text-xl font-black text-white">
              {totalBudget.toLocaleString()}원
            </span>
          </div>
          <div className="text-xs text-slate-400">
            {isReal ? (
              <span className="text-amber-300 font-medium">
                토스증권 실계좌 연동 (주문가능 예수금: {tossCash.toLocaleString()}원 / 총자산: {tossTotal.toLocaleString()}원)
              </span>
            ) : (
              <span>가상 모의 계좌 시드 자금 기준 (각 봇별 배분율에 따라 안전 집행)</span>
            )}
          </div>
        </div>

        {/* Right: Allocation Mini Progress & Edit Button */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-end">
          <div className="text-right">
            <div className="text-xs text-slate-400">봇 배분율 총합</div>
            <div className="text-sm font-bold text-white">
              {budgetSettings.bots?.reduce((sum, b) => sum + Math.round((b.allocation_ratio || 0.33) * 100), 0) || 100}%
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 border ${
              isReal
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <span>예산/비율 변경</span>
            <span>⚙️</span>
          </button>
        </div>
      </div>
    </div>
  );
}
