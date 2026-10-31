import React from 'react';

export default function PositionsTable({ positions, onSellPosition, activeTradeMode }) {
  const isReal = activeTradeMode === 'REAL';

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-lg">📦</span>
          <h3 className="font-bold text-white text-base">보유 포지션 (Open Positions)</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold">
            {positions.length}건
          </span>
        </div>
        <div className="text-xs text-slate-400">
          실시간 호가 평가 손익 반영
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-xs">
          현재 보유 중인 포지션이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">종목명/코드</th>
                <th className="py-2.5 px-3">모드</th>
                <th className="py-2.5 px-3 text-right">보유수량</th>
                <th className="py-2.5 px-3 text-right">매수단가</th>
                <th className="py-2.5 px-3 text-right">현재가</th>
                <th className="py-2.5 px-3 text-right">평가금액</th>
                <th className="py-2.5 px-3 text-right">평가손익</th>
                <th className="py-2.5 px-3 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {positions.map((pos) => {
                const profit = pos.unrealizedProfitKrw || 0;
                const profitPct = pos.unrealizedProfitPct || 0;
                const isPositive = profit > 0;
                const isNegative = profit < 0;
                const isPosReal = pos.trade_mode === 'REAL';

                // Display fractional quantity nicely
                const formattedQty = Number(pos.qty) % 1 === 0
                  ? `${pos.qty}주`
                  : `${Number(pos.qty).toFixed(6)}주 (소수점)`;

                return (
                  <tr key={pos.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-3">
                      <div className="font-bold text-white">{pos.stock_name}</div>
                      <div className="text-[11px] text-slate-500">{pos.stock_code}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isPosReal
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        {isPosReal ? '실전' : '가상'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-200">
                      {formattedQty}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      {pos.avg_buy_price?.toLocaleString()}원
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-white">
                      {pos.currentPrice?.toLocaleString()}원
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-200">
                      {Math.round(pos.evalAmount || 0).toLocaleString()}원
                    </td>
                    <td className="py-3 px-3 text-right font-bold">
                      <div className={isPositive ? 'text-rose-400' : isNegative ? 'text-blue-400' : 'text-slate-400'}>
                        {isPositive ? '+' : ''}{Math.round(profit).toLocaleString()}원
                      </div>
                      <div className={`text-[11px] ${isPositive ? 'text-rose-400' : isNegative ? 'text-blue-400' : 'text-slate-500'}`}>
                        ({isPositive ? '+' : ''}{profitPct}%)
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => onSellPosition(pos.id, pos.bot_id)}
                        className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold transition"
                      >
                        청산
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
