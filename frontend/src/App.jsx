import React, { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = ''; // Relative path handled by Vite Proxy

export default function App() {
  // Gate Authorization State
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('kis_gate_passed') === 'true'
  );
  const [passcodeInput, setPasscodeInput] = useState('');
  const [gateError, setGateError] = useState('');

  // Navigation State
  const [activeMenu, setActiveMenu] = useState('TRADING'); // TRADING, LAB, STATS, NEWS, SETTINGS

  // Global System & Health State
  const [healthData, setHealthData] = useState(null);
  const [modalInfo, setModalInfo] = useState(null); // { title, message, type, onConfirm }

  // Trading (Menu 1) State
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);
  const [aiBriefingText, setAiBriefingText] = useState('');
  const [isBriefingStreaming, setIsBriefingStreaming] = useState(false);

  // Lab (Menu 2) State
  const [leaderboard, setLeaderboard] = useState([]);
  const [replaySeed, setReplaySeed] = useState(10000000);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState(null);

  // Stats (Menu 3) State
  const [statsModeFilter, setStatsModeFilter] = useState('ALL'); // ALL, VIRTUAL, REAL
  const [statsPeriodTab, setStatsPeriodTab] = useState(
    () => localStorage.getItem('kis_stats_tab') || 'daily'
  ); // daily, weekly, monthly
  const [statsData, setStatsData] = useState(null);

  // News (Menu 4) State
  const [newsList, setNewsList] = useState([]);
  const [newsCounts, setNewsCounts] = useState({ total: 0, bullish: 0, bearish: 0, neutral: 0 });
  const [newsPagination, setNewsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [newsQuery, setNewsQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isNewsAccordionOpen, setIsNewsAccordionOpen] = useState(true);
  const [isAiNewsStreaming, setIsAiNewsStreaming] = useState(false);
  const [aiNewsText, setAiNewsText] = useState('');

  // Settings (Menu 5) State
  const [systemSettings, setSystemSettings] = useState({});
  const [brokerConfig, setBrokerConfig] = useState({
    account_mode: 'VIRTUAL',
    kiwoom_app_key: '',
    kiwoom_app_secret: '',
    toss_api_key: '',
    toss_api_secret: '',
    toss_account_no: '',
    gemini_api_key: '',
  });
  const [accountBalance, setAccountBalance] = useState(null);
  const [showApiKeys, setShowApiKeys] = useState(false);

  // SSE EventSource / stream references
  const briefingStreamRef = useRef(null);
  const newsStreamRef = useRef(null);

  // ========================================================
  // CALLBACKS (Declared BEFORE useEffect - TDZ 방어 원칙)
  // ========================================================

  const handleGateSubmit = useCallback(async (e) => {
    e.preventDefault();
    setGateError('');
    try {
      const resp = await fetch(`${API_BASE}/api/auth/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setIsAuthenticated(true);
        localStorage.setItem('kis_gate_passed', 'true');
      } else {
        setGateError(data.message || '인증에 실패했습니다.');
      }
    } catch (err) {
      setGateError('서버에 연결할 수 없습니다.');
    }
  }, [passcodeInput]);

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/health`);
      if (resp.ok) {
        const data = await resp.json();
        setHealthData(data);
      }
    } catch {}
  }, []);

  const fetchBots = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/bots`);
      if (resp.ok) {
        const data = await resp.json();
        setBots(data.bots || []);
        if (!selectedBotId && data.bots && data.bots.length > 0) {
          setSelectedBotId(data.bots[0].bot_id);
        }
      }
    } catch {}
  }, [selectedBotId]);

  const fetchTradesAndPositions = useCallback(async () => {
    try {
      const [respT, respP] = await Promise.all([
        fetch(`${API_BASE}/api/trades?limit=100`),
        fetch(`${API_BASE}/api/positions`),
      ]);
      if (respT.ok) {
        const dataT = await respT.json();
        setTrades(dataT.trades || []);
      }
      if (respP.ok) {
        const dataP = await respP.json();
        setPositions(dataP.positions || []);
      }
    } catch {}
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/performance/leaderboard`);
      if (resp.ok) {
        const data = await resp.json();
        setLeaderboard(data.leaderboard || []);
      }
    } catch {}
  }, []);

  const fetchStats = useCallback(async (mode = statsModeFilter, period = statsPeriodTab) => {
    try {
      const resp = await fetch(`${API_BASE}/api/stats?mode=${mode}&period=${period}`);
      if (resp.ok) {
        const data = await resp.json();
        setStatsData(data);
      }
    } catch {}
  }, [statsModeFilter, statsPeriodTab]);

  const fetchNews = useCallback(async (page = 1) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50', // 50 items exact as required
      });
      if (newsQuery) params.append('q', newsQuery);
      if (selectedTag) params.append('tag', selectedTag);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const resp = await fetch(`${API_BASE}/api/news?${params.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        setNewsList(data.news || []);
        setNewsCounts(data.counts || { total: 0, bullish: 0, bearish: 0, neutral: 0 });
        setNewsPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      }
    } catch {}
  }, [newsQuery, selectedTag, startDate, endDate]);

  const fetchSettingsAndBalance = useCallback(async () => {
    try {
      const [respS, respB] = await Promise.all([
        fetch(`${API_BASE}/api/system/settings`),
        fetch(`${API_BASE}/api/account/balance`),
      ]);
      if (respS.ok) {
        const dataS = await respS.json();
        setSystemSettings(dataS.settings || {});
        if (dataS.brokerConfig) setBrokerConfig(dataS.brokerConfig);
        else if (dataS.kisConfig) setBrokerConfig((prev) => ({ ...prev, ...dataS.kisConfig }));
      }
      if (respB.ok) {
        const dataB = await respB.json();
        setAccountBalance(dataB);
      }
    } catch {}
  }, []);

  // Top AI Briefing Streamer
  const startBriefingStream = useCallback(() => {
    if (briefingStreamRef.current) {
      briefingStreamRef.current.close();
    }
    setAiBriefingText('');
    setIsBriefingStreaming(true);

    const es = new EventSource(`${API_BASE}/api/ai/stream-briefing`);
    briefingStreamRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.char) {
          setAiBriefingText((prev) => prev + parsed.char);
        }
        if (parsed.done) {
          setIsBriefingStreaming(false);
          es.close();
        }
      } catch (err) {}
    };

    es.onerror = () => {
      setIsBriefingStreaming(false);
      es.close();
    };
  }, []);

  // News AI Intelligence Streamer (Gemini 2.5 Flash SSE)
  const startNewsAiStream = useCallback(() => {
    if (newsStreamRef.current) {
      newsStreamRef.current.close();
    }
    setAiNewsText('');
    setIsAiNewsStreaming(true);

    const es = new EventSource(`${API_BASE}/api/ai/stream-news-analyze`);
    newsStreamRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.char) {
          setAiNewsText((prev) => prev + parsed.char);
        }
        if (parsed.done) {
          setIsAiNewsStreaming(false);
          es.close();
        }
      } catch (err) {}
    };

    es.onerror = () => {
      setIsAiNewsStreaming(false);
      es.close();
    };
  }, []);

  // Bot Actions
  const handleBotAction = useCallback(async (action, extra = {}) => {
    if (!selectedBotId) return;
    try {
      const resp = await fetch(`${API_BASE}/api/bots/${selectedBotId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setModalInfo({ title: '봇 제어 완료', message: data.message, type: 'info' });
        fetchBots();
      } else {
        setModalInfo({ title: '오류', message: data.message, type: 'error' });
      }
    } catch (e) {
      setModalInfo({ title: '서버 오류', message: e.message, type: 'error' });
    }
  }, [selectedBotId, fetchBots]);

  // Virtual Trade Test
  const handleVirtualTradeTest = useCallback(async (side) => {
    if (!selectedBotId) return;
    try {
      const resp = await fetch(`${API_BASE}/api/bots/${selectedBotId}/virtual-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, stockCode: '005930' }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setModalInfo({ title: '가상 매매 체결 성공', message: data.message, type: 'success' });
        fetchBots();
        fetchTradesAndPositions();
      } else {
        setModalInfo({ title: '가상 매매 주문 거부', message: data.message, type: 'error' });
      }
    } catch (e) {
      setModalInfo({ title: '오류', message: e.message, type: 'error' });
    }
  }, [selectedBotId, fetchBots, fetchTradesAndPositions]);

  // Fast Replay Simulation (30-day)
  const handleFastReplay = useCallback(async () => {
    setIsReplaying(true);
    setReplayResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/performance/fast-replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedCapital: replaySeed }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setReplayResult(data.result);
        fetchLeaderboard();
      } else {
        setModalInfo({ title: '시뮬레이션 실패', message: data.message, type: 'error' });
      }
    } catch (e) {
      setModalInfo({ title: '오류', message: e.message, type: 'error' });
    } finally {
      setIsReplaying(false);
    }
  }, [replaySeed, fetchLeaderboard]);

  // Promote Bot to REAL
  const handlePromoteToReal = useCallback(async (botId) => {
    try {
      const resp = await fetch(`${API_BASE}/api/bots/${botId}/promote`, { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setModalInfo({ title: '실전 승격 완료', message: data.result.msg, type: 'success' });
        fetchBots();
        fetchLeaderboard();
      }
    } catch (e) {
      setModalInfo({ title: '오류', message: e.message, type: 'error' });
    }
  }, [fetchBots, fetchLeaderboard]);

  // Backup Export & Restore
  const handleExportBackup = useCallback(() => {
    window.location.href = `${API_BASE}/api/backup/export`;
  }, []);

  const handleImportBackup = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const resp = await fetch(`${API_BASE}/api/backup/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const data = await resp.json();
      if (resp.ok) {
        setModalInfo({ title: '복원 완료', message: data.message, type: 'success' });
        fetchBots();
        fetchTradesAndPositions();
        fetchSettingsAndBalance();
      } else {
        setModalInfo({ title: '복원 실패', message: data.message, type: 'error' });
      }
    } catch (err) {
      setModalInfo({ title: '파일 파싱 오류', message: err.message, type: 'error' });
    }
  }, [fetchBots, fetchTradesAndPositions, fetchSettingsAndBalance]);

  // ========================================================
  // USE EFFECTS (Initial Load & Polling)
  // ========================================================

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchHealth();
    fetchBots();
    fetchTradesAndPositions();
    fetchLeaderboard();
    fetchNews();
    fetchSettingsAndBalance();
    startBriefingStream();

    const interval = setInterval(() => {
      fetchHealth();
      fetchTradesAndPositions();
      fetchBots();
    }, 5000);

    return () => {
      clearInterval(interval);
      if (briefingStreamRef.current) briefingStreamRef.current.close();
      if (newsStreamRef.current) newsStreamRef.current.close();
    };
  }, [isAuthenticated, fetchHealth, fetchBots, fetchTradesAndPositions, fetchLeaderboard, fetchNews, fetchSettingsAndBalance, startBriefingStream]);

  useEffect(() => {
    if (activeMenu === 'STATS') {
      fetchStats(statsModeFilter, statsPeriodTab);
    }
  }, [activeMenu, statsModeFilter, statsPeriodTab, fetchStats]);

  // ========================================================
  // RENDER: GATE SCREEN
  // ========================================================
  if (!isAuthenticated) {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="gate-icon">📈</div>
          <h1 className="gate-title">키움(시세) ⨉ 토스(매매) AI 퀀트 시스템</h1>
          <p className="gate-desc">
            본 시스템은 키움증권 시세 조회 및 토스증권 매매 연동 전용 게이트입니다.<br />
            개인 입장 코드를 입력하고 접속하세요.
          </p>
          <form onSubmit={handleGateSubmit} className="gate-form">
            <input
              type="password"
              className="input-field"
              placeholder="입장 코드 입력 (sws@2129)"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              autoFocus
            />
            {gateError && <div style={{ color: '#ef4444', fontSize: '13px' }}>{gateError}</div>}
            <button type="submit" className="btn-primary">
              보안 게이트 입장
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selectedBot = bots.find((b) => b.bot_id === selectedBotId) || bots[0];
  const marketStatus = healthData?.marketStatus;
  const apiHealth = healthData?.apiHealth;
  const regime = healthData?.marketRegime;

  // ========================================================
  // RENDER: MAIN APPLICATION (2:8 LAYOUT)
  // ========================================================
  return (
    <div className="app-container">
      {/* 20% Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">📈</div>
          <div>
            <div className="brand-title">Kiwoom ⨉ Toss</div>
            <div className="brand-subtitle">AI Quant Trader</div>
          </div>
        </div>

        {/* Real-time Status Panel */}
        <div className="status-panel">
          <div className="status-row">
            <span className="status-label">키움 시세</span>
            <span className={`status-pill ${healthData?.kiwoomHealth?.status || 'gray'}`}>
              ● {healthData?.kiwoomHealth?.status === 'green' ? '정상연결' : healthData?.kiwoomHealth?.status === 'yellow' ? '가상대기' : '미연결'}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">토스 매매</span>
            <span className={`status-pill ${healthData?.tossHealth?.status || 'gray'}`}>
              ● {healthData?.tossHealth?.status === 'green' ? '정상연결' : healthData?.tossHealth?.status === 'yellow' ? '가상대기' : '미연결'}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">국내 장운영</span>
            <span className="status-pill gray" style={{ fontSize: '10px' }}>
              {marketStatus?.phase || 'CHECKING'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
            {marketStatus?.badge || '장 상태 확인 중...'}
          </div>
          <div className="status-row" style={{ marginTop: '4px' }}>
            <span className="status-label">시장 체제</span>
            <span className={`status-pill ${regime?.regime === 'NORMAL' ? 'green' : 'red'}`}>
              {regime?.regime || 'NORMAL'}
            </span>
          </div>
        </div>

        {/* 5 Navigation Menus */}
        <nav className="nav-menu">
          <div
            className={`nav-item ${activeMenu === 'TRADING' ? 'active' : ''}`}
            onClick={() => setActiveMenu('TRADING')}
          >
            <span>📊</span>
            <span>거래현황</span>
          </div>
          <div
            className={`nav-item ${activeMenu === 'LAB' ? 'active' : ''}`}
            onClick={() => setActiveMenu('LAB')}
          >
            <span>🧪</span>
            <span>알고리즘 검증소</span>
          </div>
          <div
            className={`nav-item ${activeMenu === 'STATS' ? 'active' : ''}`}
            onClick={() => setActiveMenu('STATS')}
          >
            <span>📈</span>
            <span>통계</span>
          </div>
          <div
            className={`nav-item ${activeMenu === 'NEWS' ? 'active' : ''}`}
            onClick={() => setActiveMenu('NEWS')}
          >
            <span>📰</span>
            <span>증시뉴스 & 공시</span>
          </div>
          <div
            className={`nav-item ${activeMenu === 'SETTINGS' ? 'active' : ''}`}
            onClick={() => setActiveMenu('SETTINGS')}
          >
            <span>⚙️</span>
            <span>설정</span>
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div>PostgreSQL: {healthData?.pgConnected ? '🟢 동기화 정상' : '🟡 대기/로컬모드'}</div>
          <div>Dual DB: SQLite + PG16</div>
          <div style={{ cursor: 'pointer', color: '#ef4444', marginTop: '8px' }} onClick={() => {
            localStorage.removeItem('kis_gate_passed');
            setIsAuthenticated(false);
          }}>
            🚪 로그아웃 (게이트 락)
          </div>
        </div>
      </aside>

      {/* 80% Main Content Area */}
      <main className="main-content">
        {/* ========================================================
            MENU 1: 거래현황
            ======================================================== */}
        {activeMenu === 'TRADING' && (
          <div>
            {/* Top Market AI Streaming Marquee Box */}
            <div className="top-briefing-box">
              <span className="briefing-badge">Gemini AI 증시 브리핑 (키움 시세 & 토스 매매)</span>
              <div className="briefing-text">
                {aiBriefingText}
                {isBriefingStreaming && <span className="cursor-blink">|</span>}
              </div>
              <button
                className="btn-action"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={startBriefingStream}
                disabled={isBriefingStreaming}
              >
                🔄 실시간 재분석
              </button>
            </div>

            {/* Bot Selection Tabs */}
            <div className="bot-tabs-container">
              {bots.map((b) => (
                <button
                  key={b.bot_id}
                  className={`bot-tab-btn ${selectedBotId === b.bot_id ? 'active' : ''}`}
                  onClick={() => setSelectedBotId(b.bot_id)}
                >
                  <span>{b.nickname || b.name}</span>
                  <span className={`badge-mode ${b.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                    {b.trade_mode === 'REAL' ? '💰 실전' : '🧪 가상'}
                  </span>
                  <span style={{ fontSize: '11px', color: b.is_running ? '#34d399' : '#94a3b8' }}>
                    {b.is_running ? '🟢 가동' : '⚪ 정지'}
                  </span>
                </button>
              ))}
            </div>

            {/* Selected Bot Control Actions */}
            {selectedBot && (
              <div className="bot-action-bar">
                {selectedBot.is_running ? (
                  <button className="btn-action danger" onClick={() => handleBotAction('STOP')}>
                    ⏹ 거래 중지
                  </button>
                ) : (
                  <button className="btn-action success" onClick={() => handleBotAction('START')}>
                    ▶ 거래 시작
                  </button>
                )}
                <button className="btn-action warning" onClick={() => handleBotAction('TOGGLE_MODE')}>
                  🔄 모드 전환 ({selectedBot.trade_mode === 'REAL' ? '🧪 가상으로' : '💰 실전으로'})
                </button>
                <button className="btn-action" onClick={() => handleVirtualTradeTest('BUY')}>
                  🛒 가상 매수 테스트 (삼성전자)
                </button>
                <button className="btn-action" onClick={() => handleVirtualTradeTest('SELL')}>
                  📉 가상 매도 테스트
                </button>
                <button className="btn-action danger" onClick={() => {
                  setModalInfo({
                    title: '가상 계좌 초기화',
                    message: `[${selectedBot.nickname}]의 가상 자금을 1,000만 원으로 리셋하고 기존 보유 포지션을 전량 정리하시겠습니까?`,
                    type: 'confirm',
                    onConfirm: () => handleBotAction('RESET_VIRTUAL'),
                  });
                }}>
                  ⚠️ 가상 계좌 초기화
                </button>
              </div>
            )}

            {/* Bot Metrics Summary */}
            {selectedBot && (
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-title">가상 예수금 (KRW)</div>
                  <div className="metric-value">{(selectedBot.virtual_krw || 0).toLocaleString()}원</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">보유 중인 포지션 수</div>
                  <div className="metric-value">
                    {positions.filter((p) => p.bot_id === selectedBot.bot_id).length}건
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">목표 익절 / 손절 설정</div>
                  <div className="metric-value">
                    <span className="num-up">+{selectedBot.take_profit_pct}%</span> / <span className="num-down">-{selectedBot.stop_loss_pct}%</span>
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">현재 봇 상태</div>
                  <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '6px', lineHeight: 1.4 }}>
                    {selectedBot.last_status_msg || '정상 가동 대기 중'}
                  </div>
                </div>
              </div>
            )}

            {/* Board 1: Active Positions (현재 보유 포지션 및 실시간 평가손익) */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">📌 실시간 보유 종목 & 평가 손익 현황</div>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>총 {positions.length}개 보유 중</span>
              </div>
              <div className="table-wrapper">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>종목명 (코드)</th>
                      <th>구분</th>
                      <th>보유수량</th>
                      <th>매수평균가</th>
                      <th>현재가</th>
                      <th>평가금액</th>
                      <th>평가손익</th>
                      <th>수익률</th>
                      <th>진입일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                          현재 보유 중인 포지션이 없습니다. (봇 감시 진행 중)
                        </td>
                      </tr>
                    ) : (
                      positions.map((pos) => {
                        const isUp = pos.unrealizedProfitKrw > 0;
                        const isDown = pos.unrealizedProfitKrw < 0;
                        return (
                          <tr key={pos.id}>
                            <td style={{ fontWeight: 600 }}>{pos.stock_name} ({pos.stock_code})</td>
                            <td>
                              <span className={`badge-mode ${pos.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                                {pos.trade_mode}
                              </span>
                            </td>
                            <td>{pos.qty.toLocaleString()}주</td>
                            <td>{pos.avg_buy_price.toLocaleString()}원</td>
                            <td style={{ fontWeight: 600 }}>{pos.currentPrice?.toLocaleString()}원</td>
                            <td>{pos.evalAmount?.toLocaleString()}원</td>
                            <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                              {isUp ? '+' : ''}{pos.unrealizedProfitKrw?.toLocaleString()}원
                            </td>
                            <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                              {isUp ? '+' : ''}{pos.unrealizedProfitPct}%
                            </td>
                            <td style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {new Date(pos.created_at).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Board 2: 1-Row Matching Trades History (거래 정보 게시판) */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">📋 1행 매칭 체결 및 실현 손익 내역</div>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>최근 {trades.length}건</span>
              </div>
              <div className="table-wrapper">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>매매구분</th>
                      <th>종목명 (코드)</th>
                      <th>매수단가/수량/금액</th>
                      <th>매도단가/수량/금액</th>
                      <th>제세금/수수료</th>
                      <th>매수일시</th>
                      <th>매도일시</th>
                      <th>실현손익 (원/%)</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.length === 0 ? (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                          체결된 거래 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      trades.map((t) => {
                        const isUp = (t.profit_krw || 0) > 0;
                        const isDown = (t.profit_krw || 0) < 0;
                        return (
                          <tr key={t.id}>
                            <td>
                              <span className={`badge-mode ${t.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                                {t.trade_mode === 'REAL' ? '실전' : '가상'}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{t.stock_name} ({t.stock_code})</td>
                            <td>{t.buy_price.toLocaleString()}원 / {t.buy_qty}주 ({t.buy_amount.toLocaleString()}원)</td>
                            <td>
                              {t.sell_price ? `${t.sell_price.toLocaleString()}원 / ${t.sell_qty}주` : '-'}
                            </td>
                            <td>{(t.fee_and_tax || 0).toLocaleString()}원</td>
                            <td style={{ fontSize: '11px', color: '#94a3b8' }}>{t.buy_date ? t.buy_date.slice(0, 16).replace('T', ' ') : '-'}</td>
                            <td style={{ fontSize: '11px', color: '#94a3b8' }}>{t.sell_date ? t.sell_date.slice(0, 16).replace('T', ' ') : '-'}</td>
                            <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                              {t.profit_krw !== null ? (
                                <>
                                  {isUp ? '+' : ''}{t.profit_krw?.toLocaleString()}원
                                  <span style={{ fontSize: '11px', marginLeft: '4px' }}>
                                    ({isUp ? '+' : ''}{t.profit_pct}%)
                                  </span>
                                </>
                              ) : '-'}
                            </td>
                            <td>
                              <span style={{
                                fontSize: '11px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: t.status === 'CLOSED' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                color: t.status === 'CLOSED' ? '#60a5fa' : '#fbbf24',
                              }}>
                                {t.status === 'CLOSED' ? '청산완료' : '보유중'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            MENU 2: 알고리즘 성능 검증소 (가상 매매 전용 대시보드)
            ======================================================== */}
        {activeMenu === 'LAB' && (
          <div>
            <div className="section-header">
              <div className="section-title">🧪 3대 퀀트 알고리즘 실시간 리더보드</div>
              <button
                className="btn-action success"
                onClick={handleFastReplay}
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
                        onClick={() => {
                          setModalInfo({
                            title: '실전 매매 승격 확인',
                            message: `[${item.name}]의 성과가 검증되었습니다. 실전 매매(REAL) 모드로 공식 승격하시겠습니까?`,
                            type: 'confirm',
                            onConfirm: () => handlePromoteToReal(item.botId),
                          });
                        }}
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
              <div className="board-card" style={{ borderColor: '#3b82f6', background: 'linear-gradient(135deg, #131b2e, #1e293b)' }}>
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
                        <th>손익비</th>
                        <th>MDD</th>
                        <th>샤프 지수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replayResult.leaderboard.map((res, idx) => (
                        <tr key={res.botId}>
                          <td>{idx + 1}위</td>
                          <td style={{ fontWeight: 600 }}>{res.name}</td>
                          <td className="num-up">+{res.cumulativeReturnPct}%</td>
                          <td className="num-up">+{res.totalProfitKrw.toLocaleString()}원</td>
                          <td>{res.winRate}%</td>
                          <td>{res.profitFactor}</td>
                          <td className="num-down">-{res.mddPct}%</td>
                          <td>{res.sharpeRatio}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            MENU 3: 통계 (국내 증시 표준 색상 & 2026.10.01 집계)
            ======================================================== */}
        {activeMenu === 'STATS' && (
          <div>
            <div className="section-header">
              <div className="section-title">📈 국내주식 손익 통계 대시보드</div>
              {/* Filter Switches */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {['ALL', 'VIRTUAL', 'REAL'].map((m) => (
                  <button
                    key={m}
                    className={`filter-badge-btn ${statsModeFilter === m ? 'active' : ''}`}
                    onClick={() => setStatsModeFilter(m)}
                  >
                    {m === 'ALL' ? '전체 보기' : m === 'VIRTUAL' ? '🧪 가상매매만' : '💰 실전매매만'}
                  </button>
                ))}
              </div>
            </div>

            {/* Period Tabs */}
            <div className="bot-tabs-container">
              {[
                { key: 'daily', label: '일별 통계' },
                { key: 'weekly', label: '주별 통계' },
                { key: 'monthly', label: '월별 통계' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`bot-tab-btn ${statsPeriodTab === tab.key ? 'active' : ''}`}
                  onClick={() => {
                    setStatsPeriodTab(tab.key);
                    localStorage.setItem('kis_stats_tab', tab.key);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* High Level Metrics */}
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-title">통계 시작 기준일</div>
                <div className="metric-value" style={{ fontSize: '18px', color: '#94a3b8' }}>
                  2026.10.01 ~ 현재
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-title">누적 실현 손익 (KRW)</div>
                <div className={`metric-value ${(statsData?.totalProfitKrw || 0) > 0 ? 'up' : (statsData?.totalProfitKrw || 0) < 0 ? 'down' : ''}`}>
                  {(statsData?.totalProfitKrw || 0) > 0 ? '+' : ''}{(statsData?.totalProfitKrw || 0).toLocaleString()}원
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-title">전체 승률 (Win Rate)</div>
                <div className="metric-value up">{statsData?.winRate || 0}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-title">완료된 매매 횟수</div>
                <div className="metric-value">{statsData?.totalTrades || 0}회</div>
              </div>
            </div>

            {/* Period Timeline Breakdown */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">📅 기간별 손익 집계 추이</div>
              </div>
              <div className="table-wrapper">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>기간 (Period)</th>
                      <th>실현 손익금</th>
                      <th>체결 횟수</th>
                      <th>승률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!statsData?.timeline || statsData.timeline.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                          선택한 조건의 거래 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      statsData.timeline.map((item) => {
                        const isUp = item.profitKrw > 0;
                        const isDown = item.profitKrw < 0;
                        return (
                          <tr key={item.period}>
                            <td style={{ fontWeight: 600 }}>{item.period}</td>
                            <td className={isUp ? 'num-up' : isDown ? 'num-down' : 'num-zero'}>
                              {isUp ? '+' : ''}{item.profitKrw.toLocaleString()}원
                            </td>
                            <td>{item.tradesCount}건</td>
                            <td className={item.winRate >= 50 ? 'num-up' : 'num-down'}>{item.winRate}%</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stock Contribution Ranking Table */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">🏆 국내주식 종목별 수익 기여도 순위</div>
              </div>
              <div className="table-wrapper">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>종목명 (종목코드)</th>
                      <th>누적 실현 손익</th>
                      <th>매매 횟수</th>
                      <th>종목별 승률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!statsData?.stockRanking || statsData.stockRanking.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                          매매된 종목 데이터가 없습니다.
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
          </div>
        )}

        {/* ========================================================
            MENU 4: 증시뉴스 & 공시 (50건 페이징 & 48px 고정 Row 높이)
            ======================================================== */}
        {activeMenu === 'NEWS' && (
          <div>
            <div className="section-header">
              <div className="section-title">📰 국내 증시 뉴스 & 실시간 AI 인텔리전스</div>
              <button
                className="btn-action"
                onClick={async () => {
                  await fetch(`${API_BASE}/api/news/refresh`, { method: 'POST' });
                  fetchNews(1);
                }}
              >
                🔄 최신 증시뉴스 즉시 수집
              </button>
            </div>

            {/* Collapsible Accordion: AI News Intelligence Box */}
            <div className="collapsible-box">
              <div
                className="collapsible-header"
                onClick={() => setIsNewsAccordionOpen(!isNewsAccordionOpen)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '18px' }}>🤖</span>
                  <span style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>
                    Gemini 2.5 Flash 증시 뉴스 종합 시황 AI 분석
                  </span>
                  <span className="badge-mode real" style={{ fontSize: '11px' }}>
                    호재 {newsCounts.bullish}건 / 악재 {newsCounts.bearish}건 / 중립 {newsCounts.neutral}건
                  </span>
                </div>
                <button
                  className="btn-action"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsNewsAccordionOpen(!isNewsAccordionOpen);
                  }}
                >
                  {isNewsAccordionOpen ? '▲ 접기' : '▼ 펼치기'}
                </button>
              </div>

              {isNewsAccordionOpen && (
                <div className="collapsible-content">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                      수집된 {newsCounts.total}건의 증시 뉴스와 시장 수급을 AI가 실시간 종합 분석합니다.
                    </div>
                    <button
                      className="btn-action success"
                      onClick={startNewsAiStream}
                      disabled={isAiNewsStreaming}
                    >
                      {isAiNewsStreaming ? '🤖 AI 스트리밍 분석 중...' : '🤖 AI 분석하기'}
                    </button>
                  </div>
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      padding: '16px',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                      lineHeight: '1.7',
                      color: '#e2e8f0',
                      whiteSpace: 'pre-wrap',
                      minHeight: '100px',
                    }}
                  >
                    {aiNewsText || '상단의 [🤖 AI 분석하기] 버튼을 누르면 실시간 시황 보고서가 생성됩니다.'}
                    {isAiNewsStreaming && <span className="cursor-blink">|</span>}
                  </div>
                </div>
              )}
            </div>

            {/* News Filters & Search */}
            <div className="board-card" style={{ padding: '16px' }}>
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
                  onKeyDown={(e) => e.key === 'Enter' && fetchNews(1)}
                />

                <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => fetchNews(1)}>
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
                    setTimeout(() => fetchNews(1), 50);
                  }}
                >
                  초기화
                </button>
              </div>

              {/* Popular Tag Badges */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                {[
                  '#반도체', '#2차전지', '#바이오', '#AI/로봇', '#자동차',
                  '#실적발표', '#금리/연준', '#환율', '#외국인수급', '#공시/계약',
                ].map((tag) => (
                  <button
                    key={tag}
                    className={`filter-badge-btn ${selectedTag === tag ? 'active' : ''}`}
                    onClick={() => {
                      const nextTag = selectedTag === tag ? '' : tag;
                      setSelectedTag(nextTag);
                      setTimeout(() => fetchNews(1), 50);
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
                onClick={() => fetchNews(1)}
              >
                « 처음
              </button>
              <button
                className="page-btn"
                disabled={newsPagination.page <= 1}
                onClick={() => fetchNews(newsPagination.page - 1)}
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
                    onClick={() => fetchNews(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                className="page-btn"
                disabled={newsPagination.page >= newsPagination.totalPages}
                onClick={() => fetchNews(newsPagination.page + 1)}
              >
                다음 ›
              </button>
              <button
                className="page-btn"
                disabled={newsPagination.page >= newsPagination.totalPages}
                onClick={() => fetchNews(newsPagination.totalPages)}
              >
                마지막 »
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            MENU 5: 설정 (키움증권 시세 & 토스증권 매매)
            ======================================================== */}
        {activeMenu === 'SETTINGS' && (
          <div>
            <div className="section-header">
              <div className="section-title">⚙️ 키움증권(시세) ⨉ 토스증권(매매) API 및 시스템 설정</div>
            </div>

            {/* Toss Securities Account Assets Read-Only Check */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">💼 토스증권 계좌 자산 현황 (실전 매매 잔고)</div>
                <button className="btn-action" onClick={fetchSettingsAndBalance}>🔄 잔고 갱신</button>
              </div>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-title">주문 가능 예수금 (토스)</div>
                  <div className="metric-value">{(accountBalance?.availableCash || 0).toLocaleString()}원</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">주식 매입 금액</div>
                  <div className="metric-value">{(accountBalance?.stockEvalAmount || 0).toLocaleString()}원</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">총 평가 금액</div>
                  <div className="metric-value">{(accountBalance?.totalAssetAmount || 0).toLocaleString()}원</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">평가 손익률</div>
                  <div className={`metric-value ${(accountBalance?.profitRate || 0) >= 0 ? 'up' : 'down'}`}>
                    {(accountBalance?.profitRate || 0) >= 0 ? '+' : ''}{accountBalance?.profitRate || 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Broker API Keys Configuration */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">🔑 키움증권(시세) & 토스증권(매매) Open API 키 관리</div>
                <button className="btn-action" onClick={() => setShowApiKeys(!showApiKeys)}>
                  {showApiKeys ? '🔒 마스킹 적용' : '👁 키 확인'}
                </button>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">매매 운영 모드</label>
                  <select
                    className="input-field"
                    value={brokerConfig.account_mode}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, account_mode: e.target.value })}
                  >
                    <option value="VIRTUAL">🧪 가상매매 (키움 시세 기반 Paper Trading)</option>
                    <option value="REAL">💰 실전매매 (토스증권 실주문 체결)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Gemini API 키 (실시간 SSE 시황 AI 분석)</label>
                  <input
                    type={showApiKeys ? 'text' : 'password'}
                    className="input-field"
                    placeholder="AIzaSy..."
                    value={brokerConfig.gemini_api_key}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, gemini_api_key: e.target.value })}
                  />
                </div>
              </div>

              {/* Kiwoom Section */}
              <div style={{ marginTop: '16px', marginBottom: '8px', fontWeight: 700, color: '#60a5fa', fontSize: '14px' }}>
                🔍 [시세 조회] 키움증권 Open API 설정
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">키움증권 App Key</label>
                  <input
                    type={showApiKeys ? 'text' : 'password'}
                    className="input-field"
                    placeholder="키움증권 App Key"
                    value={brokerConfig.kiwoom_app_key}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, kiwoom_app_key: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">키움증권 Secret Key</label>
                  <input
                    type={showApiKeys ? 'text' : 'password'}
                    className="input-field"
                    placeholder="키움증권 Secret Key"
                    value={brokerConfig.kiwoom_app_secret}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, kiwoom_app_secret: e.target.value })}
                  />
                </div>
              </div>

              {/* Toss Section */}
              <div style={{ marginTop: '16px', marginBottom: '8px', fontWeight: 700, color: '#34d399', fontSize: '14px' }}>
                ⚡ [주문 매매] 토스증권 Open API 설정
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">토스증권 API Key</label>
                  <input
                    type={showApiKeys ? 'text' : 'password'}
                    className="input-field"
                    placeholder="토스증권 API Key"
                    value={brokerConfig.toss_api_key}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, toss_api_key: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">토스증권 Secret Key</label>
                  <input
                    type={showApiKeys ? 'text' : 'password'}
                    className="input-field"
                    placeholder="토스증권 Secret Key"
                    value={brokerConfig.toss_api_secret}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, toss_api_secret: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">토스증권 계좌번호</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="12345678"
                    value={brokerConfig.toss_account_no}
                    onChange={(e) => setBrokerConfig({ ...brokerConfig, toss_account_no: e.target.value })}
                  />
                </div>
              </div>

              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    const resp = await fetch(`${API_BASE}/api/system/settings`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ brokerConfig }),
                    });
                    const d = await resp.json();
                    if (resp.ok) {
                      setModalInfo({ title: '설정 저장 완료', message: d.message, type: 'success' });
                    }
                  } catch (e) {
                    setModalInfo({ title: '오류', message: e.message, type: 'error' });
                  }
                }}
              >
                💾 키움 & 토스 API 키 설정 저장
              </button>
            </div>

            {/* JSON Data Backup & Restore */}
            <div className="board-card">
              <div className="card-title-row">
                <div className="card-title">💾 JSON 데이터 백업 및 복원</div>
              </div>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
                SQLite 내 모든 테이블(봇 설정, 실전/가상 거래 내역, 포지션, 알고리즘 리포트)을 단일 JSON으로 Export하거나 복원합니다.
              </p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn-action" onClick={handleExportBackup}>
                  📥 JSON 백업 파일 다운로드 (Export)
                </button>
                <label className="btn-action" style={{ cursor: 'pointer' }}>
                  📤 JSON 백업 파일 복원 (Import)
                  <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportBackup} />
                </label>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================
          MODAL POPUP
          ======================================================== */}
      {modalInfo && (
        <div className="modal-overlay" onClick={() => setModalInfo(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{modalInfo.title}</h3>
              <button
                className="btn-action"
                style={{ padding: '4px 8px' }}
                onClick={() => setModalInfo(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">{modalInfo.message}</div>
            <div className="modal-footer">
              {modalInfo.type === 'confirm' ? (
                <>
                  <button className="btn-action" onClick={() => setModalInfo(null)}>취소</button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      if (modalInfo.onConfirm) modalInfo.onConfirm();
                      setModalInfo(null);
                    }}
                  >
                    확인 진행
                  </button>
                </>
              ) : (
                <button className="btn-primary" onClick={() => setModalInfo(null)}>확인</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

