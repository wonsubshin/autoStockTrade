import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './services/api';

// Modular UI Components (Styled with Pretendard & styles.css)
import Modal from './components/common/Modal';
import GateModal from './components/auth/GateModal';
import Header from './components/layout/Header';
import MarketBanner from './components/layout/MarketBanner';
import BudgetBar from './components/layout/BudgetBar';
import BotCard from './components/trading/BotCard';
import HybridBoard from './components/trading/HybridBoard';
import PositionsTable from './components/trading/PositionsTable';
import TradesTable from './components/trading/TradesTable';
import LabPanel from './components/lab/LabPanel';
import StatsPanel from './components/stats/StatsPanel';
import NewsPanel from './components/news/NewsPanel';
import SettingsPanel from './components/settings/SettingsPanel';

// 24시간 세션 유효기간 (1일 = 86,400,000 ms)
const GATE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function checkGateAuthentication() {
  const passed = localStorage.getItem('kis_gate_passed');
  const authTimeStr = localStorage.getItem('kis_gate_auth_time');

  if (passed !== 'true') return false;

  // 기존 사용자 마이그레이션: auth_time이 없으면 현재 시각으로 초기 등록
  if (!authTimeStr) {
    localStorage.setItem('kis_gate_auth_time', Date.now().toString());
    return true;
  }

  const authTime = parseInt(authTimeStr, 10);
  if (isNaN(authTime)) {
    localStorage.removeItem('kis_gate_passed');
    localStorage.removeItem('kis_gate_auth_time');
    return false;
  }

  const elapsed = Date.now() - authTime;
  if (elapsed >= GATE_SESSION_TTL_MS) {
    // 24시간(하루) 경과 시 세션 만료 및 인증 화면으로 이동
    localStorage.removeItem('kis_gate_passed');
    localStorage.removeItem('kis_gate_auth_time');
    return false;
  }

  return true;
}

export default function App() {
  // 1. Gate Authorization State (24시간 만료 검증)
  const [isAuthenticated, setIsAuthenticated] = useState(() => checkGateAuthentication());

  // 2. Navigation State (5 Menus: TRADING, LAB, STATS, NEWS, SETTINGS)
  const [activeMenu, setActiveMenu] = useState('TRADING');

  // 3. Global Modal / Notification
  const [modalInfo, setModalInfo] = useState(null);

  // 4. System & Health State
  const [healthData, setHealthData] = useState(null);

  // 5. Trading & Bots State
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [tradingModeFilter, setTradingModeFilter] = useState('AUTO'); // 'AUTO', 'VIRTUAL', 'REAL', 'ALL'
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);
  const [selectedStockCode, setSelectedStockCode] = useState('005930');

  // 6. AI Hybrid Decisions State
  const [aiDecisions, setAiDecisions] = useState([]);
  const [isAiEvaluating, setIsAiEvaluating] = useState(false);

  // 7. Streaming Briefings
  const [aiBriefingText, setAiBriefingText] = useState('');
  const [isBriefingStreaming, setIsBriefingStreaming] = useState(false);
  const briefingStreamRef = useRef(null);

  // 8. Lab & Replay State
  const [leaderboard, setLeaderboard] = useState([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState(null);

  // 9. Stats State
  const [statsModeFilter, setStatsModeFilter] = useState('ALL');
  const [statsPeriodTab, setStatsPeriodTab] = useState(
    () => localStorage.getItem('kis_stats_tab') || 'daily'
  );
  const [statsData, setStatsData] = useState(null);

  // 10. News State
  const [newsList, setNewsList] = useState([]);
  const [newsCounts, setNewsCounts] = useState({ total: 0, bullish: 0, bearish: 0, neutral: 0 });
  const [newsPagination, setNewsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [newsQuery, setNewsQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isAiNewsStreaming, setIsAiNewsStreaming] = useState(false);
  const [aiNewsText, setAiNewsText] = useState('');
  const newsStreamRef = useRef(null);

  // 11. Budget & Settings State
  const [accountBalance, setAccountBalance] = useState(null);
  const [budgetSettings, setBudgetSettings] = useState({
    virtualTotalBudget: 30000000,
    realTotalBudget: 10000000,
    tossAvailableCash: 0,
    tossTotalAssetAmount: 0,
    bots: [],
  });
  const [botRatios, setBotRatios] = useState({});
  const [brokerConfig, setBrokerConfig] = useState({
    account_mode: 'VIRTUAL',
    has_kiwoom_keys: false,
    has_toss_keys: false,
    has_gemini_key: false,
  });
  const [purchasePriority, setPurchasePriority] = useState(['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']);

  // Active Trade Mode calculation
  const selectedBot = bots.find((b) => b.bot_id === selectedBotId) || bots[0];
  const activeTradeMode = tradingModeFilter === 'AUTO'
    ? (selectedBot?.trade_mode || 'VIRTUAL')
    : tradingModeFilter;

  // ========================================================
  // DATA FETCHING VIA API SERVICE LAYER
  // ========================================================

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.getHealth();
      setHealthData(data);
    } catch {}
  }, []);

  const fetchBots = useCallback(async () => {
    try {
      const data = await api.getBots();
      setBots(data.bots || []);
      if (!selectedBotId && data.bots?.length > 0) {
        setSelectedBotId(data.bots[0].bot_id);
      }
    } catch {}
  }, [selectedBotId]);

  const fetchTradesAndPositions = useCallback(async (mode = activeTradeMode) => {
    try {
      const params = (mode && mode !== 'ALL') ? { mode, limit: 100 } : { limit: 100 };
      const [dataT, dataP] = await Promise.all([
        api.getTrades(params),
        api.getPositions(params),
      ]);
      setTrades(dataT.trades || []);
      setPositions(dataP.positions || []);
    } catch {}
  }, [activeTradeMode]);

  const fetchAiDecisions = useCallback(async () => {
    try {
      const data = await api.getAiDecisions(15);
      setAiDecisions(data.decisions || []);
    } catch {}
  }, []);

  const fetchSettingsAndBalance = useCallback(async () => {
    try {
      const [budgetData, settingsData, balanceData] = await Promise.all([
        api.getBudgetSettings(),
        api.getSettings(),
        api.getAccountBalance(),
      ]);
      setBudgetSettings(budgetData);
      setAccountBalance(balanceData);
      if (settingsData.brokerConfig) {
        setBrokerConfig(settingsData.brokerConfig);
      }
      if (settingsData.settings?.purchase_priority) {
        try {
          const parsed = JSON.parse(settingsData.settings.purchase_priority);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPurchasePriority(parsed);
          }
        } catch (e) {}
      }
    } catch {}
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api.getLeaderboard();
      setLeaderboard(data.leaderboard || []);
    } catch {}
  }, []);

  const fetchStats = useCallback(async (mode = statsModeFilter, period = statsPeriodTab) => {
    try {
      const data = await api.getStats(mode, period);
      setStatsData(data);
    } catch {}
  }, [statsModeFilter, statsPeriodTab]);

  const fetchNews = useCallback(async (page = 1) => {
    try {
      const params = { page: String(page), limit: '50' };
      if (newsQuery) params.q = newsQuery;
      if (selectedTag) params.tag = selectedTag;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const data = await api.getNews(params);
      setNewsList(data.news || []);
      setNewsCounts(data.counts || { total: 0, bullish: 0, bearish: 0, neutral: 0 });
      setNewsPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
    } catch {}
  }, [newsQuery, selectedTag, startDate, endDate]);

  // Initial Data Load & Polling
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchHealth();
    fetchBots();
    fetchAiDecisions();
    fetchSettingsAndBalance();

    const healthInterval = setInterval(fetchHealth, 10000);
    return () => clearInterval(healthInterval);
  }, [isAuthenticated, fetchHealth, fetchBots, fetchAiDecisions, fetchSettingsAndBalance]);

  // 24시간 보안 세션 만료 감시 타이머 (하루가 지나면 즉시 인증코드 입력화면으로 이동)
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkExpire = () => {
      if (!checkGateAuthentication()) {
        setIsAuthenticated(false);
        setModalInfo({
          title: '인증 세션 만료',
          message: '로그인 후 24시간(1일)이 경과하여 보안을 위해 인증이 만료되었습니다.\n인증코드를 다시 입력해주세요.',
          type: 'warning',
        });
      }
    };

    const expireTimer = setInterval(checkExpire, 15000); // 15초마다 만료 여부 확인
    return () => clearInterval(expireTimer);
  }, [isAuthenticated]);

  // Dynamic Content Polling per Tab
  useEffect(() => {
    if (!isAuthenticated) return;

    if (activeMenu === 'TRADING') {
      fetchTradesAndPositions(activeTradeMode);
      const tInterval = setInterval(() => {
        fetchTradesAndPositions(activeTradeMode);
        fetchBots();
      }, 5000);
      return () => clearInterval(tInterval);
    }

    if (activeMenu === 'LAB') {
      fetchLeaderboard();
    }

    if (activeMenu === 'STATS') {
      fetchStats(statsModeFilter, statsPeriodTab);
    }

    if (activeMenu === 'NEWS') {
      fetchNews(1);
    }
  }, [isAuthenticated, activeMenu, activeTradeMode, statsModeFilter, statsPeriodTab, fetchTradesAndPositions, fetchBots, fetchLeaderboard, fetchStats, fetchNews]);

  // ========================================================
  // USER ACTION HANDLERS
  // ========================================================

  const handleBotAction = async (action, extra = {}) => {
    if (!selectedBotId) return;
    try {
      const res = await api.botAction(selectedBotId, action, extra);
      setModalInfo({ title: '봇 제어 완료', message: res.message, type: 'info' });
      await fetchBots();
      if (action === 'TOGGLE_MODE' && res.newMode) {
        fetchTradesAndPositions(res.newMode);
      } else {
        fetchTradesAndPositions();
      }
      fetchSettingsAndBalance();
    } catch (err) {
      setModalInfo({ title: '오류', message: err.message, type: 'error' });
    }
  };

  const handleVirtualTradeTest = async (side, stockCode = selectedStockCode) => {
    if (!selectedBotId) return;
    try {
      const res = await api.botVirtualTrade(selectedBotId, { side, stockCode });
      setModalInfo({ title: '주문 체결 완료', message: res.message, type: 'success' });
      fetchBots();
      fetchTradesAndPositions();
      fetchSettingsAndBalance();
    } catch (err) {
      setModalInfo({ title: '주문 실패 / 거부', message: err.message, type: 'error' });
    }
  };

  const handleSellPosition = async (positionId, botId) => {
    const targetBot = botId || selectedBotId;
    try {
      const res = await api.botVirtualTrade(targetBot, { side: 'SELL', positionId });
      setModalInfo({ title: '매도 완료', message: res.message, type: 'info' });
      fetchBots();
      fetchTradesAndPositions();
      fetchSettingsAndBalance();
    } catch (err) {
      setModalInfo({ title: '매도 실패', message: err.message, type: 'error' });
    }
  };

  const handleAiEvaluateAndTrade = async (executeTrade = false, targetCode = null) => {
    setIsAiEvaluating(true);
    try {
      const res = await api.aiEvaluateAndTrade({
        botId: selectedBotId,
        candidateCode: targetCode || selectedStockCode,
        executeTrade,
      });

      setAiDecisions(res.decisions || []);
      if (executeTrade && res.executedResult) {
        setModalInfo({
          title: 'AI 퀀트 ⨉ Python 주문 실행 완료',
          message: `[${res.executedResult.symbol || selectedStockCode}] 주문이 Python Core Executor를 통해 성공적으로 집행되었습니다.`,
          type: 'success',
        });
        fetchTradesAndPositions();
        fetchSettingsAndBalance();
        fetchBots();
      } else if (!executeTrade) {
        setModalInfo({
          title: 'AI LLM 시장 분석 완료',
          message: `Gemini LLM이 ${res.decisions?.length || 0}개 종목에 대한 실시간 뉴스 감성 및 매매 시그널 분석을 완료했습니다.`,
          type: 'info',
        });
      }
    } catch (err) {
      setModalInfo({ title: 'AI 분석 실패', message: err.message, type: 'error' });
    } finally {
      setIsAiEvaluating(false);
    }
  };

  const handleFastReplay = async () => {
    setIsReplaying(true);
    setReplayResult(null);
    try {
      const res = await api.fastReplay(10000000);
      setReplayResult(res.result);
      fetchLeaderboard();
    } catch (err) {
      setModalInfo({ title: '시뮬레이션 실패', message: err.message, type: 'error' });
    } finally {
      setIsReplaying(false);
    }
  };

  const handlePromoteBot = async (botId) => {
    try {
      const res = await api.botPromote(botId);
      setModalInfo({ title: '실전 승격 완료', message: res.result.msg, type: 'success' });
      fetchBots();
      fetchLeaderboard();
    } catch (err) {
      setModalInfo({ title: '오류', message: err.message, type: 'error' });
    }
  };

  const handleSaveBudget = async () => {
    const allocations = bots.map((b) => ({
      bot_id: b.bot_id,
      ratio: botRatios[b.bot_id] ?? Math.round((b.allocation_ratio || 0.33) * 100),
    }));

    try {
      const res = await api.saveBudgetSettings({
        virtualTotalBudget: budgetSettings.virtualTotalBudget,
        realTotalBudget: budgetSettings.realTotalBudget,
        botAllocations: allocations,
      });
      setModalInfo({ title: '예산 저장 완료', message: res.message, type: 'success' });
      fetchSettingsAndBalance();
      fetchBots();
    } catch (err) {
      setModalInfo({ title: '설정 저장 실패', message: err.message, type: 'error' });
    }
  };

  const handleSavePurchasePriority = async (newPriority) => {
    try {
      await api.saveSettings({
        settings: {
          purchase_priority: JSON.stringify(newPriority),
        },
      });
      setPurchasePriority(newPriority);
      const labels = {
        KR_UNIT: '국내 주식 1주 (온주)',
        US_UNIT: '미국 주식 1주 (온주)',
        US_FRACTIONAL: '미국 주식 소수점 금액',
      };
      const textList = newPriority.map((p, i) => `${i + 1}순위: ${labels[p] || p}`).join('\n');
      setModalInfo({
        title: '구매 우선순위 저장 완료',
        message: `주식 구매 우선순위가 성공적으로 저장되었습니다.\n\n${textList}`,
        type: 'success',
      });
      fetchSettingsAndBalance();
    } catch (err) {
      setModalInfo({ title: '우선순위 저장 실패', message: err.message, type: 'error' });
    }
  };

  const handleSaveKeys = async (form, onSuccess) => {
    try {
      const res = await api.saveSettings({ brokerConfig: form });
      setModalInfo({ title: '키 갱신 완료', message: res.message, type: 'success' });
      if (onSuccess) onSuccess();
      fetchSettingsAndBalance();
    } catch (err) {
      setModalInfo({ title: '오류', message: err.message, type: 'error' });
    }
  };

  const handleExportBackup = async () => {
    window.open('/api/backup/export', '_blank');
  };

  const handleImportBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          const res = await fetch('/api/backup/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          const data = await res.json();
          if (res.ok) {
            setModalInfo({ title: '복원 성공', message: data.message, type: 'success' });
            fetchSettingsAndBalance();
            fetchBots();
          } else {
            setModalInfo({ title: '복원 실패', message: data.message, type: 'error' });
          }
        } catch (err) {
          setModalInfo({ title: '파일 파싱 오류', message: err.message, type: 'error' });
        }
      };
      reader.readAsText(file);
    } catch (err) {
      setModalInfo({ title: '오류', message: err.message, type: 'error' });
    }
  };

  // Streaming Briefing handlers
  const handleStartBriefing = () => {
    if (briefingStreamRef.current) briefingStreamRef.current.close();
    setAiBriefingText('');
    setIsBriefingStreaming(true);

    const es = api.createBriefingStream();
    briefingStreamRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.char) setAiBriefingText((prev) => prev + parsed.char);
        if (parsed.done) {
          setIsBriefingStreaming(false);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setIsBriefingStreaming(false);
      es.close();
    };
  };

  // Streaming News Analysis handlers
  const handleStartAiNews = () => {
    if (newsStreamRef.current) newsStreamRef.current.close();
    setAiNewsText('');
    setIsAiNewsStreaming(true);

    const es = api.createNewsStream();
    newsStreamRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.char) setAiNewsText((prev) => prev + parsed.char);
        if (parsed.done) {
          setIsAiNewsStreaming(false);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setIsAiNewsStreaming(false);
      es.close();
    };
  };

  // If Gate is locked, show Gate Passcode Screen
  if (!isAuthenticated) {
    return <GateModal onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  // ========================================================
  // RENDER: MAIN APPLICATION (2:8 LAYOUT VIA styles.css)
  // ========================================================

  return (
    <div className="app-container">
      {/* 20% Sidebar */}
      <Header
        healthData={healthData}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        onLogout={() => {
          localStorage.removeItem('kis_gate_passed');
          localStorage.removeItem('kis_gate_auth_time');
          setIsAuthenticated(false);
        }}
      />

      {/* 80% Main Content Area */}
      <main className="main-content">
        {/* ========================================================
            MENU 1: 거래현황
            ======================================================== */}
        {activeMenu === 'TRADING' && (
          <div>
            {/* Top Market AI Streaming Marquee Box */}
            <MarketBanner
              aiBriefingText={aiBriefingText}
              isBriefingStreaming={isBriefingStreaming}
              onStartBriefing={handleStartBriefing}
            />

            {/* Mode Filter Bar, Mode Banner & Account Assets Summary */}
            <BudgetBar
              tradingModeFilter={tradingModeFilter}
              setTradingModeFilter={setTradingModeFilter}
              activeTradeMode={activeTradeMode}
              selectedBot={selectedBot}
              accountBalance={accountBalance}
              onRefreshBalance={fetchSettingsAndBalance}
            />

            {/* Bot Tabs & Action Controls & Metrics */}
            <BotCard
              bots={bots}
              selectedBotId={selectedBotId}
              setSelectedBotId={setSelectedBotId}
              selectedBot={selectedBot}
              selectedStockCode={selectedStockCode}
              setSelectedStockCode={setSelectedStockCode}
              onBotAction={handleBotAction}
              onManualTradeTest={handleVirtualTradeTest}
              onAiEvaluateAndTrade={handleAiEvaluateAndTrade}
              isAiEvaluating={isAiEvaluating}
              positionsCount={
                positions.filter(
                  (p) =>
                    p.bot_id === selectedBot?.bot_id &&
                    (activeTradeMode === 'ALL' || p.trade_mode === activeTradeMode)
                ).length
              }
              activeTradeMode={activeTradeMode}
            />

            {/* Hybrid Architecture Board (AI LLM Decisions & Python Executor) */}
            <HybridBoard
              aiDecisions={aiDecisions}
              isAiEvaluating={isAiEvaluating}
              onAiEvaluateAndTrade={handleAiEvaluateAndTrade}
            />

            {/* Active Positions Table */}
            <PositionsTable
              positions={positions}
              onSellPosition={handleSellPosition}
              activeTradeMode={activeTradeMode}
            />

            {/* Trades History Table */}
            <TradesTable trades={trades} activeTradeMode={activeTradeMode} />
          </div>
        )}

        {/* ========================================================
            MENU 2: 알고리즘 성능 검증소 (가상 매매 전용 대시보드)
            ======================================================== */}
        {activeMenu === 'LAB' && (
          <LabPanel
            leaderboard={leaderboard}
            onFastReplay={handleFastReplay}
            isReplaying={isReplaying}
            replayResult={replayResult}
            onPromoteBot={handlePromoteBot}
          />
        )}

        {/* ========================================================
            MENU 3: 통계
            ======================================================== */}
        {activeMenu === 'STATS' && (
          <StatsPanel
            statsData={statsData}
            statsPeriodTab={statsPeriodTab}
            setStatsPeriodTab={(tab) => {
              setStatsPeriodTab(tab);
              localStorage.setItem('kis_stats_tab', tab);
            }}
            statsModeFilter={statsModeFilter}
            setStatsModeFilter={setStatsModeFilter}
          />
        )}

        {/* ========================================================
            MENU 4: 증시뉴스 & 공시
            ======================================================== */}
        {activeMenu === 'NEWS' && (
          <NewsPanel
            newsList={newsList}
            newsCounts={newsCounts}
            newsPagination={newsPagination}
            newsQuery={newsQuery}
            setNewsQuery={setNewsQuery}
            selectedTag={selectedTag}
            setSelectedTag={setSelectedTag}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            onFetchNews={fetchNews}
            onRefreshNews={async () => {
              try {
                await api.refreshNews();
                fetchNews(1);
              } catch {}
            }}
            isAiNewsStreaming={isAiNewsStreaming}
            aiNewsText={aiNewsText}
            onStartAiNews={handleStartAiNews}
          />
        )}

        {/* ========================================================
            MENU 5: 설정
            ======================================================== */}
        {activeMenu === 'SETTINGS' && (
          <SettingsPanel
            accountBalance={accountBalance}
            budgetSettings={budgetSettings}
            setBudgetSettings={setBudgetSettings}
            botRatios={botRatios}
            setBotRatios={setBotRatios}
            bots={bots}
            brokerConfig={brokerConfig}
            purchasePriority={purchasePriority}
            setPurchasePriority={setPurchasePriority}
            onSavePriority={handleSavePurchasePriority}
            onSaveBudget={handleSaveBudget}
            onSaveKeys={handleSaveKeys}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
          />
        )}
      </main>

      {/* Modal Dialog */}
      <Modal modalInfo={modalInfo} onClose={() => setModalInfo(null)} />
    </div>
  );
}
