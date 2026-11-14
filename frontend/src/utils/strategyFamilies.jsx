import React from 'react';

export const STRATEGY_FAMILY_ORDER = ['BREAKOUT', 'TREND', 'REVERSION'];

export const STRATEGY_FAMILY_META = {
  BREAKOUT: {
    code: 'BREAKOUT',
    icon: '🚀',
    label: '돌파·모멘텀군',
    shortLabel: '돌파·모멘텀',
    tinyLabel: '돌파',
    color: '#fbbf24',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.45)',
    regimeHint: '강세장(BULLISH) 주도(100~120%) · 횡보장 가짜돌파 차단/고득점 제한 · 악재뉴스 즉시취소',
  },
  TREND: {
    code: 'TREND',
    icon: '📈',
    label: '추세·수급군',
    shortLabel: '추세·수급',
    tinyLabel: '추세',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.14)',
    border: 'rgba(56, 189, 248, 0.45)',
    regimeHint: '강세장 적극(100~115%) · 횡보장 눌림목/추세(80~100%) · 급락장 현금보호 차단',
  },
  REVERSION: {
    code: 'REVERSION',
    icon: '🎯',
    label: '평균회귀·스캘핑군',
    shortLabel: '평균회귀·스캘핑',
    tinyLabel: '회귀',
    color: '#34d399',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.45)',
    regimeHint: '횡보장 최적(100%) · 강세장 보수적 축소(50%) · 급락장 92점+ 극단과매도 30% 스나이핑',
  },
};

export function getBotStrategyFamily(botOrType) {
  if (!botOrType) return 'REVERSION';
  if (typeof botOrType === 'string') {
    const upper = botOrType.toUpperCase();
    if (STRATEGY_FAMILY_META[upper]) return upper;
  } else {
    const explicit = String(botOrType.strategy_family || '').toUpperCase();
    if (STRATEGY_FAMILY_META[explicit]) return explicit;
  }

  const type = String(typeof botOrType === 'string' ? botOrType : (botOrType?.strategy_type || '')).toUpperCase();
  switch (type) {
    case 'VOLATILITY_BREAKOUT':
    case 'MACD_VOLUME':
    case 'KELTNER_SQUEEZE':
    case 'JACK_KELLOGG_VWAP':
      return 'BREAKOUT';

    case 'DUAL_MOMENTUM':
    case 'SUPERTREND':
    case 'ICHIMOKU_BREAKOUT':
    case 'MA_PULLBACK':
      return 'TREND';

    case 'MEAN_REVERSION':
    case 'ENVELOPE_REVERSAL':
    case 'VWAP_STOCH_SCALP':
    default:
      return 'REVERSION';
  }
}

export function getStrategyFamilyMeta(botOrFamily) {
  const family = getBotStrategyFamily(botOrFamily);
  return STRATEGY_FAMILY_META[family] || STRATEGY_FAMILY_META.REVERSION;
}

export function summarizeFamilyCounts(botList = []) {
  const counts = { BREAKOUT: 0, TREND: 0, REVERSION: 0 };
  for (const bot of botList || []) {
    const f = getBotStrategyFamily(bot);
    counts[f] = (counts[f] || 0) + 1;
  }
  return counts;
}

export function StrategyFamilyBadge({ bot, family, compact = false, showCode = false }) {
  const meta = getStrategyFamilyMeta(family || bot);
  return (
    <span
      title={`${meta.label} (${meta.code}) — ${meta.regimeHint}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: compact ? '2px 7px' : '3px 9px',
        borderRadius: '999px',
        fontSize: compact ? '10.5px' : '11.5px',
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      <span>{meta.icon}</span>
      <span>{compact ? meta.tinyLabel : meta.shortLabel}</span>
      {showCode && (
        <span style={{ fontSize: '9.5px', opacity: 0.78, fontWeight: 600 }}>
          {meta.code}
        </span>
      )}
    </span>
  );
}
