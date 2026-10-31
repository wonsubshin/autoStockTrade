import React from 'react';

export default function MarketBanner({ healthData }) {
  const regime = healthData?.marketRegime;
  const hybrid = healthData?.hybridModel;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-center space-x-2">
          <span className="text-slate-400 font-semibold">코스피:</span>
          <span className="text-white font-bold">{regime?.kospiIndex?.toLocaleString() || '-'} pt</span>
          <span className="text-[11px] text-slate-500">(20MA {regime?.kospi20MA?.toLocaleString() || '-'})</span>
        </div>

        <div className="h-3 w-px bg-slate-800 hidden md:block"></div>

        <div className="flex items-center space-x-2">
          <span className="text-slate-400 font-semibold">코스닥:</span>
          <span className="text-white font-bold">{regime?.kosdaqIndex?.toLocaleString() || '-'} pt</span>
          <span className="text-[11px] text-slate-500">(60MA {regime?.kosdaq60MA?.toLocaleString() || '-'})</span>
        </div>

        <div className="h-3 w-px bg-slate-800 hidden md:block"></div>

        <div className="flex items-center space-x-1.5">
          <span className="text-slate-400 font-semibold">시장 체제:</span>
          <span className="font-bold text-emerald-400">
            {regime?.statusText || '정상 전략 가동 중'}
          </span>
        </div>
      </div>

      {/* Hybrid Intelligence Badge */}
      <div className="flex items-center space-x-2 text-[11px]">
        <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-950/50 border border-indigo-500/30 text-indigo-300">
          <span>🤖</span>
          <span className="font-semibold">Gemini 2.5 Flash 뉴스 추론</span>
        </div>
        <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-300">
          <span>🐍</span>
          <span className="font-semibold">Python 3.12 토스 소수점/온주 체결기</span>
        </div>
      </div>
    </div>
  );
}
