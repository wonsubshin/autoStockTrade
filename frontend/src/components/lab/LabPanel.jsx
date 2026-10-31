import React from 'react';

export default function LabPanel({
  leaderboard,
  onFastReplay,
  isReplaying,
  replayResult,
  onPromoteBot,
  onResetVirtualAll,
  onRefreshLeaderboard,
}) {
  return (
    <div>
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="section-title" style={{ margin: 0 }}>🧪 3대 퀀트 알고리즘 실시간 리더보드</div>
          <span className="badge-live-pulse">
            <span className="mode-pulse-dot virtual" style={{ width: '7px', height: '7px' }}></span>
            실시간 집계 중 (5초 자동 갱신)
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {onRefreshLeaderboard && (
            <button className="btn-action" onClick={onRefreshLeaderboard}>
              🔄 랭킹 즉시 새로고침
            </button>
          )}
          {onResetVirtualAll && (
            <button className="btn-action danger" onClick={onResetVirtualAll}>
              ⚠️ 가상 전체 리셋 및 새로 시작
            </button>
          )}
          <button
            className="btn-action success"
            onClick={onFastReplay}
            disabled={isReplaying}
          >
            {isReplaying ? '⚡ 30일 시뮬레이션 계산 중...' : '⚡ 최근 30일 데이터 즉시 시뮬레이션'}
          </button>
        </div>
      </div>

      {/* Guide Banner */}
      <div
        style={{
          background: 'rgba(30, 41, 59, 0.6)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '20px',
          fontSize: '12px',
          color: '#94a3b8',
          lineHeight: '1.6',
        }}
      >
        💡 <strong>실시간 랭킹 집계 안내</strong>: 가상 리셋 시 지금까지 체결된 모든 거래 기록이 완전히 삭제되며 0건부터 깨끗하게 다시 시작됩니다. 3대 자율 봇이 실시간 시세와 구매 우선순위(국내 온주 ➔ 미국 온주 ➔ 미국 소수점)에 따라 탐색 및 매매를 진행함에 따라, 승률·수익률·손익비 랭킹이 <strong>5초마다 실시간으로 자동 재집계</strong>되어 순위가 변동됩니다.
      </div>

      {/* Top 3 Battle Scorecards */}
      <div className="leaderboard-grid">
        {leaderboard.map((item) => {
          const isRank1 = item.rank === 1;
          const isRank2 = item.rank === 2;
          const hasTrades = item.totalTrades > 0;
          const isProfit = item.cumulativeReturnPct > 0;
          const isLoss = item.cumulativeReturnPct < 0;

          return (
            <div key={item.botId} className={`leader-card ${isRank1 ? 'rank-1' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className={`rank-badge ${isRank1 ? 'gold' : isRank2 ? 'silver' : 'bronze'}`} style={{ margin: 0 }}>
                  {isRank1 ? '👑 1위 (최우수)' : isRank2 ? '🥈 2위' : '🥉 3위'}
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: item.isRunning ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    color: item.isRunning ? '#34d399' : '#94a3b8',
                    border: item.isRunning ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(148, 163, 184, 0.3)',
                  }}
                >
                  {item.isRunning ? '🟢 실시간 가동' : '⚪ 정지'}
                </span>
              </div>

              <div className="leader-name">{item.nickname || item.name}</div>
              <div className="leader-sub">{item.strategyType}</div>

              <div className="leader-stats">
                <div className="lstat-box">
                  <div className="lstat-label">누적 수익률</div>
                  <div className={`lstat-val ${isProfit ? 'num-up' : isLoss ? 'num-down' : ''}`}>
                    {isProfit ? '+' : ''}{item.cumulativeReturnPct}%
                  </div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">승률 (Win Rate)</div>
                  <div className={`lstat-val ${hasTrades ? 'num-up' : ''}`}>
                    {hasTrades ? `${item.winRate}%` : '-'}
                  </div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">손익비 (Profit Factor)</div>
                  <div className="lstat-val">{hasTrades ? item.profitFactor : '-'}</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">최대 낙폭 (MDD)</div>
                  <div className={`lstat-val ${item.mddPct > 0 ? 'num-down' : ''}`}>
                    {item.mddPct > 0 ? `-${item.mddPct}%` : '0%'}
                  </div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">샤프 지수 (Sharpe)</div>
                  <div className="lstat-val">{hasTrades ? item.sharpeRatio : '-'}</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">체결 건수 (보유)</div>
                  <div className="lstat-val" style={{ fontSize: '13px' }}>
                    {hasTrades ? `${item.totalTrades}회` : '0회'}
                    {item.openPositionsCount > 0 ? ` (${item.openPositionsCount}건 보유)` : ''}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px', lineHeight: 1.4 }}>
                상태: {item.lastStatusMsg || '실시간 전략 감시 중'}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px' }}>
                <button
                  className="btn-action success"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => onPromoteBot(item.botId)}
                >
                  🚀 실전 매매 모드로 승격
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fast Replay Result Box */}
      {replayResult && (
        <div className="board-card" style={{ borderColor: '#3b82f6', background: 'linear-gradient(135deg, #131b2e, #1e293b)', marginTop: '20px' }}>
          <div className="card-title-row">
            <div className="card-title">⚡ 30영업일 고속 시뮬레이션 성과 리포트</div>
            <span style={{ fontSize: '12px', color: '#60a5fa' }}>평가시각: {new Date(replayResult.evaluatedAt).toLocaleTimeString()}</span>
          </div>
          <div style={{ padding: '14px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', marginBottom: '16px', fontWeight: 600, color: '#93c5fd' }}>
            {replayResult.recommendation}
          </div>
          <div className="table-wrapper">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>알고리즘 명</th>
                  <th>시뮬레이션 누적 수익률</th>
                  <th>실현 손익금</th>
                  <th>승률</th>
                  <th>체결 건수</th>
                </tr>
              </thead>
              <tbody>
                {replayResult.rankings?.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}위</td>
                    <td style={{ fontWeight: 600 }}>{r.botName}</td>
                    <td className={r.returnPct > 0 ? 'num-up' : 'num-down'}>{r.returnPct > 0 ? '+' : ''}{r.returnPct}%</td>
                    <td className={r.profitKrw > 0 ? 'num-up' : 'num-down'}>{r.profitKrw > 0 ? '+' : ''}{r.profitKrw.toLocaleString()}원</td>
                    <td className="num-up">{r.winRate}%</td>
                    <td>{r.tradesCount}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
