import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { MarkdownViewer } from '../layout/MarketBanner';
import {
  sendMarketAnalysisPushNotification,
  requestNotificationPermission,
  getNotificationPermission,
  testMarketAnalysisNotification,
} from '../../services/notificationService';

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

export default function NewsPanel({
  newsList,
  newsCounts,
  newsPagination,
  newsQuery,
  setNewsQuery,
  selectedTag,
  setSelectedTag,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onFetchNews,
  onRefreshNews,
  aiQuota,
  latestAnalysis: parentLatestAnalysis,
  onQuotaUpdate,
  onShowModal,
  onRefreshAiDecisions,
}) {
  // 뉴스 메뉴 진입 시 AI 종합 시장 판단 아코디언 기본 펼침(true) 상태
  const [isAccordionOpen, setIsAccordionOpen] = useState(true);

  // 30분(Flash) 및 60분(Pro) 다중 LLM 자동 분석 및 수동 분석 브리핑 상태
  const [aiBriefing, setAiBriefing] = useState(null);
  const [localLatestAnalysis, setLocalLatestAnalysis] = useState(null);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);

  // 웹푸시(Web Push) 알림 상태
  const [pushPermission, setPushPermission] = useState(() => getNotificationPermission());
  const hasNotifiedRef = useRef(false);
  const lastBriefingIdRef = useRef(null);

  // SSE 실시간 스트리밍 및 18ms 적응형 타이프라이터 엔진 상태
  const [aiStreaming, setAiStreaming] = useState(false);
  const [streamStage, setStreamStage] = useState(''); // 'CONNECTING' | 'STREAMING'
  const typewriterQueueRef = useRef('');
  const typingTimerRef = useRef(null);
  const isStreamDoneRef = useRef(false);
  const abortControllerRef = useRef(null);

  // 초기 및 15초 주기 브리핑 상태 동기화 (30분 Flash & 60분 Pro 자동 분석 결과 즉시 반영)
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
            url: '/#news',
          });
        }
        lastBriefingIdRef.current = data.latest.id;
        setAiBriefing(data.latest);
      }
      if (data.latest_analysis) {
        setLocalLatestAnalysis(data.latest_analysis);
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

  // 18ms 적응형 큐 기반 타이프라이터(Typewriter) 엔진
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
            url: '/#news',
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

  // [⚡ AI 종합 시장·뉴스 분석 요청] 수동 스트리밍 실행 핸들러
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
    setIsAccordionOpen(true);

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
                    body: 'AI 증시 뉴스 및 한·미 시장 종합 분석이 완료되었습니다.',
                    url: '/#news',
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
                loadBriefingState();
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
          message: 'Gemini API 키가 안전하게 저장되었습니다. 이제 실시간 AI 종합 시장 판단 및 뉴스 진단을 사용할 수 있습니다.',
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

  const speakText = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  const remainingCalls = aiQuota?.remaining_calls ?? aiQuota?.remainingManualCalls ?? 14;
  const manualLimit = aiQuota?.manual_limit ?? aiQuota?.manualDailyLimit ?? 14;
  const nextScheduledAt = aiQuota?.next_scheduled_at || aiQuota?.nextAutoSlotLabel || '00:00';

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

  const mergedLatestAnalysis = localLatestAnalysis || parentLatestAnalysis;
  const krAction = mergedLatestAnalysis?.krRegime?.action || mergedLatestAnalysis?.llm_algo_status?.kr?.statusCode || aiBriefing?.kr_regime_status;
  const isKrHold = krAction === 'HOLD_CASH' || krAction === 'HALT_NEW_BUYS';
  const isKrReduced = !isKrHold && (krAction === 'REDUCE_SIZE' || (mergedLatestAnalysis?.krRegime?.multiplier > 0 && mergedLatestAnalysis?.krRegime?.multiplier < 1.0));

  const usAction = mergedLatestAnalysis?.usRegime?.action || mergedLatestAnalysis?.llm_algo_status?.us?.statusCode || aiBriefing?.us_regime_status;
  const isUsHold = usAction === 'HOLD_CASH' || usAction === 'HALT_NEW_BUYS';
  const isUsReduced = !isUsHold && (usAction === 'REDUCE_SIZE' || (mergedLatestAnalysis?.usRegime?.multiplier > 0 && mergedLatestAnalysis?.usRegime?.multiplier < 1.0));

  const krRegimeBadgeText = isKrHold
    ? '🔴 신규 매수 차단'
    : isKrReduced
    ? `🟡 비중 ${Math.round((mergedLatestAnalysis?.krRegime?.multiplier || 0.5) * 100)}% 축소 매매`
    : '🟢 정상 매매';

  const usRegimeBadgeText = isUsHold
    ? '🔴 신규 매수 차단'
    : isUsReduced
    ? `🟡 비중 ${Math.round((mergedLatestAnalysis?.usRegime?.multiplier || 0.5) * 100)}% 축소 매매`
    : '🟢 정상 매매';

  const krPrice = aiBriefing?.kr_index_price ?? 2580;
  const kr20Ma = aiBriefing?.kr_daily_20ma ?? 2565;
  const kr60Ma = aiBriefing?.kr_intraday_60ma ?? 2572;

  const usPrice = aiBriefing?.us_index_price ?? 502.4;
  const us20Ma = aiBriefing?.us_daily_20ma ?? 498.1;
  const us60Ma = aiBriefing?.us_intraday_60ma ?? 500.2;

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

  const krOverview =
    mergedLatestAnalysis?.krMarketOverview ||
    `[🇰🇷 한국 시장(KRX: KOSPI/KOSDAQ)] KOSPI ${Number(krPrice).toLocaleString()}pt (일봉 20MA ${Number(kr20Ma).toLocaleString()}pt) 기준 ${isKrHold ? '신규 매수 차단(HOLD_CASH)' : isKrReduced ? '비중 50% 축소 매매(REDUCE_SIZE)' : '정상 매수 허용(NORMAL)'} 체제입니다. 국내 대표 반도체·자동차·금융 대형주의 외국인/기관 수급과 뉴스 호재·악재를 반영해 1주 온주 매매를 운용합니다.`;
  const usOverview =
    mergedLatestAnalysis?.usMarketOverview ||
    `[🇺🇸 미국 시장(US: NYSE/NASDAQ)] 나스닥100(QQQ) $${Number(usPrice).toLocaleString()} (일봉 20MA $${Number(us20Ma).toLocaleString()}) 및 원/달러 환율 ${Number(usdKrwRate).toLocaleString()}원 기준 ${isUsHold ? '신규 매수 차단(HOLD_CASH)' : isUsReduced ? '비중 50% 축소 매매(REDUCE_SIZE)' : '정상 매수 허용(NORMAL)'} 체제입니다. 미국 AI·빅테크 주도주(NVDA, AAPL, MSFT, QQQ 등)를 중심으로 소수점 예약 및 정규장 매매를 병행합니다.`;

  const POPULAR_TAGS = [
    '#반도체', '#2차전지', '#바이오', '#AI/로봇', '#자동차',
    '#실적발표', '#금리/연준', '#환율', '#외국인수급', '#공시/계약',
  ];

  return (
    <div>
      <div className="section-header">
        <div className="section-title">📰 국내·해외 증시 뉴스 & 실시간 AI 종합 시장 판단</div>
        <button className="btn-action" onClick={onRefreshNews}>
          🔄 최신 증시뉴스 즉시 수집
        </button>
      </div>

      {/* ====================================================================
          AI 종합 시장 판단 & 다중 LLM(30분 Flash · 60분 Pro) 한·미 증시 뉴스 통합 브리핑
          ==================================================================== */}
      <div
        className="ai-briefing-accordion-card"
        style={{
          background: 'linear-gradient(135deg, rgba(19, 27, 46, 0.95), rgba(15, 23, 42, 0.98))',
          border: '1px solid rgba(139, 92, 246, 0.45)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '20px',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* 아코디언 헤더 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          {/* 좌측 타이틀 및 상태 뱃지 */}
          <div
            onClick={() => setIsAccordionOpen((prev) => !prev)}
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
            <span style={{ fontSize: '18px' }}>🤖</span>
            <span style={{ fontSize: '15.5px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
              AI 종합 시장 판단 (한·미 증시 뉴스 & 시간대별 시황·봇 진단)
            </span>

            {/* 모델 뱃지 */}
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

            {/* 실제 배치주기 자동갱신 뱃지 */}
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

            {/* 뉴스 감성 카운트 뱃지 */}
            <span className="badge-mode real" style={{ fontSize: '11px' }}>
              📰 호재 {newsCounts.bullish}건 / 악재 {newsCounts.bearish}건 / 중립 {newsCounts.neutral}건
            </span>

            {/* 최근 분석 시각 및 트리거 */}
            {createdAtStr && (
              <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                ({createdAtStr} · {triggerType === 'MANUAL' ? '⚡수동분석' : '⏰자동갱신'})
              </span>
            )}

            {/* 접혀 있을 때 한·미 체제 및 LLM 매매판정 요약 뱃지 */}
            {!isAccordionOpen && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: isKrHold ? 'rgba(239, 68, 68, 0.18)' : 'rgba(16, 185, 129, 0.16)',
                    color: isKrHold ? '#fca5a5' : '#6ee7b7',
                    border: isKrHold ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                  }}
                >
                  {isKrHold ? '🇰🇷 현금관망' : '🇰🇷 정상거래'} · KOSPI {Number(krPrice).toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: isUsHold ? 'rgba(239, 68, 68, 0.18)' : 'rgba(16, 185, 129, 0.16)',
                    color: isUsHold ? '#fca5a5' : '#6ee7b7',
                    border: isUsHold ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                  }}
                >
                  {isUsHold ? '🇺🇸 현금관망' : '🇺🇸 정상거래'} · QQQ ${Number(usPrice).toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: !isAlgoProceeding
                      ? 'rgba(239, 68, 68, 0.18)'
                      : algoStatusCode === 'REDUCE_SIZE'
                      ? 'rgba(245, 158, 11, 0.18)'
                      : 'rgba(56, 189, 248, 0.16)',
                    color: !isAlgoProceeding
                      ? '#fca5a5'
                      : algoStatusCode === 'REDUCE_SIZE'
                      ? '#fbbf24'
                      : '#38bdf8',
                    border: !isAlgoProceeding
                      ? '1px solid rgba(239, 68, 68, 0.45)'
                      : algoStatusCode === 'REDUCE_SIZE'
                      ? '1px solid rgba(245, 158, 11, 0.45)'
                      : '1px solid rgba(56, 189, 248, 0.45)',
                  }}
                >
                  🧠 LLM 매매판정: {isAlgoProceeding ? (algoStatusCode === 'REDUCE_SIZE' ? '🟡 비중축소 진행' : '🟢 정상진행') : '🔴 신규매수 중단'}
                </span>
              </div>
            )}
          </div>

          {/* 우측 쿼터 뱃지 및 수동 분석 실행 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                <span>⚡ AI 종합 시장·뉴스 분석 요청 ({remainingCalls}건 남음)</span>
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
                title="뉴스 분석 완료 시 웹푸시 알림을 받으려면 클릭하여 허용해주세요"
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

            <button
              type="button"
              className="btn-action"
              onClick={() => setIsAccordionOpen((prev) => !prev)}
              style={{ padding: '6px 10px', fontSize: '11.5px', color: '#cbd5e1' }}
            >
              {isAccordionOpen ? '▲ 접기' : '▼ 펼치기'}
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

        {/* 펼쳐졌을 때 본문 영역 */}
        {isAccordionOpen && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
            {/* 1. 상단 메타 요약 바 (한·미 시장 체제 + LLM 알고리즘 매매 진행 여부 + 예약대기 의사결정 구조) */}
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
                  <span>
                    📰 <strong>수집 뉴스</strong>: 총 {newsCounts.total}건 (호재 {newsCounts.bullish} / 악재 {newsCounts.bearish} / 중립 {newsCounts.neutral})
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

              {/* LLM 판단 알고리즘 매매 진행 여부 & 예약대기 안내 */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span>
                    🧠 <strong>LLM 판단 알고리즘 매매 진행 여부</strong>:{' '}
                    <strong
                      style={{
                        color: !isAlgoProceeding
                          ? '#f87171'
                          : algoStatusCode === 'REDUCE_SIZE'
                          ? '#fbbf24'
                          : '#34d399',
                      }}
                    >
                      [{algoBadgeText}]
                    </strong>
                  </span>
                  <span style={{ color: '#94a3b8' }}>
                    | 종목별 LLM 시그널: <strong style={{ color: '#34d399' }}>매수(BUY) {algoBuyCount}건</strong> ·{' '}
                    <strong style={{ color: '#cbd5e1' }}>관망(HOLD) {algoHoldCount}건</strong> ·{' '}
                    <strong style={{ color: '#f87171' }}>매도(SELL) {algoSellCount}건</strong> (우선 매수 추천: {algoTopBuys})
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                  📌 <strong>[⏳ 소수점 예약대기] 의사결정 구조</strong>: ①{' '}
                  <strong style={{ color: '#fca5a5' }}>청산대기(매도)</strong>는{' '}
                  <strong>퀀트 알고리즘 목표 수익률(익절/손절) 도달</strong> 또는{' '}
                  <strong>LLM 악재(SELL/SKIP) 판정</strong>이 결합된 하이브리드로 정규장(22:30 KST) 개장 즉시 체결되며, ②{' '}
                  <strong style={{ color: '#6ee7b7' }}>매수예정(신규 진입)</strong>은{' '}
                  <strong>LLM이 호재(BUY)로 판정한 최우선 추천 종목</strong>을 기반으로 자동 집행됩니다.
                </div>
              </div>
            </div>

            {/* 2. 한국 시장(KRX) & 미국 시장(US) 분리 요약 카드 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '12px',
                marginBottom: '14px',
              }}
            >
              {/* 🇰🇷 한국 시장 (KRX) 종합 진단 카드 */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: '10px',
                  padding: '13px 15px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                    paddingBottom: '6px',
                    borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8' }}>
                      🇰🇷 한국 시장 (KRX: KOSPI/KOSDAQ) 종합 판단
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: isKrHold ? 'rgba(239, 68, 68, 0.2)' : isKrReduced ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                        color: isKrHold ? '#f87171' : isKrReduced ? '#fbbf24' : '#34d399',
                        border: isKrHold ? '1px solid rgba(239, 68, 68, 0.45)' : isKrReduced ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(16, 185, 129, 0.4)',
                      }}
                    >
                      {krRegimeBadgeText}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-action"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => speakText(krOverview)}
                  >
                    🔊 한국장 듣기
                  </button>
                </div>
                <p style={{ fontSize: '12.5px', color: '#e2e8f0', lineHeight: 1.65, margin: 0 }}>
                  {krOverview}
                </p>
              </div>

              {/* 🇺🇸 미국 시장 (US) 종합 진단 카드 */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  borderRadius: '10px',
                  padding: '13px 15px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                    paddingBottom: '6px',
                    borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#c084fc' }}>
                      🇺🇸 미국 시장 (US: NYSE/NASDAQ) 종합 판단
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: isUsHold ? 'rgba(239, 68, 68, 0.2)' : isUsReduced ? 'rgba(245, 158, 11, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                        color: isUsHold ? '#f87171' : isUsReduced ? '#fbbf24' : '#a5b4fc',
                        border: isUsHold ? '1px solid rgba(239, 68, 68, 0.45)' : isUsReduced ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(99, 102, 241, 0.45)',
                      }}
                    >
                      {usRegimeBadgeText}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-action"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => speakText(usOverview)}
                  >
                    🔊 미국장 듣기
                  </button>
                </div>
                <p style={{ fontSize: '12.5px', color: '#e2e8f0', lineHeight: 1.65, margin: 0 }}>
                  {usOverview}
                </p>
              </div>
            </div>

            {/* 3. 다중 LLM(30분 Flash · 60분 Pro) & 수동 AI 마크다운 상세 브리핑 본문 */}
            <div
              style={{
                background: 'rgba(11, 15, 25, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.18)',
                borderRadius: '10px',
                padding: '16px 18px',
                maxHeight: '480px',
                overflowY: 'auto',
              }}
            >
              <MarkdownViewer
                content={
                  aiBriefing?.briefing_text ||
                  '실시간 한·미 시황 및 증시 뉴스 데이터를 불러오는 중입니다. 우측 상단의 [⚡ AI 종합 시장·뉴스 분석 요청] 버튼을 누르면 즉시 새로운 분석이 시작됩니다.'
                }
                isStreaming={aiStreaming}
              />
            </div>
          </div>
        )}
      </div>

      {/* News Filters & Search */}
      <div className="board-card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            className="input-field"
            style={{ width: '160px', padding: '8px 12px', fontSize: '13px' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span style={{ color: '#64748b' }}>~</span>
          <input
            type="date"
            className="input-field"
            style={{ width: '160px', padding: '8px 12px', fontSize: '13px' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />

          <input
            type="text"
            className="input-field"
            style={{ flex: 1, minWidth: '220px', padding: '8px 12px', fontSize: '13px' }}
            placeholder="통합 검색 (기사 제목, 요약, 언론사, 종목명)..."
            value={newsQuery}
            onChange={(e) => setNewsQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onFetchNews(1)}
          />

          <button
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '13px' }}
            onClick={() => onFetchNews(1)}
          >
            검색
          </button>
          <button
            className="btn-action"
            style={{ padding: '8px 14px', fontSize: '13px' }}
            onClick={() => {
              setNewsQuery('');
              setSelectedTag('');
              setStartDate('');
              setEndDate('');
              setTimeout(() => onFetchNews(1), 50);
            }}
          >
            초기화
          </button>
        </div>

        {/* Popular Tag Badges */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              className={`filter-badge-btn ${selectedTag === tag ? 'active' : ''}`}
              onClick={() => {
                const nextTag = selectedTag === tag ? '' : tag;
                setSelectedTag(nextTag);
                setTimeout(() => onFetchNews(1), 50);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* News Board Table (Strict 48px Fixed Row Height) */}
      <div className="board-card" style={{ padding: '0', overflow: 'hidden' }}>
        <table className="news-board-table">
          <thead>
            <tr>
              <th style={{ width: '100px' }}>감성구분</th>
              <th style={{ width: '140px' }}>테마 태그</th>
              <th>기사 제목 (클릭 시 새 탭 원문 이동)</th>
              <th style={{ width: '110px' }}>언론사</th>
              <th style={{ width: '140px' }}>보도일시</th>
            </tr>
          </thead>
          <tbody>
            {newsList.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', height: '100px', color: '#64748b' }}>
                  조회된 증시 뉴스가 없습니다.
                </td>
              </tr>
            ) : (
              newsList.map((n) => (
                <tr key={n.id}>
                  <td>
                    <span className={`sentiment-badge ${n.sentiment}`}>
                      {n.sentiment === 'BULLISH' ? '▲ 호재' : n.sentiment === 'BEARISH' ? '▼ 악재' : '● 중립'}
                    </span>
                  </td>
                  <td className="cell-ellipsis">
                    <span className="news-tag">{n.keywords || '#국내증시'}</span>
                  </td>
                  <td className="cell-ellipsis">
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="news-title-link"
                      title={`[${n.title}]\n\n${n.summary || ''}`}
                    >
                      {n.title}
                    </a>
                  </td>
                  <td className="cell-ellipsis" style={{ color: '#94a3b8' }}>{n.source}</td>
                  <td style={{ color: '#64748b', fontSize: '12px' }}>
                    {n.published_at ? n.published_at.slice(0, 16).replace('T', ' ') : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="pagination-container">
        <button
          className="page-btn"
          disabled={newsPagination.page <= 1}
          onClick={() => onFetchNews(1)}
        >
          « 처음
        </button>
        <button
          className="page-btn"
          disabled={newsPagination.page <= 1}
          onClick={() => onFetchNews(newsPagination.page - 1)}
        >
          ‹ 이전
        </button>

        {Array.from({ length: Math.min(7, newsPagination.totalPages) }, (_, i) => {
          const startP = Math.max(1, Math.min(newsPagination.page - 3, newsPagination.totalPages - 6));
          const pageNum = startP + i;
          if (pageNum > newsPagination.totalPages) return null;
          return (
            <button
              key={pageNum}
              className={`page-btn ${newsPagination.page === pageNum ? 'active' : ''}`}
              onClick={() => onFetchNews(pageNum)}
            >
              {pageNum}
            </button>
          );
        })}

        <button
          className="page-btn"
          disabled={newsPagination.page >= newsPagination.totalPages}
          onClick={() => onFetchNews(newsPagination.page + 1)}
        >
          다음 ›
        </button>
        <button
          className="page-btn"
          disabled={newsPagination.page >= newsPagination.totalPages}
          onClick={() => onFetchNews(newsPagination.totalPages)}
        >
          마지막 »
        </button>
      </div>
    </div>
  );
}

