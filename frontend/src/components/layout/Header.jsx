import React from 'react';

export default function Header({
  healthData,
  activeMenu,
  setActiveMenu,
  tradingModeFilter,
  setTradingModeFilter,
  onOpenSettings,
  activeTradeMode,
}) {
  const isReal = activeTradeMode === 'REAL';

  return (
    <header className={`border-b transition-colors duration-500 ${
      isReal
        ? 'bg-amber-950/40 border-amber-500/30 shadow-lg shadow-amber-950/20'
        : 'bg-slate-900/80 border-slate-800'
    } backdrop-blur-md sticky top-0 z-40`}>
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Logo & Service Architecture Badge */}
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl font-black shadow-md ${
            isReal
              ? 'bg-amber-500 text-slate-950 shadow-amber-500/30 ring-2 ring-amber-400'
              : 'bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-blue-500/20'
          }`}>
            {isReal ? '💰' : '📈'}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-black text-white tracking-tight">AutoStockTrader</h1>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                isReal
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}>
                {isReal ? '● 실전 매매 가동 중' : '○ 가상 시뮬레이션 모드'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              키움증권(시세) ⨉ Gemini LLM(판단) ⨉ Python/토스(소수점 매매)
            </p>
          </div>
        </div>

        {/* Health Badges & Tunnel Pill */}
        <div className="flex flex-wrap items-center gap-2">
          {healthData?.marketStatus && (
            <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-medium">
              {healthData.marketStatus.badge}
            </span>
          )}
          {healthData?.kiwoomHealth && (
            <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
              healthData.kiwoomHealth.status === 'green'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
            }`}>
              키움: {healthData.kiwoomHealth.label}
            </span>
          )}
          {healthData?.tossHealth && (
            <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
              healthData.tossHealth.status === 'green'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
            }`}>
              토스: {healthData.tossHealth.label}
            </span>
          )}
        </div>

        {/* Navigation Tabs & Global Mode Switch */}
        <div className="flex items-center space-x-3">
          <nav className="flex items-center space-x-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            {[
              { id: 'TRADING', label: '📊 트레이딩' },
              { id: 'LAB', label: '🧪 퀀트 랩' },
              { id: 'STATS', label: '📈 통계' },
              { id: 'NEWS', label: '📰 뉴스' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveMenu(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeMenu === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Mode Switcher Filter */}
          <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setTradingModeFilter('VIRTUAL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                tradingModeFilter === 'VIRTUAL'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🧪 가상
            </button>
            <button
              onClick={() => setTradingModeFilter('REAL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                tradingModeFilter === 'REAL'
                  ? 'bg-amber-500 text-slate-950 font-black shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              💰 실전
            </button>
            <button
              onClick={() => setTradingModeFilter('AUTO')}
              className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                tradingModeFilter === 'AUTO'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              AUTO
            </button>
          </div>

          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-sm transition"
            title="설정 및 예산 관리"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>
  );
}
