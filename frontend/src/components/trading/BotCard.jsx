import React from 'react';

export default function BotCard({
  bot,
  isSelected,
  onSelect,
  onToggleRunning,
  onToggleMode,
  onResetVirtual,
  onManualTrade,
  activeTradeMode,
}) {
  const isRunning = bot.is_running === 1;
  const isReal = bot.trade_mode === 'REAL';
  const allocCap = bot.allocated_capital || 0;

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border p-5 transition-all duration-300 cursor-pointer ${
        isSelected
          ? isReal
            ? 'bg-slate-900 border-amber-500/80 shadow-lg shadow-amber-950/30 ring-1 ring-amber-500'
            : 'bg-slate-900 border-blue-500/80 shadow-lg shadow-blue-950/30 ring-1 ring-blue-500'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Bot Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
              isReal ? 'bg-amber-500 text-slate-950' : 'bg-emerald-600 text-white'
            }`}>
              {isReal ? '💰 실전' : '🧪 가상'}
            </span>
            <h3 className="font-bold text-white text-base">{bot.nickname || bot.name}</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{bot.description}</p>
        </div>

        {/* Start / Stop Toggle Switch */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleRunning(bot.bot_id, isRunning ? 'STOP' : 'START');
          }}
          className={`px-3 py-1 rounded-xl text-xs font-black transition ${
            isRunning
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
          }`}
        >
          {isRunning ? '● 가동 중' : '○ 중지됨'}
        </button>
      </div>

      {/* Bot Stats & Allocation */}
      <div className="grid grid-cols-2 gap-2 my-3 p-3 bg-slate-950/60 rounded-xl text-xs">
        <div>
          <span className="text-slate-500 block text-[10px]">배분 예산</span>
          <span className="font-bold text-white text-sm">{allocCap.toLocaleString()}원</span>
          <span className="text-[10px] text-slate-400 ml-1">({Math.round((bot.allocation_ratio || 0.33) * 100)}%)</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">익절/손절</span>
          <span className="font-bold text-slate-200">
            +{bot.take_profit_pct}% / -{bot.stop_loss_pct}%
          </span>
        </div>
      </div>

      {/* Status Message */}
      <div className="text-[11px] text-slate-400 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 line-clamp-1">
        {bot.last_status_msg || '대기 중'}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800/80">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMode(bot.bot_id);
          }}
          className={`text-xs px-2.5 py-1.5 rounded-lg font-bold border transition ${
            isReal
              ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
              : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
          }`}
        >
          {isReal ? '🧪 가상모드로 전환' : '💰 실전모드로 전환'}
        </button>

        {!isReal && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResetVirtual(bot.bot_id);
            }}
            className="text-xs px-2 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 transition"
          >
            초기화
          </button>
        )}
      </div>
    </div>
  );
}
