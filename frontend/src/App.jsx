import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './services/api';

// Modular Components
import Modal from './components/common/Modal';
import GateModal from './components/auth/GateModal';
import Header from './components/layout/Header';
import MarketBanner from './components/layout/MarketBanner';
import BudgetBar from './components/layout/BudgetBar';
import HybridBoard from './components/trading/HybridBoard';
import BotCard from './components/trading/BotCard';
import PositionsTable from './components/trading/PositionsTable';
import TradesTable from './components/trading/TradesTable';
import AiBriefingPanel from './components/trading/AiBriefingPanel';
import LabPanel from './components/lab/LabPanel';
import StatsPanel from './components/stats/StatsPanel';
import NewsPanel from './components/news/NewsPanel';
import SettingsModal from './components/settings/SettingsModal';

export default function App() {
  // 1. Gate Authorization State
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('kis_gate_passed') === 'true'
  );

  // 2. Navigation State
  const [activeMenu, setActiveMenu] = useState('TRADING'); // TRADING, LAB, STATS, NEWS
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 3. Global Modal / Notifications
  const [modalInfo, setModalInfo] = useState(null);

  // 4. System & Health State
  const [healthData, setHealthData] = useState(null);

  // 5. Trading & Bots State
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [tradingModeFilter, setTradingModeFilter] = useState('AUTO'); // 'AUTO', 'VIRTUAL', 'REAL', 'ALL'
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);

  // 6. AI Hybrid Decisions & Candidates State
  const [candidateStocks, setCandidateStocks] = useState([]);
  const [selectedStockCode, setSelectedStockCode] = useState('005930');
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
  const [statsPeriodTab, setStatsPeriodTab] = useState('daily');
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
  const [budgetSettings, setBudgetSettings] = useState({
    virtualTotalBudget: 30000000,
    realTotalBudget: 10000000,
    tossAvailableCash: 0,
    tossTotalAssetAmount: 0,
    bots: [],
  });
  const [brokerConfig, setBrokerConfig] = useState({
    account_mode: 'VIRTUAL',
    has_kiwoom_keys: false,
    has_toss_keys: false,
    has_gemini_key: false,
  });

  // Active Trade Mode calculation
  const selectedBot = bots.find((b) => b.bot_id === selectedBotId) || bots[0];
  const activeTradeMode = tradingModeFilter === 'AUTO'
    ? (selectedBot?.trade_mode || 'VIRTUAL')
    : tradingModeFilter;

  // ========================================================
  // DATA FETCHING VIA API SERVICE
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

  const fetchCandidates = useCallback(async () => {
    try {
      const data = await api.getCandidates();
      setCandidateStocks(data.candidates || []);
    } catch {}
  }, []);

  const fetchAiDecisions = useCallback(async () => {
    try {
      const data = await api.getAiDecisions(15);
      setAiDecisions(data.decisions || []);
    } catch {}
  }, []);

  const fetchBudgetAndSettings = useCallback(async () => {
    try {
      const [budgetData, settingsData] = await Promise.all([
        api.getBudgetSettings(),
        api.getSettings(),
      ]);
      setBudgetSettings(budgetData);
      if (settingsData.brokerConfig) {
        setBrokerConfig(settingsData.brokerConfig);
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

  // Initial Load & Periodic Health Polling
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchHealth();
    fetchBots();
    fetchCandidates();
    fetchAiDecisions();
    fetchBudgetAndSettings();

    const healthInterval = setInterval(fetchHealth, 10000);
    return () => clearInterval(healthInterval);
  }, [isAuthenticated, fetchHealth, fetchBots, fetchCandidates, fetchAiDecisions, fetchBudgetAndSettings]);

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

  const handleToggleRunning = async (botId, action) => {
    try {
      const res = await api.botAction(botId, action);
      setModalInfo({ title: '봇 제어 완료', message: res.message, type: 'info' });
      await fetchBots();
    } catch (err) {
      setModalInfo({ title: '제어 오류', message: err.message, type: 'error' });
    }
  };

  const handleToggleMode = async (botId) => {
    try {
      const res = await api.botAction(botId, 'TOGGLE_MODE');
      setModalInfo({ title: '모드 전환 완료', message: res.message, type: 'info' });
      await fetchBots();
      if (res.newMode) fetchTradesAndPositions(res.newMode);
    } catch (err) {
      setModalInfo({ title: '모드 전환 실패', message: err.message, type: 'error' });
    }
  };

  const handleResetVirtual = async (botId) => {
    try {
      const res = await api.botAction(botId, 'RESET_VIRTUAL');
      setModalInfo({ title: '가상 계좌 초기화', message: res.message, type: 'info' });
      await fetchBots();
      await fetchTradesAndPositions();
    } catch (err) {
      setModalInfo({ title: '초기화 실패', message: err.message, type: 'error' });
    }
  };

  const handleManualTradeTest = async (side, stockCode) => {
    if (!selectedBotId) return;
    try {
      const res = await api.botVirtualTrade(selectedBotId, { side, stockCode });
      setModalInfo({ title: '주문 체결 성공', message: res.message, type: 'success' });
      fetchBots();
      fetchTradesAndPositions();
      fetchBudgetAndSettings();
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
      fetchBudgetAndSettings();
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
        fetchBudgetAndSettings();
        fetchBots();
      } else {
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

  const handleFastReplay = async (seed) => {
    setIsReplaying(true);
    setReplayResult(null);
    try {
      const res = await api.fastReplay(seed);
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
      setModalInfo({ title: '승격 실패', message: err.message, type: 'error' });
    }
  };

  const handleSaveBudget = async (payload) => {
    try {
      const res = await api.saveBudgetSettings(payload);
      setModalInfo({ title: '예산 설정 완료', message: res.message, type: 'success' });
      setIsSettingsOpen(false);
      fetchBudgetAndSettings();
      fetchBots();
    } catch (err) {
      setModalInfo({ title: '설정 저장 실패', message: err.message, type: 'error' });
    }
  };

  const handleSaveKeys = async (form) => {
    try {
      const res = await api.saveSettings({ brokerConfig: form });
      setModalInfo({ title: '보안 키 저장 완료', message: res.message, type: 'success' });
      fetchBudgetAndSettings();
    } catch (err) {
      setModalInfo({ title: '저장 실패', message: err.message, type: 'error' });
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

  const handleStopBriefing = () => {
    if (briefingStreamRef.current) {
      briefingStreamRef.current.close();
      briefingStreamRef.current = null;
    }
    setIsBriefingStreaming(false);
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

  const handleStopAiNews = () => {
    if (newsStreamRef.current) {
      newsStreamRef.current.close();
      newsStreamRef.current = null;
    }
    setIsAiNewsStreaming(false);
  };

  // If Gate is locked, show Gate Passcode Screen
  if (!isAuthenticated) {
    return <GateModal onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  // ========================================================
  // MAIN VIEW RENDER
  // ========================================================

  return (
    <div className={`min-h-screen text-slate-100 ${
      activeTradeMode === 'REAL' ? 'bg-slate-950 font-sans' : 'bg-slate-950 font-sans'
    }`}>
      {/* 1. Header Navigation & Health Bar */}
      <Header
        healthData={healthData}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        tradingModeFilter={tradingModeFilter}
        setTradingModeFilter={setTradingModeFilter}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeTradeMode={activeTradeMode}
      />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* 2. Market Regime & Hybrid Architecture Indicator */}
        <MarketBanner healthData={healthData} />

        {/* 3. Budget & Safety Cap Overview */}
        <BudgetBar
          budgetSettings={budgetSettings}
          activeTradeMode={activeTradeMode}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* 4. Active Menu View Content */}
        {activeMenu === 'TRADING' && (
          <div className="space-y-6">
            {/* AI Hybrid Intelligence Board (Gemini LLM + Python Core Executor) */}
            <HybridBoard
              candidateStocks={candidateStocks}
              selectedStockCode={selectedStockCode}
              setSelectedStockCode={setSelectedStockCode}
              aiDecisions={aiDecisions}
              isAiEvaluating={isAiEvaluating}
              onAiEvaluateAndTrade={handleAiEvaluateAndTrade}
              onManualTradeTest={handleManualTradeTest}
              activeTradeMode={activeTradeMode}
            />

            {/* Trading Bots Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">🤖</span>
                  <h3 className="font-bold text-white text-base">3대 퀀트 전략 봇</h3>
                </div>
                <div className="text-xs text-slate-400">
                  선택된 봇: <b className="text-white">{selectedBot?.nickname || '선택 없음'}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {bots.map((bot) => (
                  <BotCard
                    key={bot.bot_id}
                    bot={bot}
                    isSelected={selectedBotId === bot.bot_id}
                    onSelect={() => setSelectedBotId(bot.bot_id)}
                    onToggleRunning={handleToggleRunning}
                    onToggleMode={handleToggleMode}
                    onResetVirtual={handleResetVirtual}
                    onManualTrade={handleManualTradeTest}
                    activeTradeMode={activeTradeMode}
                  />
                ))}
              </div>
            </div>

            {/* Positions Table */}
            <PositionsTable
              positions={positions}
              onSellPosition={handleSellPosition}
              activeTradeMode={activeTradeMode}
            />

            {/* Trades History Table */}
            <TradesTable trades={trades} />

            {/* Real-time Streaming AI Market Briefing */}
            <AiBriefingPanel
              aiBriefingText={aiBriefingText}
              isStreaming={isBriefingStreaming}
              onStartBriefing={handleStartBriefing}
              onStopBriefing={handleStopBriefing}
            />
          </div>
        )}

        {activeMenu === 'LAB' && (
          <LabPanel
            leaderboard={leaderboard}
            onFastReplay={handleFastReplay}
            isReplaying={isReplaying}
            replayResult={replayResult}
            onPromoteBot={handlePromoteBot}
          />
        )}

        {activeMenu === 'STATS' && (
          <StatsPanel
            statsData={statsData}
            statsPeriodTab={statsPeriodTab}
            setStatsPeriodTab={setStatsPeriodTab}
            statsModeFilter={statsModeFilter}
            setStatsModeFilter={setStatsModeFilter}
          />
        )}

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
            onStopAiNews={handleStopAiNews}
          />
        )}
      </main>

      {/* 5. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        budgetSettings={budgetSettings}
        onSaveBudget={handleSaveBudget}
        brokerConfig={brokerConfig}
        onSaveKeys={handleSaveKeys}
      />

      {/* 6. Alert / Confirm Notification Modal */}
      <Modal modalInfo={modalInfo} onClose={() => setModalInfo(null)} />
    </div>
  );
}
