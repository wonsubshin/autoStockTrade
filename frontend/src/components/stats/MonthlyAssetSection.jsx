import React, { useState, useMemo } from 'react';

export default function MonthlyAssetSection({ monthlyAssets }) {
  // 차트 뷰 모드: 'comparison' (월초 vs 월말/현재) | 'change' (월별 순증감액)
  const [chartViewMode, setChartViewMode] = useState('comparison');
  const [hoveredMonth, setHoveredMonth] = useState(null);

  const current = monthlyAssets?.currentMonth;
  const history = useMemo(() => monthlyAssets?.history || [], [monthlyAssets]);

  const hasData = Boolean(current && history.length > 0);

  // 현재 월의 증감 계산
  const changeKrw = current?.changeKrw ?? 0;
  const changePct = current?.changePct ?? 0;
  const isIncreased = changeKrw > 0;
  const isDecreased = changeKrw < 0;

  // SVG 차트 레이아웃 제원
  const svgWidth = 820;
  const svgHeight = 230;
  const padding = { top: 30, right: 25, bottom: 40, left: 65 };
  const plotWidth = svgWidth - padding.left - padding.right;
  const plotHeight = svgHeight - padding.top - padding.bottom;

  // 1) 자산 비교 모드 (월초 vs 월말) Y축 스케일
  const maxAssetVal = useMemo(() => {
    if (!history.length) return 20000;
    const allVals = history.flatMap((h) => [h.startAsset, h.endAsset]);
    const maxVal = Math.max(...allVals, 1000);
    return Math.ceil((maxVal * 1.15) / 1000) * 1000;
  }, [history]);

  // 2) 증감액 모드 Y축 스케일
  const maxChangeAbs = useMemo(() => {
    if (!history.length) return 1000;
    const allAbs = history.map((h) => Math.abs(h.changeKrw));
    const maxVal = Math.max(...allAbs, 100);
    return Math.ceil((maxVal * 1.3) / 100) * 100;
  }, [history]);

  return (
    <div
      className="board-card"
      style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95))',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '14px',
        padding: '22px 24px',
        marginBottom: '24px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* 1. 상단 섹션 타이틀 및 실시간 뱃지 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '18px',
          paddingBottom: '14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '18px' }}>🏛️</span>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              실전 보유 평가자산 월별 현황 & 증감 분석
            </h3>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              매월 1일 자정의 평가자산과 현재 실시간 평가자산을 자동 추적·기록하여 월별 변동을 산출합니다.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8' }}></span>
            토스증권 실계좌 연동
          </span>
        </div>
      </div>

      {/* 2. 이번 달 핵심 3대 지표 카드 그리드 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '14px',
          marginBottom: '22px',
        }}
      >
        {/* 카드 1: 이번 달 1일 시점 자산 */}
        <div
          style={{
            background: 'rgba(30, 41, 59, 0.65)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
              📅 이번 달 1일 시점 평가자산
            </span>
            <span
              style={{
                fontSize: '10.5px',
                color: '#cbd5e1',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              {current?.startDate || '2026-11-01'}
            </span>
          </div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#f8fafc', margin: '8px 0 4px 0' }}>
            {hasData ? `${Number(current.monthStartAsset).toLocaleString()}원` : '데이터 수집 중...'}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            월초(1일) 자정 기준 기록 스냅샷
          </div>
        </div>

        {/* 카드 2: 현재 시점 평가자산 */}
        <div
          style={{
            background: 'rgba(30, 41, 59, 0.65)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700 }}>
              💰 현재 시점 총 평가자산
            </span>
            <span
              style={{
                fontSize: '10.5px',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.15)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 700,
              }}
            >
              {current?.currentDate || '오늘'} 실시간
            </span>
          </div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#38bdf8', margin: '8px 0 4px 0' }}>
            {hasData ? `${Number(current.currentAsset).toLocaleString()}원` : '데이터 수집 중...'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            예수금 {Number(current?.cashKrw || 0).toLocaleString()}원 + 주식평가 {Number(current?.stockEvalKrw || 0).toLocaleString()}원
          </div>
        </div>

        {/* 카드 3: 금액 증감 표기 (늘어남/줄어듬) */}
        <div
          style={{
            background: isIncreased
              ? 'rgba(239, 68, 68, 0.1)'
              : isDecreased
              ? 'rgba(59, 130, 246, 0.1)'
              : 'rgba(30, 41, 59, 0.65)',
            border: isIncreased
              ? '1px solid rgba(239, 68, 68, 0.35)'
              : isDecreased
              ? '1px solid rgba(59, 130, 246, 0.35)'
              : '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: isIncreased ? '#f87171' : isDecreased ? '#60a5fa' : '#94a3b8', fontWeight: 700 }}>
              📈 이번 달 자산 증감 (1일 대비)
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 700,
                background: isIncreased
                  ? 'rgba(239, 68, 68, 0.2)'
                  : isDecreased
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'rgba(148, 163, 184, 0.2)',
                color: isIncreased ? '#f87171' : isDecreased ? '#60a5fa' : '#94a3b8',
              }}
            >
              {isIncreased ? '▲ 자산 늘어남' : isDecreased ? '▼ 자산 줄어듬' : '변동 없음'}
            </span>
          </div>

          <div
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: isIncreased ? '#f87171' : isDecreased ? '#60a5fa' : '#e2e8f0',
              margin: '8px 0 4px 0',
            }}
          >
            {hasData
              ? `${changeKrw > 0 ? '+' : ''}${changeKrw.toLocaleString()}원 (${changePct > 0 ? '+' : ''}${changePct}%)`
              : '0원 (0.00%)'}
          </div>

          <div style={{ fontSize: '11.5px', color: isIncreased ? '#fca5a5' : isDecreased ? '#93c5fd' : '#94a3b8', fontWeight: 500 }}>
            {hasData ? (
              isIncreased ? (
                <span>🎉 1일 대비 자산이 <strong>{changeKrw.toLocaleString()}원</strong> 늘어났습니다.</span>
              ) : isDecreased ? (
                <span>⚠️ 1일 대비 자산이 <strong>{Math.abs(changeKrw).toLocaleString()}원</strong> 줄어들었습니다.</span>
              ) : (
                <span>1일 시점과 현재 평가자산이 동일합니다.</span>
              )
            ) : (
              '월별 데이터를 집계하고 있습니다.'
            )}
          </div>
        </div>
      </div>

      {/* 3. 월별 보유 자산 증감 시각화 그래프 (Chart) */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '10px',
          padding: '18px 20px',
        }}
      >
        {/* 그래프 컨트롤 헤더 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#f8fafc' }}>
              📊 월별 보유 자산 증감 추이 그래프
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              (월별 1일 시작 자산 vs 월말/현재 자산)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className={`filter-btn ${chartViewMode === 'comparison' ? 'active' : ''}`}
              style={{ fontSize: '11.5px', padding: '4px 10px' }}
              onClick={() => setChartViewMode('comparison')}
            >
              자산 총액 비교 (월초 vs 월말)
            </button>
            <button
              type="button"
              className={`filter-btn ${chartViewMode === 'change' ? 'active' : ''}`}
              style={{ fontSize: '11.5px', padding: '4px 10px' }}
              onClick={() => setChartViewMode('change')}
            >
              월별 순증감액 (+/-)
            </button>
          </div>
        </div>

        {/* SVG 차트 본체 */}
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{ width: '100%', height: 'auto', display: 'block', minWidth: '600px' }}
          >
            <defs>
              <linearGradient id="gradBarStart" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="gradBarEnd" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="gradBarUp" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f87171" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#dc2626" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="gradBarDown" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.4" />
              </linearGradient>
            </defs>

            {/* 그리드 가로선 */}
            {chartViewMode === 'comparison' ? (
              // 비교 모드 그리드 (4단계)
              [0, 0.33, 0.66, 1].map((ratio, i) => {
                const y = padding.top + plotHeight * (1 - ratio);
                const val = Math.round(maxAssetVal * ratio);
                return (
                  <g key={i}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={svgWidth - padding.right}
                      y2={y}
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeDasharray={ratio === 0 ? 'none' : '3 3'}
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      fill="#64748b"
                      fontSize="10"
                      textAnchor="end"
                    >
                      {val.toLocaleString()}원
                    </text>
                  </g>
                );
              })
            ) : (
              // 증감 모드 그리드 (중앙 0선 기준)
              [-1, -0.5, 0, 0.5, 1].map((ratio, i) => {
                const y = padding.top + plotHeight / 2 - ratio * (plotHeight / 2);
                const val = Math.round(maxChangeAbs * ratio);
                return (
                  <g key={i}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={svgWidth - padding.right}
                      y2={y}
                      stroke={ratio === 0 ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.08)'}
                      strokeWidth={ratio === 0 ? 1.5 : 1}
                      strokeDasharray={ratio === 0 ? 'none' : '3 3'}
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      fill={ratio === 0 ? '#38bdf8' : '#64748b'}
                      fontSize="10"
                      fontWeight={ratio === 0 ? 700 : 400}
                      textAnchor="end"
                    >
                      {val > 0 ? `+${val.toLocaleString()}` : `${val.toLocaleString()}`}원
                    </text>
                  </g>
                );
              })
            )}

            {/* 막대 및 데이터 렌더링 */}
            {history.map((item, idx) => {
              const count = history.length;
              const groupWidth = plotWidth / count;
              const groupCenterX = padding.left + groupWidth * idx + groupWidth / 2;

              if (chartViewMode === 'comparison') {
                // 비교 모드: 월초 막대 vs 월말 막대 나란히 배치
                const barW = Math.min(32, groupWidth * 0.35);
                const startH = (item.startAsset / maxAssetVal) * plotHeight;
                const endH = (item.endAsset / maxAssetVal) * plotHeight;

                const startX = groupCenterX - barW - 3;
                const endX = groupCenterX + 3;
                const startY = padding.top + plotHeight - startH;
                const endY = padding.top + plotHeight - endH;

                const isHovered = hoveredMonth === item.yearMonth;

                return (
                  <g
                    key={item.yearMonth}
                    onMouseEnter={() => setHoveredMonth(item.yearMonth)}
                    onMouseLeave={() => setHoveredMonth(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* 월초 막대 */}
                    <rect
                      x={startX}
                      y={startY}
                      width={barW}
                      height={startH}
                      rx="4"
                      fill="url(#gradBarStart)"
                      opacity={isHovered ? 1 : 0.85}
                    />
                    {/* 월말/현재 막대 */}
                    <rect
                      x={endX}
                      y={endY}
                      width={barW}
                      height={endH}
                      rx="4"
                      fill="url(#gradBarEnd)"
                      opacity={isHovered ? 1 : 0.9}
                    />

                    {/* 월말 막대 위 금액 라벨 */}
                    <text
                      x={endX + barW / 2}
                      y={endY - 6}
                      fill="#38bdf8"
                      fontSize="10"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {item.endAsset.toLocaleString()}
                    </text>

                    {/* X축 월 라벨 */}
                    <text
                      x={groupCenterX}
                      y={padding.top + plotHeight + 20}
                      fill={item.isCurrent ? '#38bdf8' : '#94a3b8'}
                      fontSize="11"
                      fontWeight={item.isCurrent ? 700 : 500}
                      textAnchor="middle"
                    >
                      {item.shortLabel}
                      {item.isCurrent ? ' (현재)' : ''}
                    </text>
                  </g>
                );
              } else {
                // 증감 모드: 0선 기준 +/- 막대
                const barW = Math.min(42, groupWidth * 0.45);
                const zeroY = padding.top + plotHeight / 2;
                const barH = (Math.abs(item.changeKrw) / maxChangeAbs) * (plotHeight / 2);
                const barY = item.changeKrw >= 0 ? zeroY - barH : zeroY;
                const isHovered = hoveredMonth === item.yearMonth;

                return (
                  <g
                    key={item.yearMonth}
                    onMouseEnter={() => setHoveredMonth(item.yearMonth)}
                    onMouseLeave={() => setHoveredMonth(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={groupCenterX - barW / 2}
                      y={barY}
                      width={barW}
                      height={Math.max(2, barH)}
                      rx="4"
                      fill={item.changeKrw >= 0 ? 'url(#gradBarUp)' : 'url(#gradBarDown)'}
                      opacity={isHovered ? 1 : 0.85}
                    />

                    {/* 막대 위 증감액 라벨 */}
                    <text
                      x={groupCenterX}
                      y={item.changeKrw >= 0 ? barY - 6 : barY + barH + 14}
                      fill={item.changeKrw >= 0 ? '#f87171' : '#60a5fa'}
                      fontSize="10"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {item.changeKrw > 0 ? `+${item.changeKrw.toLocaleString()}` : `${item.changeKrw.toLocaleString()}`}원
                    </text>

                    {/* X축 월 라벨 */}
                    <text
                      x={groupCenterX}
                      y={padding.top + plotHeight + 20}
                      fill={item.isCurrent ? '#38bdf8' : '#94a3b8'}
                      fontSize="11"
                      fontWeight={item.isCurrent ? 700 : 500}
                      textAnchor="middle"
                    >
                      {item.shortLabel}
                      {item.isCurrent ? ' (현재)' : ''}
                    </text>
                  </g>
                );
              }
            })}
          </svg>
        </div>

        {/* 범례 및 안내 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginTop: '12px',
            paddingTop: '10px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            fontSize: '11px',
            color: '#64748b',
          }}
        >
          {chartViewMode === 'comparison' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#818cf8' }}></span>
                <span>월초 (1일 시점 자산)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#38bdf8' }}></span>
                <span>월말 / 현재 평가자산</span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#f87171' }}></span>
                <span>자산 증가 (+)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#60a5fa' }}></span>
                <span>자산 감소 (-)</span>
              </div>
            </div>
          )}

          <div>
            * 월말 도래 시 최종 평가자산이 확정 보존되며 매월 1일 자정에 다음 달 스냅샷이 신규 생성됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
