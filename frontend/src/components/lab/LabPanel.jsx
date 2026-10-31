import React from 'react';

export default function LabPanel({
  leaderboard,
  onFastReplay,
  isReplaying,
  replayResult,
  onPromoteBot,
}) {
  return (
    <div>
      <div className="section-header">
        <div className="section-title">🧪 3대 퀀트 알고리즘 실시간 리더보드</div>
        <button
          className="btn-action success"
          onClick={onFastReplay}
          disabled={isReplaying}
        >
          {isReplaying ? '⚡ 30일 고속 시뮬레이션 계산 중...' : '⚡ 최근 30일 데이터로 3대 알고리즘 즉시 시뮬레이션'}
        </button>
      </div>

      {/* Top 3 Battle Scorecards */}
      <div className="leaderboard-grid">
        {leaderboard.map((item) => {
          const isRank1 = item.rank === 1;
          const isRank2 = item.rank === 2;
          return (
            <div key={item.botId} className={`leader-card ${isRank1 ? 'rank-1' : ''}`}>
              <div className={`rank-badge ${isRank1 ? 'gold' : isRank2 ? 'silver' : 'bronze'}`}>
                {isRank1 ? '👑 1위 (최우수)' : isRank2 ? '🥈 2위' : '🥉 3위'}
              </div>
              <div className="leader-name">{item.name}</div>
              <div className="leader-sub">{item.strategyType}</div>

              <div className="leader-stats">
                <div className="lstat-box">
                  <div className="lstat-label">누적 수익률</div>
                  <div className={`lstat-val ${item.cumulativeReturnPct > 0 ? 'num-up' : item.cumulativeReturnPct < 0 ? 'num-down' : ''}`}>
                    {item.cumulativeReturnPct > 0 ? '+' : ''}{item.cumulativeReturnPct}%
                  </div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">승률 (Win Rate)</div>
                  <div className="lstat-val num-up">{item.winRate}%</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">손익비 (Profit Factor)</div>
                  <div className="lstat-val">{item.profitFactor}</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">최대 낙폭 (MDD)</div>
                  <div className="lstat-val num-down">-{item.mddPct}%</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">샤프 지수 (Sharpe)</div>
                  <div className="lstat-val">{item.sharpeRatio}</div>
                </div>
                <div className="lstat-box">
                  <div className="lstat-label">총 체결 횟수</div>
                  <div className="lstat-val">{item.totalTrades}회</div>
                </div>
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
