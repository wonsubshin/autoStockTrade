import React, { useState, useEffect } from 'react';
import PositionsTable from '../trading/PositionsTable';
import TradesTable from '../trading/TradesTable';
import {
  STRATEGY_FAMILY_ORDER,
  STRATEGY_FAMILY_META,
  getBotStrategyFamily,
  getStrategyFamilyMeta,
  summarizeFamilyCounts,
  StrategyFamilyBadge,
} from '../../utils/strategyFamilies';

export default function LabPanel({
  bots = [],
  selectedIds: parentSelectedIds,
  setSelectedIds: parentSetSelectedIds,
  isSelecting = false,
  virtualPositions = [],
  virtualTrades = [],
  onSelectRealBots,
  weeklyRotation = { enabled: true, lastRotationDate: '', lastSummary: null, nextScheduledKst: '매주 월요일 08:30 KST' },
  isRotatingWeekly = false,
  onRotateWeeklyTopBots,
  onToggleWeeklyAuto,
  onFastReplay,
  onResetVirtualAll,
  isReplaying = false,
  replayResult = null,
  onRefreshLeaderboard,
}) {
  const [internalSelectedIds, setInternalSelectedIds] = useState([]);
  const selectedIds = parentSelectedIds ?? internalSelectedIds;
  const setSelectedIds = parentSetSelectedIds ?? setInternalSelectedIds;

  const [selectedArenaBotId, setSelectedArenaBotId] = useState('');
  const [familyFilter, setFamilyFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('WEEKLY'); // 'WEEKLY' | 'TOTAL'

  // parentSelectedIds가 주어지지 않은 독립 실행 시에만 1회 초기화
  const isInternalInitRef = React.useRef(false);
  useEffect(() => {
    if (bots.length > 0 && !selectedArenaBotId) {
      setSelectedArenaBotId(bots[0].bot_id);
    }
    if (parentSelectedIds !== undefined) return;
    if (!isInternalInitRef.current && bots.length > 0) {
      const initSelected = bots
        .filter((b) => Number(b.is_real_selected) === 1)
        .map((b) => b.bot_id);
      if (initSelected.length >= 1 && initSelected.length <= 3) {
        setInternalSelectedIds(initSelected);
        isInternalInitRef.current = true;
      } else if (bots.length >= 3) {
        setInternalSelectedIds([bots[0].bot_id, bots[1].bot_id, bots[2].bot_id]);
        isInternalInitRef.current = true;
      }
    }
  }, [bots, parentSelectedIds, selectedArenaBotId]);

  const toggleBotSelection = (botId) => {
    if (selectedIds.includes(botId)) {
      setSelectedIds(selectedIds.filter((id) => id !== botId));
    } else {
      if (selectedIds.length >= 3) {
        onSelectRealBots && onSelectRealBots([]);
        return;
      }
      setSelectedIds([...selectedIds, botId]);
    }
  };

  const rankedBots = [...bots].sort((a, b) => {
    if (sortBy === 'WEEKLY') {
      return (
        Number(b.weekly_composite_score || 0) - Number(a.weekly_composite_score || 0) ||
        Number(b.weekly_return_pct || 0) - Number(a.weekly_return_pct || 0) ||
        Number(b.virtual_return_pct || 0) - Number(a.virtual_return_pct || 0)
      );
    }
    return Number(b.virtual_return_pct || 0) - Number(a.virtual_return_pct || 0);
  });
  const overallRankMap = new Map(rankedBots.map((b, i) => [b.bot_id, i + 1]));
  const totalFamilyCounts = summarizeFamilyCounts(bots);
  const selectedBotObjs = bots.filter((b) => selectedIds.includes(b.bot_id));
  const selectedFamilyCounts = summarizeFamilyCounts(selectedBotObjs);
  const coveredFamiliesCount = STRATEGY_FAMILY_ORDER.filter((f) => (selectedFamilyCounts[f] || 0) > 0).length;
  const filteredRankedBots = familyFilter === 'ALL'
    ? rankedBots
    : rankedBots.filter((b) => getBotStrategyFamily(b) === familyFilter);
  const autoEnabled = weeklyRotation?.enabled !== false;
  const lastSummary = weeklyRotation?.lastSummary;

  return (
    <div className="virtual-arena-wrap">
      {/* Top Banner Card */}
      <div className="board-card" style={{ borderColor: '#8b5cf6', background: 'linear-gradient(135deg, #101526, #1e1b4b)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                ⚡ {bots?.length || 11}대 퀀트 봇 상시 가상 경쟁 아레나 (Pure Algorithm Only)
              </h2>
              <span className="badge-live-pulse">
                <span className="mode-pulse-dot virtual" style={{ width: '7px', height: '7px' }}></span>
                24시간 상시 가상 경쟁
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: '#cbd5e1', marginTop: '6px', lineHeight: 1.6, marginBottom: 0 }}>
              • {bots?.length || 11}개 봇 모두 <strong>Gemini LLM 호출 없이 100% 순수 퀀트 수식 지표</strong>로 24시간 자율 가상 매매를 수행합니다.<br />
              • <strong>전략군별 주간 1위 자동 선출</strong>을 실행하면 최근 7일 시가평가 수익률·승률 기반 3대 전략군 1위 봇을 실전 담당으로 무중단 교체합니다. (보유 포지션 끝까지 책임 청산)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {onRotateWeeklyTopBots && (
              <button
                className="btn-action"
                style={{
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#0f172a',
                  border: '1px solid #fbbf24',
                  opacity: isRotatingWeekly ? 0.7 : 1,
                  cursor: isRotatingWeekly ? 'not-allowed' : 'pointer',
                }}
                disabled={isRotatingWeekly}
                onClick={() => !isRotatingWeekly && onRotateWeeklyTopBots()}
                title="최근 7일 시가 평가 복합점수 기준 3대 전략군(BREAKOUT·TREND·REVERSION) 1위 봇 3대로 실전 담당 즉시 교체"
              >
                {isRotatingWeekly ? '🏆 주간 1위 선출 및 교체 중...' : '🏆 전략군별 주간 1위 자동 선출'}
              </button>
            )}
            {onToggleWeeklyAuto && (
              <button
                className="btn-action"
                style={{
                  fontWeight: 700,
                  background: autoEnabled ? 'rgba(16, 185, 129, 0.18)' : 'rgba(51, 65, 85, 0.7)',
                  color: autoEnabled ? '#34d399' : '#94a3b8',
                  border: autoEnabled ? '1px solid rgba(52, 211, 153, 0.5)' : '1px solid rgba(148, 163, 184, 0.3)',
                }}
                onClick={onToggleWeeklyAuto}
                title="매주 월요일 오전 08:30 KST(개장 30분 전) 전략군별 주간 1위 자동 로테이션 활성 여부"
              >
                🔄 매주 월요일 08:30 자동 교체: {autoEnabled ? 'ON' : 'OFF'}
              </button>
            )}
            <button
              className="btn-action success"
              style={{
                fontWeight: 700,
                background: selectedIds.length >= 1 && selectedIds.length <= 3 ? 'linear-gradient(135deg, #10b981, #059669)' : undefined,
                border: selectedIds.length >= 1 && selectedIds.length <= 3 ? '1px solid #34d399' : undefined,
                opacity: isSelecting ? 0.7 : 1,
                cursor: isSelecting ? 'not-allowed' : 'pointer',
              }}
              disabled={isSelecting}
              onClick={() => {
                if (isSelecting) return;
                onSelectRealBots && onSelectRealBots(selectedIds);
              }}
            >
              {isSelecting
                ? `⚡ ${selectedIds.length}개 봇 실전 확정 및 설정 이동 중...`
                : `✅ 수동 선택 확정 (${selectedIds.length}/3)`}
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

        {/* 최근 주간 로테이션 요약 스트립 */}
        <div style={{ marginTop: '12px', padding: '9px 12px', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.55)', border: '1px solid rgba(148, 163, 184, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px', color: '#cbd5e1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <strong style={{ color: '#fbbf24' }}>🏆 최근 주간 로테이션:</strong>
            {lastSummary?.winners?.length > 0 ? (
              <>
                <span style={{ color: '#94a3b8' }}>
                  {weeklyRotation.lastRotationDate || lastSummary.rotatedDateKst} ({lastSummary.trigger === 'AUTO_MONDAY_0830' ? '자동 월 08:30' : '수동 선출'})
                </span>
                {lastSummary.winners.map((w) => (
                  <span
                    key={w.bot_id}
                    style={{
                      background: 'rgba(99, 102, 241, 0.16)',
                      border: '1px solid rgba(129, 140, 248, 0.35)',
                      borderRadius: '6px',
                      padding: '2px 7px',
                      color: '#e0e7ff',
                      fontWeight: 600,
                    }}
                  >
                    {w.strategy_family}: {w.nickname || w.name} ({Number(w.weekly_return_pct) >= 0 ? '+' : ''}{w.weekly_return_pct}% · 비중 {w.ratio}%)
                  </span>
                ))}
              </>
            ) : (
              <span style={{ color: '#94a3b8' }}>아직 주간 로테이션 이력이 없습니다. 상단 버튼으로 즉시 1위 3대 봇을 선출할 수 있습니다.</span>
            )}
          </div>
          <span style={{ color: autoEnabled ? '#34d399' : '#94a3b8', fontWeight: 600 }}>
            ⏰ 다음 자동 스케줄: {autoEnabled ? (weeklyRotation?.nextScheduledKst || '매주 월요일 08:30 KST') : '일시 중지(OFF)'}
          </span>
        </div>
      </div>

      {/* 11 Bots Arena Table */}
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div className="card-title">🏆 {bots?.length || 11}대 퀀트 알고리즘 실시간 수익률 리그 리더보드</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1', background: 'rgba(15, 23, 42, 0.7)', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(148, 163, 184, 0.25)' }}>
              선택 조합: <strong style={{ color: '#fbbf24' }}>🚀 돌파 {selectedFamilyCounts.BREAKOUT}</strong> · <strong style={{ color: '#38bdf8' }}>📈 추세 {selectedFamilyCounts.TREND}</strong> · <strong style={{ color: '#34d399' }}>🎯 회귀 {selectedFamilyCounts.REVERSION}</strong>
              {selectedIds.length > 0 && (
                <span style={{ marginLeft: '6px', color: coveredFamiliesCount >= 3 ? '#34d399' : coveredFamiliesCount >= 2 ? '#93c5fd' : '#fbbf24', fontWeight: 600 }}>
                  ({coveredFamiliesCount >= 3 ? '3대 전략 균형' : coveredFamiliesCount === 2 ? '2전략 조합' : '단일 전략 편중'})
                </span>
              )}
            </span>
            <span style={{ fontSize: '12px', color: selectedIds.length >= 1 && selectedIds.length <= 3 ? '#34d399' : '#f59e0b', fontWeight: 600 }}>
              실전 지정 봇: {selectedIds.length} / 3개 선택됨 {selectedIds.length >= 1 && selectedIds.length <= 3 ? '✓ 선택 가능 (최대 3개)' : '(1~3개 선택 필요)'}
            </span>
          </div>
        </div>

        {/* 3대 전략군 식별 필터 & Soft Regime Routing 안내 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px', padding: '10px 12px', background: 'rgba(15, 23, 42, 0.55)', borderRadius: '8px', border: '1px solid rgba(148, 163, 184, 0.16)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600, marginRight: '4px' }}>3대 전략군 구분:</span>
            <button
              type="button"
              onClick={() => setFamilyFilter('ALL')}
              style={{
                cursor: 'pointer',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '11.5px',
                fontWeight: 700,
                background: familyFilter === 'ALL' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(30, 41, 59, 0.8)',
                color: familyFilter === 'ALL' ? '#e0e7ff' : '#94a3b8',
                border: familyFilter === 'ALL' ? '1px solid #818cf8' : '1px solid rgba(148, 163, 184, 0.25)',
              }}
            >
              전체 ({bots.length})
            </button>
            {STRATEGY_FAMILY_ORDER.map((famCode) => {
              const meta = STRATEGY_FAMILY_META[famCode];
              const isActive = familyFilter === famCode;
              return (
                <button
                  key={famCode}
                  type="button"
                  title={meta.regimeHint}
                  onClick={() => setFamilyFilter(famCode)}
                  style={{
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    background: isActive ? meta.bg : 'rgba(30, 41, 59, 0.8)',
                    color: isActive ? meta.color : '#cbd5e1',
                    border: isActive ? `1px solid ${meta.color}` : '1px solid rgba(148, 163, 184, 0.25)',
                  }}
                >
                  {meta.icon} {meta.shortLabel} · {meta.code} ({totalFamilyCounts[famCode] || 0})
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', background: 'rgba(15, 23, 42, 0.7)', borderRadius: '6px', border: '1px solid rgba(148, 163, 184, 0.25)', padding: '2px' }}>
              <button
                type="button"
                onClick={() => setSortBy('WEEKLY')}
                style={{
                  cursor: 'pointer',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  border: 'none',
                  background: sortBy === 'WEEKLY' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                  color: sortBy === 'WEEKLY' ? '#fbbf24' : '#94a3b8',
                }}
              >
                🏆 최근 7일 순위
              </button>
              <button
                type="button"
                onClick={() => setSortBy('TOTAL')}
                style={{
                  cursor: 'pointer',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  border: 'none',
                  background: sortBy === 'TOTAL' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: sortBy === 'TOTAL' ? '#a5b4fc' : '#94a3b8',
                }}
              >
                📈 누적 순위
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              💡 전략군별 1위를 고르게 조합하면 강세/횡보/급락장 전환에 자동 대응합니다.
            </div>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '50px' }}>순위</th>
                <th style={{ width: '145px' }}>실전 담당 선택 (1~3개)</th>
                <th style={{ width: '175px' }}>전략군 / 주간 1위</th>
                <th style={{ width: '110px' }}>가상 거래 상태</th>
                <th>봇 이름 / 퀀트 알고리즘</th>
                <th>가상 평가자산</th>
                <th>최근 7일 수익률</th>
                <th>누적 수익률</th>
                <th>실현 손익금</th>
                <th>승률 (거래수)</th>
                <th>익절 / 손절</th>
              </tr>
            </thead>
            <tbody>
              {filteredRankedBots.map((bot, idx) => {
                const overallRank = overallRankMap.get(bot.bot_id) || idx + 1;
                const isChecked = selectedIds.includes(bot.bot_id);
                const isSelectedForDetail = bot.bot_id === selectedArenaBotId;
                const ret = Number(bot.virtual_return_pct || 0);
                const wRet = Number(bot.weekly_return_pct || 0);
                const wProfit = Number(bot.weekly_profit_krw || 0);
                const pKrw = Number(bot.virtual_profit_krw || 0);
                const isTop1 = overallRank === 1;
                const isWeeklyTop = Boolean(bot.is_family_weekly_top);
                const familyMeta = getStrategyFamilyMeta(bot);
                const isStickinessWaiting = Number(bot.is_real_selected) === 0 && Number(bot.real_open_count || 0) > 0;

                return (
                  <tr
                    key={bot.bot_id}
                    onClick={() => setSelectedArenaBotId(bot.bot_id)}
                    style={{
                      cursor: 'pointer',
                      background: isSelectedForDetail
                        ? 'rgba(99, 102, 241, 0.16)'
                        : isWeeklyTop
                        ? 'rgba(245, 158, 11, 0.06)'
                        : isChecked
                        ? 'rgba(59, 130, 246, 0.08)'
                        : undefined,
                      borderLeft: isSelectedForDetail
                        ? '4px solid #818cf8'
                        : isWeeklyTop
                        ? '3px solid #f59e0b'
                        : isChecked
                        ? '3px solid #3b82f6'
                        : '3px solid transparent',
                    }}
                    title="클릭하여 하단에서 이 봇의 상세 체결 및 실현 손익 내역 확인"
                  >
                    <td>
                      <strong style={{ color: isTop1 ? '#fbbf24' : '#94a3b8' }}>
                        {isTop1 ? '👑 1' : `#${overallRank}`}
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
                      {isStickinessWaiting && (
                        <div
                          title="실전 선택 해제되었으나 기존 보유 포지션을 원 소유 봇 수식으로 끝까지 책임 청산 중"
                          style={{
                            marginTop: '4px',
                            fontSize: '10px',
                            color: '#fcd34d',
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: '4px',
                            padding: '1px 5px',
                            display: 'inline-block',
                          }}
                        >
                          🛡️ 청산 대기({bot.real_open_count}건)
                        </div>
                      )}
                    </td>
                    <td>
                      <StrategyFamilyBadge bot={bot} showCode />
                      {isWeeklyTop && (
                        <div
                          style={{
                            marginTop: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            color: '#fbbf24',
                            background: 'rgba(245, 158, 11, 0.16)',
                            border: '1px solid rgba(251, 191, 36, 0.45)',
                          }}
                        >
                          👑 주간 전략군 1위
                        </div>
                      )}
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.3 }}>
                        {familyMeta.code === 'BREAKOUT' && '강세 돌파 · 횡보 차단'}
                        {familyMeta.code === 'TREND' && '추세/눌림목 유연 대응'}
                        {familyMeta.code === 'REVERSION' && '횡보 최적 · 급락 92점+ 스나이프'}
                      </div>
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
                      <div>{Number(bot.virtual_total_assets || 1000000).toLocaleString()}원</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        평가손익: {pKrw >= 0 ? `+${pKrw.toLocaleString()}원` : `${pKrw.toLocaleString()}원`}
                      </div>
                    </td>
                    <td className={wRet >= 0 ? 'num-up' : 'num-down'} style={{ fontWeight: 700, fontSize: '13px' }}>
                      <div>{wRet >= 0 ? `+${wRet.toFixed(2)}%` : `${wRet.toFixed(2)}%`}</div>
                      <div style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 500 }}>
                        {wProfit >= 0 ? `+${wProfit.toLocaleString()}원` : `${wProfit.toLocaleString()}원`} · {bot.weekly_trade_count || 0}건
                      </div>
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
                    <td>
                      <span className="num-up">{bot.virtual_win_trades || 0}건</span> / <span className="num-down">{bot.virtual_loss_trades || 0}건</span>
                      <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                        목표: +{bot.take_profit_pct}% / -{Math.abs(bot.stop_loss_pct)}%
                      </div>
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

      {/* Real-time Virtual Positions Table - 선택된 가상 봇 포지션 */}
      <PositionsTable
        positions={virtualPositions.filter(
          (p) => !selectedArenaBotId || p.bot_id === selectedArenaBotId
        )}
        activeTradeMode="VIRTUAL"
      />

      {/* Completed Virtual Trades Table - 각 봇의 거래 내역만 표시 */}
      <TradesTable
        trades={virtualTrades.filter(
          (t) => t.trade_mode === 'VIRTUAL' && t.bot_id === selectedArenaBotId
        )}
        activeTradeMode="VIRTUAL"
        selectedBot={bots.find((b) => b.bot_id === selectedArenaBotId)}
        bots={rankedBots}
        onSelectBot={(botId) => setSelectedArenaBotId(botId)}
      />
    </div>
  );
}
