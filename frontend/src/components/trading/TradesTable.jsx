import React from 'react';

export default function TradesTable({ trades }) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-lg">📜</span>
          <h3 className="font-bold text-white text-base">체결 및 거래 내역 (Trade History)</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold">
            {trades.length}건
          </span>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-xs">
          체결 완료된 거래 내역이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">종목명</th>
                <th className="py-2.5 px-3">모드</th>
                <th className="py-2.5 px-3 text-right">매수단가/수량</th>
                <th className="py-2.5 px-3 text-right">매도단가</th>
                <th className="py-2.5 px-3 text-right">실현손익</th>
                <th className="py-2.5 px-3 text-right">수익률</th>
                <th className="py-2.5 px-3 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {trades.map((t) => {
                const profit = t.profit_krw || 0;
                const profitPct = t.profit_pct || 0;
                const isPositive = profit > 0;
                const isNegative = profit < 0;

                return (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-3">
                      <div className="font-bold text-white">{t.stock_name}</div>
                      <div className="text-[11px] text-slate-500">{t.stock_code}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        t.trade_mode === 'REAL'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        {t.trade_mode === 'REAL' ? '실전' : '가상'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      <div>{t.buy_price?.toLocaleString()}원</div>
                      <div className="text-[11px] text-slate-500">{t.buy_qty}주</div>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      {t.sell_price ? `${t.sell_price.toLocaleString()}원` : '-'}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold ${
                      isPositive ? 'text-rose-400' : isNegative ? 'text-blue-400' : 'text-slate-400'
                    }`}>
                      {t.status === 'CLOSED'
                        ? `${isPositive ? '+' : ''}${Math.round(profit).toLocaleString()}원`
                        : '보유 중'}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold ${
                      isPositive ? 'text-rose-400' : isNegative ? 'text-blue-400' : 'text-slate-500'
                    }`}>
                      {t.status === 'CLOSED' ? `${isPositive ? '+' : ''}${profitPct}%` : '-'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        t.status === 'CLOSED'
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {t.status === 'CLOSED' ? '완결' : '보유'}
                      </span>
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
