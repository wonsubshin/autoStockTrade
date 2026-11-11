import React, { useState, useMemo, useRef, useCallback } from 'react';
import AllTradesHistoryTable from './AllTradesHistoryTable';

function getTodayKstString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getWeekKeyFromDateStr(ymd) {
  const [y, m, day] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  const oneJan = new Date(Date.UTC(y, 0, 1));
  const weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getUTCDay() + 1) / 7);
  return `${y}-W${String(weekNum).padStart(2, '0')}`;
}

function buildZeroFilledTimeline(rawTimeline = [], period = 'daily', baseDate = '2026-10-01') {
  const todayKst = getTodayKstString();
  const map = new Map();

  const [startY, startM, startD] = baseDate.split('-').map(Number);
  const [endY, endM, endD] = todayKst.split('-').map(Number);
  const cur = new Date(Date.UTC(startY, startM - 1, startD));
  const end = new Date(Date.UTC(endY, endM - 1, endD));

  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;

    let key = ymd;
    if (period === 'monthly') {
      key = `${y}-${m}`;
    } else if (period === 'weekly') {
      key = getWeekKeyFromDateStr(ymd);
    }

    if (!map.has(key)) {
      map.set(key, {
        period: key,
        profitKrw: 0,
        cumulativeProfitKrw: 0,
        tradesCount: 0,
        winRate: 0,
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (Array.isArray(rawTimeline)) {
    for (const item of rawTimeline) {
      if (!item || !item.period) continue;
      const profit = Number(item.profitKrw);
      const cumProfit = Number(item.cumulativeProfitKrw);
      map.set(item.period, {
        period: item.period,
        profitKrw: isNaN(profit) ? 0 : profit,
        cumulativeProfitKrw: isNaN(cumProfit) ? 0 : cumProfit,
        tradesCount: Number(item.tradesCount || 0),
        winRate: Number(item.winRate || 0),
      });
    }
  }

  let running = 0;
  return Array.from(map.values()).map((entry) => {
    running += (Number(entry.profitKrw) || 0);
    return {
      ...entry,
      profitKrw: Number(entry.profitKrw) || 0,
      cumulativeProfitKrw: running,
    };
  });
}

function formatAxisLabel(periodKey, periodMode) {
  if (!periodKey) return '';
  if (periodMode === 'daily' && periodKey.length === 10) {
    return periodKey.slice(5).replace('-', '/'); // MM/DD
  }
  return periodKey;
}

// 부드러운 스플라인 곡선 Path 생성 함수
function createSmoothCurvePath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

export default function StatsPanel({
  statsData,
  statsPeriodTab,
  setStatsPeriodTab,
  bots = [],
}) {
  // 일간 탭일 때 표시 구간 범위 ('14d' | '30d' | 'all')
  const [dailyChartRange, setDailyChartRange] = useState('14d');
  // 지표 모드 ('period': 기간별 실현손익 | 'cumulative': 누적 실현손익)
  const [chartMetricMode, setChartMetricMode] = useState('period');
  // 마우스 호버된 데이터 포인트 인덱스
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const svgRef = useRef(null);
  const todayKst = getTodayKstString();

  // 거래가 없는 날도 모두 0으로 채워진 전체 타임라인 (오름차순: 과거 -> 오늘)
  const fullTimeline = useMemo(
    () => buildZeroFilledTimeline(statsData?.timeline, statsPeriodTab, statsData?.baseDate || '2026-10-01'),
    [statsData, statsPeriodTab]
  );

  // 그래프에 표시할 타임라인 슬라이스
  const chartTimeline = useMemo(() => {
    if (statsPeriodTab !== 'daily') return fullTimeline;
    if (dailyChartRange === '14d') return fullTimeline.slice(-14);
    if (dailyChartRange === '30d') return fullTimeline.slice(-30);
    return fullTimeline;
  }, [fullTimeline, statsPeriodTab, dailyChartRange]);

  // 테이블 표시용 타임라인 (최신 날짜가 위로 오도록 내림차순 정렬)
  const tableTimeline = useMemo(() => [...fullTimeline].reverse(), [fullTimeline]);

  // SVG 뷰박스 및 레이아웃 제원
  const svgWidth = 860;
  const svgHeight = 270;
  const padding = { top: 32, right: 35, bottom: 45, left: 75 };
  const plotWidth = svgWidth - padding.left - padding.right;
  const plotHeight = svgHeight - padding.top - padding.bottom;
  const zeroY = padding.top + plotHeight / 2;

  // Y축 스케일 범위 산출 (0선이 항상 정중앙에 오도록 대칭 바운드 적용)
  const { bound, yTicks } = useMemo(() => {
    const vals = chartTimeline.map((item) =>
      Number(chartMetricMode === 'cumulative' ? item.cumulativeProfitKrw : item.profitKrw) || 0
    );
    const dataMax = Math.max(...vals.map((v) => Math.abs(v)), 0);

    // 손익 규모가 소액(소수점 매매 등 수백~수천 원 단위)이더라도 그래프 곡선과 변화가 뚜렷하게 보이도록 동적 스케일링
    // 실전 손익이 전혀 없을 때만 기본 5,000원 바운드 적용
    let roundedBound = 5000;
    if (dataMax > 0) {
      const rawBound = dataMax * 1.35; // 35% 여유 마진
      const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(rawBound))));
      const step = magnitude >= 10 ? (magnitude / 2) : 10;
      roundedBound = Math.max(100, Math.ceil(rawBound / step) * step);
    }

    const halfBound = Math.round(roundedBound / 2);
    const ticks = [
      { val: roundedBound, label: `+${roundedBound.toLocaleString()}원` },
      { val: halfBound, label: `+${halfBound.toLocaleString()}원` },
      { val: 0, label: '0원 (기준선)' },
      { val: -halfBound, label: `-${halfBound.toLocaleString()}원` },
      { val: -roundedBound, label: `-${roundedBound.toLocaleString()}원` },
    ];

    return { bound: roundedBound, yTicks: ticks };
  }, [chartTimeline, chartMetricMode]);

  // 각 데이터 포인트의 SVG (x, y) 좌표 계산
  const points = useMemo(() => {
    const len = chartTimeline.length;
    return chartTimeline.map((item, idx) => {
      const rawVal = chartMetricMode === 'cumulative' ? item.cumulativeProfitKrw : item.profitKrw;
      const val = Number(rawVal) || 0;
      const x = padding.left + (len > 1 ? (idx / (len - 1)) * plotWidth : plotWidth / 2);
      // val이 0이면 y = zeroY (정확히 0선 위!)
      const y = bound > 0 ? zeroY - (val / bound) * (plotHeight / 2) : zeroY;
      return {
        ...item,
        val,
        x,
        y,
        isZero: val === 0,
        isPositive: val > 0,
        isNegative: val < 0,
        isToday: item.period === todayKst,
      };
    });
  }, [chartTimeline, chartMetricMode, bound, zeroY, padding.left, plotWidth, plotHeight, todayKst]);

  // 선형 그래프 패스 및 그라디언트 영역 패스 생성
  const linePathD = useMemo(() => createSmoothCurvePath(points), [points]);

  const areaPathD = useMemo(() => {
    if (!points || points.length === 0) return '';
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    return `${linePathD} L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} L ${firstX.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  }, [linePathD, points, zeroY]);

  // 마우스 이동 시 가장 가까운 X축 데이터 포인트 탐색
  const handleSvgMouseMove = useCallback(
    (e) => {
      if (!svgRef.current || points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;

      let closestIdx = 0;
      let minDiff = Infinity;
      points.forEach((pt, idx) => {
        const diff = Math.abs(pt.x - mouseX);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });
      setHoveredIndex(closestIdx);
    },
    [points, svgWidth]
  );

  const handleSvgMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const activePoint = hoveredIndex !== null && points[hoveredIndex] ? points[hoveredIndex] : null;
  const periodLabel = statsPeriodTab === 'daily' ? '일간' : statsPeriodTab === 'weekly' ? '주간' : '월간';

  return (
    <div>
      {/* 최상단 메타 정보 및 실전 전용 배지 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '19px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
            📈 실전 투자 성과 & 기간별 통계
          </h2>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            (기준일: {statsData?.baseDate || '2026.10.01'} ~ 오늘)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="badge-mode real"
            style={{
              fontSize: '12px',
              padding: '6px 14px',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
            }}
          >
            <span className="mode-pulse-dot" style={{ background: '#ef4444', width: '8px', height: '8px' }}></span>
            💰 실전 매매 전용 통계 (토스증권 실계좌 체결 기준)
          </span>
        </div>
      </div>

      {/* Overall Cumulative Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-title">실전 누적 실현 손익합계 (2026.10~)</div>
          <div className="metric-value">
            <span className={Number(statsData?.totalProfitKrw || 0) >= 0 ? 'num-up' : 'num-down'}>
              {Number(statsData?.totalProfitKrw || 0) > 0 ? '+' : ''}
              {Number(statsData?.totalProfitKrw || 0).toLocaleString()}원
            </span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-title">총 실전 체결 거래수</div>
          <div className="metric-value">{Number(statsData?.totalTrades || 0)}회</div>
        </div>
        <div className="metric-card">
          <div className="metric-title">실전 종합 승률 (Win Rate)</div>
          <div className="metric-value">
            <span className={Number(statsData?.winRate || 0) >= 50 ? 'num-up' : 'num-down'}>
              {Number(statsData?.winRate || 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          📊 통계 그래프 영역: [일간 / 주간 / 월간] 탭 & 반응형 선형 그래프(Line Chart)
          ==================================================================== */}
      <div
        className="board-card"
        style={{
          background: 'linear-gradient(135deg, rgba(19, 27, 46, 0.95), rgba(15, 23, 42, 0.98))',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* 그래프 카드 헤더: 제목 + [일간 / 주간 / 월간] 탭 + 보조 옵션 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap',
            marginBottom: '16px',
            paddingBottom: '14px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
          }}
        >
          {/* 헤더 좌측: 타이틀 & 거래 없는 날 0 표기 안내 뱃지 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16.5px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
              📊 {periodLabel} 실전 손익 선형 그래프 (Line Chart)
            </span>
            <span
              style={{
                fontSize: '11px',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '3px 8px',
                borderRadius: '6px',
                fontWeight: 700,
              }}
            >
              거래가 없는 날은 0선(0원)에 표기됩니다
            </span>
          </div>

          {/* 헤더 우측: [일간 / 주간 / 월간] 탭 버튼 그룹 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* 메인 탭: 일간 / 주간 / 월간 */}
            <div
              style={{
                display: 'inline-flex',
                background: 'rgba(11, 15, 25, 0.85)',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.3)',
              }}
            >
              <button
                type="button"
                onClick={() => setStatsPeriodTab('daily')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  transition: 'all 0.15s ease',
                  background: statsPeriodTab === 'daily' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                  color: statsPeriodTab === 'daily' ? '#fff' : '#94a3b8',
                  boxShadow: statsPeriodTab === 'daily' ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
                }}
              >
                일간 (Daily)
              </button>
              <button
                type="button"
                onClick={() => setStatsPeriodTab('weekly')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  transition: 'all 0.15s ease',
                  background: statsPeriodTab === 'weekly' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                  color: statsPeriodTab === 'weekly' ? '#fff' : '#94a3b8',
                  boxShadow: statsPeriodTab === 'weekly' ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
                }}
              >
                주간 (Weekly)
              </button>
              <button
                type="button"
                onClick={() => setStatsPeriodTab('monthly')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  transition: 'all 0.15s ease',
                  background: statsPeriodTab === 'monthly' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                  color: statsPeriodTab === 'monthly' ? '#fff' : '#94a3b8',
                  boxShadow: statsPeriodTab === 'monthly' ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
                }}
              >
                월간 (Monthly)
              </button>
            </div>

            {/* 지표 모드 토글: 당일 손익선 vs 누적 손익선 */}
            <div
              style={{
                display: 'inline-flex',
                background: 'rgba(11, 15, 25, 0.85)',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.25)',
              }}
            >
              <button
                type="button"
                onClick={() => setChartMetricMode('period')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: chartMetricMode === 'period' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: chartMetricMode === 'period' ? '#38bdf8' : '#94a3b8',
                }}
              >
                기간별 손익선
              </button>
              <button
                type="button"
                onClick={() => setChartMetricMode('cumulative')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: chartMetricMode === 'cumulative' ? 'rgba(192, 132, 252, 0.2)' : 'transparent',
                  color: chartMetricMode === 'cumulative' ? '#c084fc' : '#94a3b8',
                }}
              >
                누적 손익선
              </button>
            </div>

            {/* 일간 탭일 때 구간 선택 서브 필터 */}
            {statsPeriodTab === 'daily' && (
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  { key: '14d', label: '14일' },
                  { key: '30d', label: '30일' },
                  { key: 'all', label: '전체' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`filter-badge-btn ${dailyChartRange === opt.key ? 'active' : ''}`}
                    style={{ padding: '4px 9px', fontSize: '11px', borderRadius: '6px' }}
                    onClick={() => setDailyChartRange(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ====================================================================
            SVG 선형 그래프 렌더링 컨테이너
            ==================================================================== */}
        <div
          style={{
            position: 'relative',
            background: 'rgba(9, 13, 24, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '10px',
            padding: '12px 14px',
            overflowX: 'auto',
          }}
        >
          {/* 범례 및 현재 선택 포인트 요약 바 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
              paddingBottom: '8px',
              borderBottom: '1px dashed rgba(148, 163, 184, 0.15)',
              fontSize: '11.5px',
              color: '#cbd5e1',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            {/* 범례 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '14px', height: '3px', background: '#38bdf8', borderRadius: '2px', display: 'inline-block' }} />
                실현 손익 곡선
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b', border: '1px solid #94a3b8', display: 'inline-block' }} />
                거래 없음 (0원)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                수익(+)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
                손실(-)
              </span>
            </div>

            {/* 마우스 호버 시 강조 정보 요약 */}
            {activePoint ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <span style={{ color: '#94a3b8' }}>[{activePoint.period}]</span>
                <span>
                  {chartMetricMode === 'cumulative' ? '누적 손익: ' : '실현 손익: '}
                  <strong style={{ color: activePoint.val > 0 ? '#f87171' : activePoint.val < 0 ? '#60a5fa' : '#94a3b8' }}>
                    {activePoint.val > 0 ? '+' : ''}{activePoint.val.toLocaleString()}원
                    {activePoint.isZero && ' (무거래)'}
                  </strong>
                </span>
                <span style={{ color: '#cbd5e1' }}>| 체결: {activePoint.tradesCount}건</span>
                <span style={{ color: '#34d399' }}>| 승률: {activePoint.winRate}%</span>
              </div>
            ) : (
              <span style={{ color: '#64748b', fontSize: '11px' }}>
                💡 그래프 위 점에 마우스를 올리면 상세 손익 및 체결 건수를 확인할 수 있습니다.
              </span>
            )}
          </div>

          {/* SVG 선형 차트 본체 */}
          <div style={{ minWidth: `${Math.max(680, points.length * 32)}px` }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={handleSvgMouseLeave}
            >
              <defs>
                {/* 선형 그라디언트 (영역 채움용) */}
                <linearGradient id="profitAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                  <stop offset="50%" stopColor="#818cf8" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>

                {/* 선 글로우 필터 */}
                <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Y축 그리드선 및 라벨 */}
              {yTicks.map((tick, idx) => {
                const tickY = zeroY - (tick.val / bound) * (plotHeight / 2);
                const isZeroLine = tick.val === 0;
                return (
                  <g key={idx}>
                    {/* 수평 그리드선 */}
                    <line
                      x1={padding.left}
                      y1={tickY}
                      x2={svgWidth - padding.right}
                      y2={tickY}
                      stroke={isZeroLine ? 'rgba(56, 189, 248, 0.45)' : 'rgba(148, 163, 184, 0.14)'}
                      strokeWidth={isZeroLine ? 1.5 : 1}
                      strokeDasharray={isZeroLine ? 'none' : '4 4'}
                    />
                    {/* Y축 좌측 라벨 */}
                    <text
                      x={padding.left - 10}
                      y={tickY + 4}
                      textAnchor="end"
                      fill={isZeroLine ? '#38bdf8' : '#94a3b8'}
                      fontSize={isZeroLine ? '11px' : '10px'}
                      fontWeight={isZeroLine ? 700 : 500}
                    >
                      {tick.label}
                    </text>
                  </g>
                );
              })}

              {/* 0원 기준선 우측 강조 태그 */}
              <text
                x={svgWidth - padding.right + 8}
                y={zeroY + 4}
                textAnchor="start"
                fill="#38bdf8"
                fontSize="10px"
                fontWeight={700}
              >
                0선
              </text>

              {/* 1. 그라디언트 영역 채우기 (Area Fill) */}
              {areaPathD && (
                <path d={areaPathD} fill="url(#profitAreaGradient)" />
              )}

              {/* 2. 메인 선형 곡선 (Line Curve) */}
              {linePathD && (
                <path
                  d={linePathD}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#lineGlow)"
                />
              )}

              {/* 3. 각 데이터 포인트 (거래가 없는 날도 정확히 0선 위에 포인트가 찍힘) */}
              {points.map((pt, idx) => {
                const isHovered = hoveredIndex === idx;
                const circleRadius = isHovered ? 6 : pt.isZero ? 3.5 : 4.5;
                const circleFill = pt.isZero ? '#64748b' : pt.isPositive ? '#ef4444' : '#3b82f6';
                const circleStroke = pt.isZero ? '#94a3b8' : pt.isPositive ? '#fee2e2' : '#dbeafe';

                return (
                  <g key={idx}>
                    {/* 점 위 호버 링 */}
                    {isHovered && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={11}
                        fill="rgba(56, 189, 248, 0.25)"
                        stroke="#38bdf8"
                        strokeWidth="1.5"
                      />
                    )}

                    {/* 데이터 포인트 원 */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={circleRadius}
                      fill={circleFill}
                      stroke={circleStroke}
                      strokeWidth={1.5}
                    />

                    {/* 거래가 없는 날(0원) 작은 0 라벨 (표시 항목이 적당할 때 노출) */}
                    {pt.isZero && points.length <= 20 && !isHovered && (
                      <text
                        x={pt.x}
                        y={zeroY - 7}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="9px"
                        fontWeight={600}
                      >
                        0
                      </text>
                    )}

                    {/* X축 하단 라벨 (MM/DD 또는 W40, YYYY-MM) */}
                    <text
                      x={pt.x}
                      y={svgHeight - 16}
                      textAnchor="middle"
                      fill={pt.isToday ? '#60a5fa' : isHovered ? '#fff' : '#94a3b8'}
                      fontSize={pt.isToday || isHovered ? '11px' : '10px'}
                      fontWeight={pt.isToday || isHovered ? 800 : 500}
                    >
                      {formatAxisLabel(pt.period, statsPeriodTab)}
                    </text>

                    {/* X축 하단 체결건수 라벨 */}
                    <text
                      x={pt.x}
                      y={svgHeight - 4}
                      textAnchor="middle"
                      fill={pt.tradesCount > 0 ? '#34d399' : '#64748b'}
                      fontSize="9px"
                      fontWeight={pt.tradesCount > 0 ? 700 : 500}
                    >
                      {pt.tradesCount}건
                    </text>
                  </g>
                );
              })}

              {/* 4. 호버 시 수직 가이드라인(Crosshair Guide Line) */}
              {activePoint && (
                <g pointerEvents="none">
                  <line
                    x1={activePoint.x}
                    y1={padding.top}
                    x2={activePoint.x}
                    y2={svgHeight - padding.bottom}
                    stroke="rgba(56, 189, 248, 0.6)"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  {/* 플로팅 툴팁 박스 */}
                  <g
                    transform={`translate(${Math.min(
                      Math.max(padding.left, activePoint.x - 70),
                      svgWidth - padding.right - 140
                    )}, ${Math.max(12, activePoint.y - 65)})`}
                  >
                    <rect
                      width="140"
                      height="52"
                      rx="6"
                      fill="rgba(15, 23, 42, 0.95)"
                      stroke="rgba(56, 189, 248, 0.5)"
                      strokeWidth="1"
                    />
                    <text x="70" y="16" textAnchor="middle" fill="#f8fafc" fontSize="10.5px" fontWeight="700">
                      {activePoint.period} {activePoint.isToday ? '(오늘)' : ''}
                    </text>
                    <text
                      x="70"
                      y="32"
                      textAnchor="middle"
                      fill={activePoint.val > 0 ? '#f87171' : activePoint.val < 0 ? '#60a5fa' : '#cbd5e1'}
                      fontSize="12px"
                      fontWeight="800"
                    >
                      {activePoint.val > 0 ? '+' : ''}{activePoint.val.toLocaleString()}원
                    </text>
                    <text x="70" y="46" textAnchor="middle" fill="#94a3b8" fontSize="9.5px">
                      체결 {activePoint.tradesCount}건 · 승률 {activePoint.winRate}%
                    </text>
                  </g>
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* ====================================================================
          📅 기간별 실전 실현 손익 및 체결 성과 내역 테이블 (무거래일 0 표기 유지)
          ==================================================================== */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">
            📅 {periodLabel} 실전 실현 손익 및 체결 성과 내역 (무거래일 0 표기)
          </div>
        </div>
        <div className="table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>기간 (Period)</th>
                <th>실전 실현 손익금</th>
                <th>실전 체결 횟수</th>
                <th>승률</th>
              </tr>
            </thead>
            <tbody>
              {tableTimeline.map((item) => {
                const isUp = item.profitKrw > 0;
                const isDown = item.profitKrw < 0;
                const isToday = item.period === todayKst;
                return (
                  <tr key={item.period}>
                    <td style={{ fontWeight: 600 }}>
                      {item.period}
                      {isToday && (
                        <span
                          style={{
                            marginLeft: '8px',
                            fontSize: '10.5px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(59, 130, 246, 0.2)',
                            color: '#60a5fa',
                            fontWeight: 700,
                          }}
                        >
                          오늘
                        </span>
                      )}
                    </td>
                    <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                      {isUp ? '+' : ''}{Number(item.profitKrw || 0).toLocaleString()}원
                    </td>
                    <td style={{ color: item.tradesCount > 0 ? '#e2e8f0' : '#64748b' }}>
                      {Number(item.tradesCount || 0)}건
                    </td>
                    <td className={item.tradesCount > 0 ? (item.winRate >= 50 ? 'num-up' : 'num-down') : 'num-zero'}>
                      {Number(item.winRate || 0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ====================================================================
          🏆 종목별 실전 수익 기여도 순위 테이블
          ==================================================================== */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">🏆 종목별 실전 수익 기여도 순위</div>
        </div>
        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>종목명 (종목코드)</th>
                <th>누적 실현 손익</th>
                <th>실전 매매 횟수</th>
                <th>종목별 승률</th>
              </tr>
            </thead>
            <tbody>
              {!statsData?.stockRanking || statsData.stockRanking.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8', fontSize: '13px' }}>
                    💼 실전 매매 체결 완료된 종목 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                statsData.stockRanking.map((stock, idx) => {
                  const isUp = stock.totalProfitKrw > 0;
                  const isDown = stock.totalProfitKrw < 0;
                  return (
                    <tr key={stock.stockCode}>
                      <td>{idx + 1}위</td>
                      <td style={{ fontWeight: 600 }}>{stock.stockName} ({stock.stockCode})</td>
                      <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                        {isUp ? '+' : ''}{stock.totalProfitKrw.toLocaleString()}원
                      </td>
                      <td>{stock.tradesCount}회</td>
                      <td className={stock.winRate >= 50 ? 'num-up' : 'num-down'}>{stock.winRate}%</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ====================================================================
          📋 전체 거래내역 원장 (50건 페이징 & 상세 필터링)
          ==================================================================== */}
      <AllTradesHistoryTable bots={bots} />
    </div>
  );
}


