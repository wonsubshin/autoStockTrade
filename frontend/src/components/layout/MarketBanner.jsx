import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import {
  sendMarketAnalysisPushNotification,
  requestNotificationPermission,
  getNotificationPermission,
  testMarketAnalysisNotification,
} from '../../services/notificationService';

// ============================================================================
// 5.4 커스텀 마크다운 렌더러 (MarkdownViewer)
// - #, ##, ### 헤더 스타일링 (하단 보더 및 포인트 컬러)
// - - 또는 * 불릿 리스트 렌더링 (좌측 파란색 포인트 불릿 • 배치)
// - **볼드 텍스트** 정규식(/\*\*(.*?)\*\*/g) 파싱 -> 하늘색(#38bdf8) 강조 및 fontWeight: 700
// - 스트리밍 진행 중(isStreaming === true)일 때 마지막 줄 끝에 깜빡이는 수직 커서 렌더링
// ============================================================================
function renderInlineBold(text) {
  if (!text) return null;
  const parts = String(text).split(/\*\*(.*?)\*\*/g);
  return parts.map((part, idx) => {
    if (idx % 2 === 1) {
      return (
        <strong key={idx} style={{ color: '#38bdf8', fontWeight: 700 }}>
          {part}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function MarkdownViewer({ content, isStreaming }) {
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (content && typeof content === 'object') {
    const parts = [];
    if (content.krMarket || content.kr) parts.push(`### 🇰🇷 [한국 주식 시장 (KRX)]\n- ${content.krMarket || content.kr}`);
    if (content.usMarket || content.us) parts.push(`### 🇺🇸 [미국 주식 시장 (US)]\n- ${content.usMarket || content.us}`);
    if (content.botDiagnostic || content.bot) parts.push(`### 🤖 [실전 봇 진단]\n- ${content.botDiagnostic || content.bot}`);
    if (parts.length > 0) {
      raw = parts.join('\n\n');
    } else {
      raw = Object.entries(content)
        .map(([k, v]) => (typeof v === 'string' ? `- **${k}**: ${v}` : ''))
        .filter(Boolean)
        .join('\n\n') || JSON.stringify(content, null, 2);
    }
  } else {
    raw = String(content || '');
  }
  const lines = raw.split('\n');

  return (
    <div className="ai-markdown-viewer" style={{ fontSize: '13.5px', lineHeight: 1.75, color: '#e2e8f0' }}>
      {lines.map((line, index) => {
        const isLastLine = index === lines.length - 1;
        const trimmed = line.trim();
        const cursorNode = isStreaming && isLastLine ? (
          <span
            style={{
              display: 'inline-block',
              width: '2px',
              height: '15px',
              backgroundColor: '#38bdf8',
              marginLeft: '4px',
              verticalAlign: 'middle',
              animation: 'cursorBlink 0.8s infinite',
            }}
          />
        ) : null;

        if (!trimmed) {
          return (
            <div key={index} style={{ height: '8px' }}>
              {cursorNode}
            </div>
          );
        }

        if (trimmed.startsWith('### ')) {
          return (
            <h4
              key={index}
              style={{
                fontSize: '14.5px',
                fontWeight: 700,
                color: '#7dd3fc',
                marginTop: '14px',
                marginBottom: '6px',
                paddingBottom: '4px',
                borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
              }}
            >
              {renderInlineBold(trimmed.slice(4))}
              {cursorNode}
            </h4>
          );
        }

        if (trimmed.startsWith('## ')) {
          return (
            <h3
              key={index}
              style={{
                fontSize: '15.5px',
                fontWeight: 800,
                color: '#c084fc',
                marginTop: index === 0 ? '4px' : '18px',
                marginBottom: '8px',
                paddingBottom: '6px',
                borderBottom: '1px solid rgba(192, 132, 252, 0.3)',
              }}
            >
              {renderInlineBold(trimmed.slice(3))}
              {cursorNode}
            </h3>
          );
        }

        if (trimmed.startsWith('# ')) {
          return (
            <h2
              key={index}
              style={{
                fontSize: '16.5px',
                fontWeight: 800,
                color: '#f8fafc',
                marginTop: '16px',
                marginBottom: '10px',
                paddingBottom: '6px',
                borderBottom: '1px solid rgba(148, 163, 184, 0.35)',
              }}
            >
              {renderInlineBold(trimmed.slice(2))}
              {cursorNode}
            </h2>
          );
        }

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const bulletBody = trimmed.slice(2);
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                paddingLeft: '6px',
                marginBottom: '5px',
              }}
            >
              <span style={{ color: '#38bdf8', fontWeight: 800, flexShrink: 0, marginTop: '1px' }}>•</span>
              <div style={{ flex: 1 }}>
                {renderInlineBold(bulletBody)}
                {cursorNode}
              </div>
            </div>
          );
        }

        return (
          <p key={index} style={{ marginBottom: '6px' }}>
            {renderInlineBold(line)}
            {cursorNode}
          </p>
        );
      })}
    </div>
  );
}

function formatKstTimestamp(isoOrStr) {
  if (!isoOrStr) return '';
  const d = new Date(isoOrStr);
  if (isNaN(d.getTime())) return String(isoOrStr);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

export default function MarketBanner({
  aiQuota,
  onQuotaUpdate,
  onShowModal,
  onRefreshAiDecisions,
}) {
  // 5.1 기본 상태: 초기 렌더링 시 접힘(isAiBriefingExpanded = false) 상태로 시작
  const [isAiBriefingExpanded, setIsAiBriefingExpanded] = useState(false);

  // 브리핑 데이터 및 API 키 상태
  const [aiBriefing, setAiBriefing] = useState(null);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);

  // 웹푸시(Web Push) 알림 상태
  const [pushPermission, setPushPermission] = useState(() => getNotificationPermission());
  const hasNotifiedRef = useRef(false);
  const lastBriefingIdRef = useRef(null);

  // 스트리밍 및 18ms 적응형 타이프라이터 엔진 상태
  const [aiStreaming, setAiStreaming] = useState(false);
  const [streamStage, setStreamStage] = useState(''); // 'CONNECTING' | 'STREAMING'
  const typewriterQueueRef = useRef('');
  const typingTimerRef = useRef(null);
  const isStreamDoneRef = useRef(false);
  const abortControllerRef = useRef(null);

  // 초기 및 주기적 브리핑 상태 로드
  const loadBriefingState = useCallback(async () => {
    if (aiStreaming) return;
    try {
      const data = await api.getAiBriefing();
      if (data.latest) {
        if (lastBriefingIdRef.current && data.latest.id && data.latest.id !== lastBriefingIdRef.current) {
          sendMarketAnalysisPushNotification({
            title: '시황 분석이 끝났습니다',
            body: data.latest.trigger_type === 'AUTO'
              ? '⏰ 정기 Gemini AI 증시 뉴스 및 한·미 시장 분석이 완료되었습니다.'
              : 'AI 증시 뉴스 및 한·미 시장 종합 분석이 완료되었습니다.',
            url: '/',
          });
        }
        lastBriefingIdRef.current = data.latest.id;
        setAiBriefing(data.latest);
      }
      setHasKey(!!data.has_key);
      setMaskedKey(data.masked_key || '');
      if (data.quota && onQuotaUpdate) {
        onQuotaUpdate(data.quota);
      }
    } catch {}
  }, [aiStreaming, onQuotaUpdate]);

  useEffect(() => {
    loadBriefingState();
    const timer = setInterval(loadBriefingState, 15000);
    return () => clearInterval(timer);
  }, [loadBriefingState]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // 5.3 18ms 적응형 큐 기반 타이프라이터(Typewriter) 엔진
  const startTypewriter = useCallback(() => {
    if (typingTimerRef.current) return;
    typingTimerRef.current = setInterval(() => {
      const qLen = typewriterQueueRef.current.length;
      if (qLen > 0) {
        const take = qLen > 80 ? 4 : qLen > 30 ? 2 : 1;
        const nextChars = typewriterQueueRef.current.slice(0, take);
        typewriterQueueRef.current = typewriterQueueRef.current.slice(take);
        setAiBriefing((prev) => ({
          ...(prev || {}),
          briefing_text: ((prev && prev.briefing_text) || '') + nextChars,
        }));
      } else if (isStreamDoneRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
        setAiStreaming(false);
        setStreamStage('');
        if (!hasNotifiedRef.current) {
          hasNotifiedRef.current = true;
          sendMarketAnalysisPushNotification({
            title: '시황 분석이 끝났습니다',
            body: 'AI 증시 뉴스 및 한·미 시장 종합 분석이 완료되었습니다.',
            url: '/',
          });
        }
      }
    }, 18);
  }, []);

  // 웹푸시 테스트 및 권한 요청 핸들러
  const handleTestPushNotification = async () => {
    const res = await testMarketAnalysisNotification();
    setPushPermission(res.permission);
    if (!res.success && res.permission === 'denied') {
      if (onShowModal) {
        onShowModal({
          title: '웹푸시 알림 권한 차단됨',
          message: '브라우저 주소창 좌측의 설정/자물쇠 아이콘을 클릭하여 [알림] 권한을 "허용"으로 변경해주세요.',
          type: 'warning',
        });
      }
    } else if (res.success) {
      if (onShowModal) {
        onShowModal({
          title: '웹푸시 알림 테스트 성공',
          message: '"시황 분석이 끝났습니다" 웹푸시 알림이 발송되었습니다.\n뉴스 분석이 끝나면 브라우저 및 OS 알림으로 실시간 수신됩니다.',
          type: 'info',
        });
      }
    }
  };

  // [⚡ AI 시황 분석 요청] 클릭 핸들러 (SSE 스트리밍)
  const handleRequestStreamAnalyze = async () => {
    const remainingCalls = aiQuota?.remaining_calls ?? aiQuota?.remainingManualCalls ?? 14;
    if (remainingCalls <= 0) {
      if (onShowModal) {
        onShowModal({
          title: '무료 API 호출 한도 안내',
          message: '금일 무료 api 호출 한도에 도달했습니다. 내일 다시 시도해주세요',
          type: 'warning',
        });
      }
      return;
    }

    if (aiStreaming) return;

    // 사용자 제스처(버튼 클릭) 시점에 브라우저 알림 권한 선제 요청
    if (pushPermission === 'default') {
      requestNotificationPermission().then((granted) => {
        setPushPermission(getNotificationPermission());
      });
    }

    hasNotifiedRef.current = false;

    // 1. 카드가 접혀 있으면 자동으로 펼침
    setIsAiBriefingExpanded(true);

    // 2. 기존 타이머/스트림 정리 및 초기화
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    typewriterQueueRef.current = '';
    isStreamDoneRef.current = false;
    setAiStreaming(true);
    setStreamStage('CONNECTING');
    setAiBriefing((prev) => ({
      ...(prev || {}),
      briefing_text: '',
      trigger_type: 'MANUAL',
      created_at: new Date().toISOString(),
    }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/ai/stream-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 429) {
        const errData = await response.json().catch(() => ({}));
        setAiStreaming(false);
        setStreamStage('');
        if (errData.quota && onQuotaUpdate) onQuotaUpdate(errData.quota);
        if (onShowModal) {
          onShowModal({
            title: '무료 API 호출 한도 안내',
            message: errData.message || '금일 무료 api 호출 한도에 도달했습니다. 내일 다시 시도해주세요',
            type: 'warning',
          });
        }
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error(`스트리밍 요청 실패 (${response.status})`);
      }

      setStreamStage('STREAMING');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const frame of parts) {
          const lines = frame.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const payload = JSON.parse(jsonStr);
              if (payload.type === 'meta') {
                setAiBriefing((prev) => ({
                  ...(prev || {}),
                  kr_index_price: payload.kr_index_price,
                  kr_daily_20ma: payload.kr_daily_20ma,
                  kr_intraday_60ma: payload.kr_intraday_60ma,
                  kr_regime_status: payload.kr_regime_status,
                  us_index_price: payload.us_index_price,
                  us_daily_20ma: payload.us_daily_20ma,
                  us_intraday_60ma: payload.us_intraday_60ma,
                  us_regime_status: payload.us_regime_status,
                  usd_krw_rate: payload.usd_krw_rate,
                  regime_status: payload.regime_status,
                  llm_algo_status: payload.llm_algo_status || prev?.llm_algo_status,
                  trigger_type: payload.trigger_type || 'MANUAL',
                }));
                if (payload.quota && onQuotaUpdate) {
                  onQuotaUpdate(payload.quota);
                }
              } else if (payload.type === 'chunk' && payload.text) {
                typewriterQueueRef.current += payload.text;
                startTypewriter();
              } else if (payload.type === 'done') {
                isStreamDoneRef.current = true;
                if (!hasNotifiedRef.current) {
                  hasNotifiedRef.current = true;
                  sendMarketAnalysisPushNotification({
                    title: '시황 분석이 끝났습니다',
                    body: 'AI 실시간 시황 및 봇 진단 분석이 완료되었습니다.',
                    url: '/',
                  });
                }
                if (payload.id) {
                  lastBriefingIdRef.current = payload.id;
                }
                setAiBriefing((prev) => ({
                  ...(prev || {}),
                  id: payload.id,
                  model: payload.model || prev?.model || 'gemini-3.5-flash-lite',
                  created_at: payload.created_at || prev?.created_at,
                  trigger_type: payload.trigger_type || 'MANUAL',
                }));
                if (payload.quota && onQuotaUpdate) {
                  onQuotaUpdate(payload.quota);
                }
                if (onRefreshAiDecisions) {
                  onRefreshAiDecisions();
                }
                startTypewriter();
              }
            } catch {}
          }
        }
      }

      isStreamDoneRef.current = true;
      startTypewriter();
    } catch (err) {
      if (err.name === 'AbortError') return;
      isStreamDoneRef.current = true;
      setAiStreaming(false);
      setStreamStage('');
      if (onShowModal) {
        onShowModal({
          title: 'AI 시황 분석 오류',
          message: err.message || '스트리밍 중 오류가 발생했습니다.',
          type: 'error',
        });
      }
    }
  };

  // 인라인 API 키 저장 핸들러
  const handleSaveApiKey = async (e) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setIsSavingKey(true);
    try {
      const res = await api.saveAiKey(keyInput.trim());
      setHasKey(!!res.has_key);
      setMaskedKey(res.masked_key || '');
      setKeyInput('');
      setShowKeyForm(false);
      if (res.quota && onQuotaUpdate) onQuotaUpdate(res.quota);
      if (onShowModal) {
        onShowModal({
          title: 'Gemini API 키 저장 완료',
          message: 'Gemini API 키가 안전하게 저장되었습니다. 이제 실시간 AI 시황 분석 및 봇 진단을 사용할 수 있습니다.',
          type: 'success',
        });
      }
    } catch (err) {
      if (onShowModal) {
        onShowModal({
          title: 'API 키 저장 실패',
          message: err.message,
          type: 'error',
        });
      }
    } finally {
      setIsSavingKey(false);
    }
  };

  const remainingCalls = aiQuota?.remaining_calls ?? aiQuota?.remainingManualCalls ?? 14;
  const manualLimit = aiQuota?.manual_limit ?? aiQuota?.manualDailyLimit ?? 14;
  const nextScheduledAt = aiQuota?.next_scheduled_at || aiQuota?.nextAutoSlotLabel || '00:00';

  // 잔여 횟수 색상 분기: 0건(적색 #f87171), 1~3건(황색 #fbbf24), 4건 이상(녹색 #34d399)
  const quotaColor =
    remainingCalls <= 0 ? '#f87171' : remainingCalls <= 3 ? '#fbbf24' : '#34d399';
  const quotaBg =
    remainingCalls <= 0
      ? 'rgba(239, 68, 68, 0.18)'
      : remainingCalls <= 3
      ? 'rgba(245, 158, 11, 0.18)'
      : 'rgba(16, 185, 129, 0.15)';
  const quotaBorder =
    remainingCalls <= 0
      ? 'rgba(239, 68, 68, 0.45)'
      : remainingCalls <= 3
      ? 'rgba(245, 158, 11, 0.45)'
      : 'rgba(16, 185, 129, 0.4)';

  const krPrice = aiBriefing?.kr_index_price ?? 2580;
  const kr20Ma = aiBriefing?.kr_daily_20ma ?? 2565;
  const kr60Ma = aiBriefing?.kr_intraday_60ma ?? 2572;
  const isKrHold = aiBriefing?.kr_regime_status === 'HOLD_CASH';

  const usPrice = aiBriefing?.us_index_price ?? 502.4;
  const us20Ma = aiBriefing?.us_daily_20ma ?? 498.1;
  const us60Ma = aiBriefing?.us_intraday_60ma ?? 500.2;
  const isUsHold = aiBriefing?.us_regime_status === 'HOLD_CASH';

  const usdKrwRate = aiBriefing?.usd_krw_rate ?? 1385;
  const triggerType = aiBriefing?.trigger_type || 'AUTO';
  const createdAtStr = formatKstTimestamp(aiBriefing?.created_at);

  const llmAlgo = aiBriefing?.llm_algo_status || {};
  const isAlgoProceeding = llmAlgo.is_proceeding !== false;
  const algoStatusCode = llmAlgo.status_code || 'ACTIVE';
  const algoBadgeText =
    llmAlgo.badge_text ||
    (isAlgoProceeding ? '🟢 알고리즘 매매 정상 진행 (비중 100%)' : '🔴 신규 매수 차단 (청산만 진행)');
  const algoBuyCount = llmAlgo.buy_count ?? 10;
  const algoHoldCount = llmAlgo.hold_count ?? 11;
  const algoSellCount = llmAlgo.sell_count ?? 0;
  const algoTopBuys = Array.isArray(llmAlgo.top_buy_stocks) && llmAlgo.top_buy_stocks.length > 0
    ? llmAlgo.top_buy_stocks.slice(0, 3).join(', ')
    : '엔비디아(NVDA), QQQ, SK하이닉스';

  // 🇰🇷 한국 및 🇺🇸 미국 분리 LLM 매매 판정 상태
  const krAlgo = llmAlgo.kr || {
    statusCode: isKrHold ? 'HALT_NEW_BUYS' : algoStatusCode,
    badgeText: isKrHold ? '🔴 국내 온주 매수 차단' : '🟢 국내 온주 정상 매매',
    detailText: isKrHold ? '코스피 급락 및 리스크 경보' : '국내 지수 및 20일선 정상',
    buyCount: 0,
  };
  const usAlgo = llmAlgo.us || {
    statusCode: isUsHold ? 'HALT_NEW_BUYS' : 'ACTIVE',
    badgeText: isUsHold ? '🔴 미국 소수점 매수 차단' : '🟢 미국 소수점 정상 매매',
    detailText: isUsHold ? '미국 증시 급락 경보' : '나스닥/S&P500 안정적 추세',
    buyCount: algoBuyCount,
  };

  return (
    <div
      className="ai-briefing-accordion-card"
      style={{
        background: 'linear-gradient(135deg, rgba(19, 27, 46, 0.95), rgba(15, 23, 42, 0.98))',
        border: '1px solid rgba(139, 92, 246, 0.4)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '22px',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* ====================================================================
          5.1 아코디언 헤더 (좌측 타이틀/요약 뱃지 + 우측 액션 바)
          ==================================================================== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* 헤더 좌측 영역 (클릭 시 펼치기/접기 토글) */}
        <div
          onClick={() => setIsAiBriefingExpanded((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            cursor: 'pointer',
            flex: 1,
            minWidth: '280px',
          }}
        >
          <span style={{ fontSize: '15.5px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
            🤖 AI 실시간 한·미 시장 분석 & 봇 진단
          </span>

          {/* 모델 뱃지 (보라색 네온 스타일 #c084fc) */}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(192, 132, 252, 0.16)',
              color: '#c084fc',
              border: '1px solid rgba(192, 132, 252, 0.45)',
            }}
          >
            {aiBriefing?.model || 'Gemini Flash/Pro'}
          </span>

          {/* 자동갱신 뱃지 (title 툴팁에 다음 예정 시각 next_scheduled_at 표시) */}
          <span
            title={`다음 자동 분석: 30분 단위 Flash 종합 판단 & 1시간 단위 Pro 심층 분석 (다음 예정: ${nextScheduledAt})`}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.14)',
              color: '#7dd3fc',
              border: '1px solid rgba(56, 189, 248, 0.35)',
            }}
          >
            ⚡ 30분(Flash) · 🏛️ 60분(Pro) 자동갱신
          </span>

          {/* 생성 시각 및 트리거 표시 */}
          {createdAtStr && (
            <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
              ({createdAtStr} · {triggerType === 'MANUAL' ? '⚡수동분석' : '⏰자동갱신'})
            </span>
          )}

          {/* 접혀 있을 때(!isAiBriefingExpanded) 요약 뱃지 */}
          {!isAiBriefingExpanded && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span
                title={krAlgo.detailText || '한국 시장 체제 및 국내 온주 매매 지침'}
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: krAlgo.statusCode === 'HALT_NEW_BUYS' || isKrHold
                    ? 'rgba(239, 68, 68, 0.18)'
                    : krAlgo.statusCode === 'REDUCE_SIZE'
                    ? 'rgba(245, 158, 11, 0.18)'
                    : 'rgba(16, 185, 129, 0.16)',
                  color: krAlgo.statusCode === 'HALT_NEW_BUYS' || isKrHold
                    ? '#fca5a5'
                    : krAlgo.statusCode === 'REDUCE_SIZE'
                    ? '#fbbf24'
                    : '#6ee7b7',
                  border: krAlgo.statusCode === 'HALT_NEW_BUYS' || isKrHold
                    ? '1px solid rgba(239, 68, 68, 0.45)'
                    : krAlgo.statusCode === 'REDUCE_SIZE'
                    ? '1px solid rgba(245, 158, 11, 0.45)'
                    : '1px solid rgba(16, 185, 129, 0.4)',
                }}
              >
                🇰🇷 {krAlgo.badgeText} · KOSPI {Number(krPrice).toLocaleString()}
              </span>
              <span
                title={usAlgo.detailText || '미국 시장 체제 및 미국 소수점 매매 지침'}
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: usAlgo.statusCode === 'HALT_NEW_BUYS' || isUsHold
                    ? 'rgba(239, 68, 68, 0.18)'
                    : usAlgo.statusCode === 'REDUCE_SIZE'
                    ? 'rgba(245, 158, 11, 0.18)'
                    : 'rgba(56, 189, 248, 0.16)',
                  color: usAlgo.statusCode === 'HALT_NEW_BUYS' || isUsHold
                    ? '#fca5a5'
                    : usAlgo.statusCode === 'REDUCE_SIZE'
                    ? '#fbbf24'
                    : '#38bdf8',
                  border: usAlgo.statusCode === 'HALT_NEW_BUYS' || isUsHold
                    ? '1px solid rgba(239, 68, 68, 0.45)'
                    : usAlgo.statusCode === 'REDUCE_SIZE'
                    ? '1px solid rgba(245, 158, 11, 0.45)'
                    : '1px solid rgba(56, 189, 248, 0.45)',
                }}
              >
                🇺🇸 {usAlgo.badgeText} · QQQ ${Number(usPrice).toLocaleString()}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(148, 163, 184, 0.14)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                }}
              >
                📊 BUY {algoBuyCount}건 · HOLD {algoHoldCount}건
              </span>
            </div>
          )}
        </div>

        {/* 헤더 우측 액션 바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* 무료 API 잔여 건수 뱃지 */}
          <span
            style={{
              fontSize: '11.5px',
              fontWeight: 700,
              padding: '5px 10px',
              borderRadius: '6px',
              background: quotaBg,
              color: quotaColor,
              border: `1px solid ${quotaBorder}`,
            }}
            title={`일일 총 무료 한도 ${aiQuota?.daily_total_limit || 50}건 중 정기 자동배치 예약(${aiQuota?.auto_reserved_count || 36}건)을 제외한 수동 호출 가능 잔여 건수 (다음 자동갱신: ${nextScheduledAt})`}
          >
            무료 API 잔여: {remainingCalls}/{manualLimit}건 (자동예약 제외)
          </span>

          {/* [⚡ AI 시황 분석 요청 ({remaining_calls}건 남음)] 버튼 */}
          <button
            type="button"
            className="btn-action"
            onClick={handleRequestStreamAnalyze}
            disabled={aiStreaming}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              background: aiStreaming
                ? 'rgba(139, 92, 246, 0.25)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              borderColor: 'rgba(167, 139, 250, 0.5)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {aiStreaming ? (
              <>
                <span className="ai-spin-icon" style={{ display: 'inline-block' }}>⏳</span>
                <span>{streamStage === 'CONNECTING' ? 'Gemini 연결 중...' : '실시간 스트리밍 중...'}</span>
              </>
            ) : (
              <span>⚡ AI 시황 분석 요청 ({remainingCalls}건 남음)</span>
            )}
          </button>

          {/* 웹푸시(Web Push) 알림 상태 버튼 (클릭 시 권한 요청 및 테스트 발송) */}
          {pushPermission === 'granted' ? (
            <button
              type="button"
              className="btn-action"
              onClick={handleTestPushNotification}
              title="웹푸시 알림 활성화됨 (클릭 시 테스트 알림 발송)"
              style={{
                padding: '6px 10px',
                fontSize: '11.5px',
                background: 'rgba(56, 189, 248, 0.16)',
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
              }}
            >
              🔔 웹푸시 ON
            </button>
          ) : pushPermission === 'denied' ? (
            <button
              type="button"
              className="btn-action"
              onClick={handleTestPushNotification}
              title="브라우저 주소창 좌측 자물쇠 아이콘에서 알림 권한을 '허용'으로 변경해주세요"
              style={{
                padding: '6px 10px',
                fontSize: '11.5px',
                background: 'rgba(239, 68, 68, 0.16)',
                color: '#fca5a5',
                borderColor: 'rgba(239, 68, 68, 0.4)',
              }}
            >
              🔕 웹푸시 차단됨
            </button>
          ) : (
            <button
              type="button"
              className="btn-action"
              onClick={handleTestPushNotification}
              title="시황 분석 완료 시 웹푸시 알림을 받으려면 클릭하여 허용해주세요"
              style={{
                padding: '6px 10px',
                fontSize: '11.5px',
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#fbbf24',
                borderColor: 'rgba(245, 158, 11, 0.4)',
              }}
            >
              🔔 웹푸시 알림 켜기
            </button>
          )}

          {/* [⚙️ API 키 설정됨 / API 키 등록] 버튼 */}
          <button
            type="button"
            className="btn-action"
            onClick={() => setShowKeyForm((prev) => !prev)}
            style={{
              padding: '6px 10px',
              fontSize: '11.5px',
              background: hasKey ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.16)',
              color: hasKey ? '#34d399' : '#fbbf24',
              borderColor: hasKey ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)',
            }}
          >
            ⚙️ {hasKey ? 'API 키 설정됨' : 'API 키 등록'}
          </button>

          {/* [▲ 분석 접기 / ▼ 분석 펼치기] 버튼 */}
          <button
            type="button"
            className="btn-action"
            onClick={() => setIsAiBriefingExpanded((prev) => !prev)}
            style={{ padding: '6px 10px', fontSize: '11.5px', color: '#cbd5e1' }}
          >
            {isAiBriefingExpanded ? '▲ 분석 접기' : '▼ 분석 펼치기'}
          </button>
        </div>
      </div>

      {/* 인라인 API 키 입력 폼 */}
      {showKeyForm && (
        <form
          onSubmit={handleSaveApiKey}
          style={{
            marginTop: '12px',
            padding: '12px 14px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
            🔑 Gemini API Key {maskedKey ? `(현재: ${maskedKey})` : '(미등록)'}:
          </span>
          <input
            type="password"
            className="input-field"
            placeholder="AIzaSy... 로 시작하는 Gemini API 키 입력"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ flex: 1, minWidth: '240px', padding: '7px 12px', fontSize: '12.5px' }}
          />
          <button
            type="submit"
            className="btn-action success"
            disabled={isSavingKey}
            style={{ padding: '7px 14px', fontSize: '12px' }}
          >
            {isSavingKey ? '저장 중...' : '💾 키 저장'}
          </button>
          <button
            type="button"
            className="btn-action"
            onClick={() => setShowKeyForm(false)}
            style={{ padding: '7px 12px', fontSize: '12px' }}
          >
            닫기
          </button>
        </form>
      )}

      {/* ====================================================================
          5.2 펼쳐졌을 때 본문 영역 (상단 메타 요약 바 + 커스텀 마크다운 뷰어)
          ==================================================================== */}
      {isAiBriefingExpanded && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
          {/* 상단 메타 요약 바 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px 14px',
              marginBottom: '14px',
              background: 'rgba(9, 13, 24, 0.75)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#cbd5e1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span>
                  🇰🇷 <strong>KOSPI</strong>: {Number(krPrice).toLocaleString()} | 일봉20MA: {Number(kr20Ma).toLocaleString()} | 60분60MA: {Number(kr60Ma).toLocaleString()} | 체제:{' '}
                  <strong style={{ color: isKrHold ? '#f87171' : '#34d399' }}>
                    [{isKrHold ? '🔴 신규 매수 차단' : '🟢 정상 매수 허용'}]
                  </strong>
                </span>
                <span>
                  🇺🇸 <strong>NASDAQ(QQQ)</strong>: ${Number(usPrice).toLocaleString()} | 일봉20MA: ${Number(us20Ma).toLocaleString()} | 60분60MA: ${Number(us60Ma).toLocaleString()} | 체제:{' '}
                  <strong style={{ color: isUsHold ? '#f87171' : '#34d399' }}>
                    [{isUsHold ? '🔴 신규 매수 차단' : '🟢 정상 매수 허용'}]
                  </strong>
                </span>
                <span>
                  💱 <strong>원/달러 환율(USD/KRW)</strong>: {Number(usdKrwRate).toLocaleString()}원
                </span>
              </div>

              {aiStreaming && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#38bdf8',
                    fontWeight: 700,
                    fontSize: '11.5px',
                  }}
                >
                  <span className="mode-pulse-dot virtual" />
                  <span>한 자씩 실시간 타이핑 중...</span>
                </div>
              )}
            </div>

            {/* LLM 판단 알고리즘 매매 진행 여부 & 예약대기 작동 원리 */}
            <div
              style={{
                paddingTop: '8px',
                borderTop: '1px dashed rgba(148, 163, 184, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span>
                    🇰🇷 <strong>한국 시장 LLM 매매판정</strong>:{' '}
                    <strong
                      style={{
                        color: krAlgo.statusCode === 'HALT_NEW_BUYS'
                          ? '#f87171'
                          : krAlgo.statusCode === 'REDUCE_SIZE'
                          ? '#fbbf24'
                          : '#34d399',
                      }}
                    >
                      [{krAlgo.badgeText}]
                    </strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
                      ({krAlgo.detailText})
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span>
                    🇺🇸 <strong>미국 시장 LLM 매매판정</strong>:{' '}
                    <strong
                      style={{
                        color: usAlgo.statusCode === 'HALT_NEW_BUYS'
                          ? '#f87171'
                          : usAlgo.statusCode === 'REDUCE_SIZE'
                          ? '#fbbf24'
                          : '#34d399',
                      }}
                    >
                      [{usAlgo.badgeText}]
                    </strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
                      ({usAlgo.detailText})
                    </span>
                  </span>
                  <span>
                    | 📊 <strong>전체 LLM 신호</strong>: 매수(BUY) <strong style={{ color: '#34d399' }}>{algoBuyCount}건</strong> · 관망(HOLD) <strong>{algoHoldCount}건</strong> · 매도(SELL) <strong style={{ color: '#f87171' }}>{algoSellCount}건</strong>
                  </span>
                </div>
              </div>
              <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                📌 <strong>[⏳ 소수점 예약대기] 의사결정 구조</strong>: ① <strong>청산대기(매도)</strong>는 각 봇의 <strong style={{ color: '#e2e8f0' }}>퀀트 목표 익절/손절 기준 도달</strong> 또는 <strong style={{ color: '#fca5a5' }}>LLM 뉴스 악재(SELL) 권고</strong> 시 발동하며, ② <strong>매수예정(신규 진입)</strong>은 <strong style={{ color: '#38bdf8' }}>100% LLM이 판단한 호재(BUY, 확신도 65%↑) 추천 결과</strong>를 기반으로 선정되어 미국 정규장(23:30 KST) 개장 즉시 자동 체결됩니다.
              </div>
            </div>
          </div>

          {/* 마크다운 브리핑 본문 */}
          <div
            style={{
              background: 'rgba(9, 13, 24, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '10px',
              padding: '18px 20px',
              maxHeight: '540px',
              overflowY: 'auto',
            }}
          >
            <MarkdownViewer
              content={
                aiBriefing?.briefing_text ||
                (aiStreaming
                  ? '실시간 한·미 시장 체제(Regime) 및 자동매매 봇 포지션 데이터를 수집하여 브리핑을 작성 중입니다...'
                  : '상단의 [⚡ AI 시황 분석 요청] 버튼을 클릭하시면 실시간 한·미 시장 체제 및 봇 진단 리포트가 스트리밍됩니다.')
              }
              isStreaming={aiStreaming}
            />
          </div>
        </div>
      )}
    </div>
  );
}
