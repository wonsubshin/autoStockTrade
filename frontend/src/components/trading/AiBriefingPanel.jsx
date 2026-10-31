import React from 'react';

export default function AiBriefingPanel({
  aiBriefingText,
  isStreaming,
  onStartBriefing,
  onStopBriefing,
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-lg">🎙️</span>
          <h3 className="font-bold text-white text-base">Gemini 2.5 Flash 실시간 마켓 브리핑</h3>
          {isStreaming && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isStreaming ? (
            <button
              onClick={onStopBriefing}
              className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition"
            >
              중지
            </button>
          ) : (
            <button
              onClick={onStartBriefing}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-sm"
            >
              생성 시작
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 text-xs text-slate-300 leading-relaxed min-h-[70px] whitespace-pre-wrap">
        {aiBriefingText || '상단의 \'생성 시작\' 버튼을 누르면 Gemini AI가 현재 증시 호가 및 시장 수급을 종합 분석하여 타이프라이터 형태로 브리핑합니다.'}
      </div>
    </div>
  );
}
