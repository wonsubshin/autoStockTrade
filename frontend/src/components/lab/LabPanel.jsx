import React, { useState, useEffect } from 'react';
import PositionsTable from '../trading/PositionsTable';
import TradesTable from '../trading/TradesTable';

export default function LabPanel({
  bots = [],
  virtualPositions = [],
  virtualTrades = [],
  onSelectRealBots,
  onFastReplay,
  onResetVirtualAll,
  isReplaying = false,
  replayResult = null,
  onRefreshLeaderboard,
}) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    const initSelected = bots
      .filter((b) => Number(b.is_real_selected) === 1)
      .map((b) => b.bot_id);
    if (initSelected.length > 0) {
      setSelectedIds(initSelected);
    } else if (bots.length >= 3) {
      // Default initial selection: exactly 3 bots
      setSelectedIds([bots[0].bot_id, bots[1].bot_id, bots[2].bot_id]);
    }
  }, [bots]);

  const toggleBotSelection = (botId) => {
    if (selectedIds.includes(botId)) {
      setSelectedIds(selectedIds.filter((id) => id !== botId));
    } else {
      if (selectedIds.length >= 3) {
        alert('실전 거래 담당 봇은 정확히 3개까지만 선택할 수 있습니다. 기존 선택된 봇을 체크 해제한 후 다시 선택해주세요.');
        return;
      }
      setSelectedIds([...selectedIds, botId]);
    }
  };

  const rankedBots = [...bots].sort(
    (a, b) => Number(b.virtual_return_pct || 0) - Number(a.virtual_return_pct || 0)
  );

  return (
    <div className="virtual-arena-wrap">
      {/* Top Banner Card */}
      <div className="board-card" style={{ borderColor: '#8b5cf6', background: 'linear-gradient(135deg, #101526, #1e1b4b)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                ⚡ 10대 퀀트 봇 상시 가상 경쟁 아레나 (Pure Algorithm Only)
              </h2>
              <span className="badge-live-pulse">
                <span className="mode-pulse-dot virtual" style={{ width: '7px', height: '7px' }}></span>
                24시간 상시 가상 경쟁
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: '#cbd5e1', marginTop: '6px', lineHeight: 1.6, marginBottom: 0 }}>
              • 10개 봇 모두 <strong>Gemini LLM 호출 없이 100% 순수 퀀트 수식 지표</strong>로 24시간 자율 가상 매매를 수행합니다.<br />
              • 실시간 누적 수익률을 확인한 후 <strong>실전을 담당할 3개의 봇을 체크하고 [실전 담당으로 확정]</strong>을 누르면, <strong>[환경설정] 화면으로 이동하여 비율을 설정</strong>하게 됩니다.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn-action success"
              style={{
                fontWeight: 700,
                background: selectedIds.length === 3 ? 'linear-gradient(135deg, #10b981, #059669)' : undefined,
                border: selectedIds.length === 3 ? '1px solid #34d399' : undefined,
              }}
              onClick={() => {
                if (selectedIds.length !== 3) {
                  alert(`실전 거래 담당 봇은 정확히 3개를 선택해야 합니다. (현재 ${selectedIds.length}개 선택됨)`);
                  return;
                }
                onSelectRealBots && onSelectRealBots(selectedIds);
              }}
            >
              ✅ 선택한 3개 봇 실전 담당 확정 및 설정 이동 ({selectedIds.length}/3)
            </button>
            <button
              className="btn-action"
              onClick={onFastReplay}
              disabled={isReplaying}
            >
              {isReplaying ? '⚡ 계산 중...' : '⚡ 30일 고속 시뮬레이션'}
            </button>
            {onRefreshLeaderboard && (
              <button className="btn-action" onClick={onRefreshLeaderboard}>
                🔄 새로고침
              </button>
            )}
            <button className="btn-action danger" onClick={onResetVirtualAll}>
              ⚠️ 가상 전체 초기화
            </button>
          </div>
        </div>
      </div>

      {/* 10 Bots Arena Table */}
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🏆 10대 퀀트 알고리즘 실시간 수익률 리그 리더보드</div>
          <span style={{ fontSize: '12px', color: selectedIds.length === 3 ? '#34d399' : '#f59e0b', fontWeight: 600 }}>
            실전 지정 봇: {selectedIds.length} / 3개 선택됨 {selectedIds.length === 3 ? '✓ 완료' : '(3개 선택 필요)'}
          </span>
        </div>

        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '50px' }}>순위</th>
                <th style={{ width: '140px' }}>실전 담당 선택 (3개)</th>
                <th style={{ width: '110px' }}>가상 거래 상태</th>
                <th>봇 이름 / 퀀트 알고리즘</th>
                <th>가상 평가자산</th>
                <th>누적 수익률</th>
                <th>실현 손익금</th>
                <th>승률 (거래수)</th>
                <th>익절 / 손절</th>
              </tr>
            </thead>
            <tbody>
              {rankedBots.map((bot, idx) => {
                const isChecked = selectedIds.includes(bot.bot_id);
                const ret = Number(bot.virtual_return_pct || 0);
                const pKrw = Number(bot.virtual_profit_krw || 0);
                const isTop1 = idx === 0;

                return (
                  <tr
                    key={bot.bot_id}
                    style={{
                      background: isChecked ? 'rgba(59, 130, 246, 0.08)' : undefined,
                      borderLeft: isChecked ? '3px solid #3b82f6' : '3px solid transparent',
                    }}
                  >
                    <td>
                      <strong style={{ color: isTop1 ? '#fbbf24' : '#94a3b8' }}>
                        {isTop1 ? '👑 1' : `#${idx + 1}`}
                      </strong>
                    </td>
                    <td>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBotSelection(bot.bot_id)}
                          style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
                        />
                        <span style={{ color: isChecked ? '#60a5fa' : '#94a3b8', fontWeight: isChecked ? 700 : 400 }}>
                          {isChecked ? '★ 실전 담당' : '선택'}
                        </span>
                      </label>
                    </td>
                    <td>
                      <span className="status-pill green" style={{ fontSize: '11px', padding: '2px 7px' }}>
                        ● 상시 거래중
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                        {bot.name} <small style={{ color: '#818cf8' }}>({bot.nickname})</small>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        {bot.description}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {Number(bot.virtual_total_assets || 10000000).toLocaleString()}원
                    </td>
                    <td className={ret >= 0 ? 'num-up' : 'num-down'} style={{ fontWeight: 700, fontSize: '13px' }}>
                      {ret >= 0 ? `+${ret.toFixed(2)}%` : `${ret.toFixed(2)}%`}
                    </td>
                    <td className={pKrw >= 0 ? 'num-up' : 'num-down'}>
                      {pKrw >= 0 ? `+${pKrw.toLocaleString()}원` : `${pKrw.toLocaleString()}원`}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{bot.virtual_win_rate || 0}%</span>
                      <small style={{ color: '#94a3b8', marginLeft: '4px' }}>({bot.virtual_trade_count || 0}건)</small>
                    </td>
                    <td style={{ fontSize: '11.5px', color: '#cbd5e1' }}>
                      <span className="num-up">+{bot.take_profit_pct}%</span> / <span className="num-down">-{Math.abs(bot.stop_loss_pct)}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fast Replay Result Box */}
      {replayResult && (
        <div className="board-card" style={{ borderColor: '#3b82f6', background: 'linear-gradient(135deg, #131b2e, #1e293b)', marginBottom: '24px' }}>
          <div className="card-title-row">
            <div className="card-title">⚡ 30영업일 고속 시뮬레이션 성과 리포트</div>
            <span style={{ fontSize: '12px', color: '#60a5fa' }}>평가시각: {new Date(replayResult.evaluatedAt).toLocaleTimeString()}</span>
          </div>
          <div style={{ padding: '14px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', marginBottom: '16px', fontWeight: 600, color: '#93c5fd' }}>
            {replayResult.recommendation}
          </div>
        </div>
      )}

      {/* Real-time Virtual Positions Table */}
      <PositionsTable
        positions={virtualPositions}
        activeTradeMode="VIRTUAL"
      />

      {/* Completed Virtual Trades Table */}
      <TradesTable
        trades={virtualTrades}
        activeTradeMode="VIRTUAL"
      />
    </div>
  );
}
