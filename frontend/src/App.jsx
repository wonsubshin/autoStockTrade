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

  // 2. Navigation State (5 Menus: REAL_TRADING, VIRTUAL_ARENA, STATS, NEWS, SETTINGS)
  const [activeMenu, setActiveMenu] = useState('REAL_TRADING');

  // 3. Global Modal / Notification
  const [modalInfo, setModalInfo] = useState(null);

  // 4. System & Health State
  const [healthData, setHealthData] = useState(null);

  // 5. Trading & Bots State
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [arenaSelectedIds, setArenaSelectedIds] = useState([]);
  const arenaInitRef = useRef(false);
  const [isSelectingRealBots, setIsSelectingRealBots] = useState(false);
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
    virtualTotalBudget: 10000000,
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
      const botList = data.bots || [];
      setBots(botList);

      // 5초 주기 폴링 시에도 사용자가 체크한 3개 봇 상태가 초기화되지 않도록 최초 1회만 동기화
      if (!arenaInitRef.current && botList.length > 0) {
        const realSelected = botList.filter((b) => Number(b.is_real_selected) === 1).map((b) => b.bot_id);
        if (realSelected.length === 3) {
          setArenaSelectedIds(realSelected);
          arenaInitRef.current = true;
        } else if (botList.length >= 3) {
          setArenaSelectedIds([botList[0].bot_id, botList[1].bot_id, botList[2].bot_id]);
          arenaInitRef.current = true;
        }
      }

      if (!selectedBotId && botList.length > 0) {
        const realSelected = botList.find((b) => Number(b.is_real_selected) === 1);
        setSelectedBotId(realSelected ? realSelected.bot_id : botList[0].bot_id);
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

    if (activeMenu === 'REAL_TRADING' || activeMenu === 'TRADING') {
      fetchTradesAndPositions('REAL');
      const tInterval = setInterval(() => {
        fetchTradesAndPositions('REAL');
        fetchBots();
      }, 5000);
      return () => clearInterval(tInterval);
    }

    if (activeMenu === 'VIRTUAL_ARENA' || activeMenu === 'LAB') {
      fetchTradesAndPositions('VIRTUAL');
      fetchLeaderboard();
      const labInterval = setInterval(() => {
        fetchTradesAndPositions('VIRTUAL');
        fetchBots();
        fetchLeaderboard();
      }, 5000); // 10대 봇 가상 아레나 5초 주기 자동 갱신
      return () => clearInterval(labInterval);
    }

    if (activeMenu === 'STATS') {
      fetchStats(statsModeFilter, statsPeriodTab);
    }

    if (activeMenu === 'NEWS') {
      fetchNews(1);
    }
  }, [isAuthenticated, activeMenu, activeTradeMode, statsModeFilter, statsPeriodTab, fetchTradesAndPositions, fetchBots, fetchLeaderboard, fetchStats, fetchNews]);

  // ========================================================
  // USER ACTION HANDLERS & CONFIRMATION ALERTS
  // ========================================================

  const CANDIDATE_NAMES = {
    '005930': '삼성전자',
    '000660': 'SK하이닉스',
    '373220': 'LG에너지솔루션',
    '207940': '삼성바이오로직스',
    '005380': '현대차',
    '000270': '기아',
    '068270': '셀트리온',
    '005490': 'POSCO홀딩스',
    '035420': 'NAVER',
    '105560': 'KB금융',
    '247540': '에코프로비엠',
    '086520': '에코프로',
    '041510': '에스엠',
    '028300': 'HLB',
    '259960': '크래프톤',
    AAPL: '애플 (Apple)',
    NVDA: '엔비디아 (NVIDIA)',
    TSLA: '테슬라 (Tesla)',
    MSFT: '마이크로소프트 (Microsoft)',
    QQQ: 'Invesco QQQ ETF',
    SBUX: '스타벅스 (Starbucks)',
  };

  const handleBotAction = async (action, extra = {}) => {
    if (!selectedBotId && action !== 'RESET_VIRTUAL_ALL') return;

    // 1. 가상 계좌 리셋 시 확인 Alert 모달
    if (action === 'RESET_VIRTUAL' || action === 'RESET_VIRTUAL_ALL') {
      const isAll = action === 'RESET_VIRTUAL_ALL';
      setModalInfo({
        type: 'confirm',
        confirmColor: 'danger',
        confirmText: '⚠️ 초기화 진행',
        title: isAll ? '⚠️ 가상 전체 초기화 및 새로 시작' : '⚠️ 가상 계좌 초기화',
        message: isAll
          ? '모든 가상 봇(10개)의 보유 포지션 및 누적 거래내역이 완전히 삭제됩니다.\n\n각 봇의 초기 자본금이 100만 원(총 1,000만 원)으로 재설정되며, 모든 성과 지표(누적 수익률, 실현 손익금, 승률, 익절/손절)가 0으로 초기화된 상태에서 새로운 자율 퀀트 경쟁을 시작합니다.\n\n정말 가상 데이터를 전체 초기화하시겠습니까?'
          : `[${selectedBot?.nickname || selectedBot?.name}]의 모든 가상 보유 포지션과 지금까지 거래한 내역이 모두 삭제됩니다.\n\n초기 자본금(100만 원)으로 원복되어 처음부터 새롭게 거래를 시작합니다.\n\n정말 초기화하시겠습니까?`,
        onConfirm: async () => {
          try {
            const targetId = isAll ? 'all' : selectedBotId;
            const res = isAll ? await api.resetVirtualAll(1000000) : await api.botAction(targetId, action, { ...extra, seedCapital: 1000000 });
            setModalInfo({ title: '초기화 완료', message: res.message, type: 'success' });
            await Promise.all([
              fetchBots(),
              fetchTradesAndPositions(),
              fetchLeaderboard(),
              fetchSettingsAndBalance(),
            ]);
          } catch (err) {
            setModalInfo({ title: '초기화 실패', message: err.message, type: 'error' });
          }
        },
      });
      return;
    }

    const executeAction = async () => {
      try {
        const res = await api.botAction(selectedBotId, action, extra);
        setModalInfo({
          title: action === 'START' ? '거래 시작 완료' : action === 'STOP' ? '거래 중지 완료' : '봇 제어 완료',
          message: res.message,
          type: 'info',
        });
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

    const isReal = selectedBot?.is_real_selected === 1 || selectedBot?.trade_mode === 'REAL';
    const botName = selectedBot ? `${selectedBot.name} (${selectedBot.nickname})` : selectedBotId;

    // 실전매매 / 가상매매 거래중지 시 반드시 실행 전 confirm 모달
    if (action === 'STOP') {
      setModalInfo({
        type: 'confirm',
        confirmColor: 'danger',
        confirmText: '⏹ 거래 중지',
        title: isReal ? '⚠️ 실전 거래 중지 확인' : '⏹ 거래 중지 확인',
        message: isReal
          ? `[${botName}]의 실전 자동매매를 일시 중지하시겠습니까?\n\n• 대상: 실전 매매 담당 봇\n• 상태: 거래 중지 대기\n• 안내: 중지 중에는 신규 실전 매수/매도 주문이 전송되지 않습니다.\n\n정말 실전 거래를 중지하시겠습니까?`
          : `[${botName}]의 자동 거래를 중지하시겠습니까?`,
        onConfirm: () => {
          executeAction();
        },
      });
      return;
    }

    // 실전매매 / 가상매매 거래시작(실행) 시 반드시 실행 전 confirm 모달
    if (action === 'START') {
      setModalInfo({
        type: 'confirm',
        confirmColor: 'success',
        confirmText: '▶ 거래 시작',
        title: isReal ? '🚨 실전 거래 시작(가동) 확인' : '▶ 거래 시작 확인',
        message: isReal
          ? `[${botName}]의 실전 자동매매를 시작(가동)하시겠습니까?\n\n• 상태: 실전 거래 가동 중 (키움/토스 실계좌 직접 연동)\n• 배정 예산: ${(selectedBot?.real_allocated_capital || selectedBot?.allocated_capital || 0).toLocaleString()}원\n• 가용 예수금: ${(selectedBot?.real_available_krw || 0).toLocaleString()}원\n• 안내: 퀀트 알고리즘 신호에 따라 실제 증권사 계좌 주문이 즉시 집행될 수 있습니다.\n\n정말 실전 거래를 시작하시겠습니까?`
          : `[${botName}]의 자동 거래를 시작하시겠습니까?`,
        onConfirm: () => {
          executeAction();
        },
      });
      return;
    }

    if (action === 'TOGGLE_MODE') {
      const nextMode = selectedBot?.trade_mode === 'VIRTUAL' ? '실전 매매 (REAL)' : '가상 매매 (VIRTUAL)';
      setModalInfo({
        type: 'confirm',
        title: '🔄 거래 모드 전환 확인',
        message: `[${botName}]의 거래 모드를 [${nextMode}]로 전환하시겠습니까?`,
        onConfirm: () => {
          executeAction();
        },
      });
      return;
    }

    executeAction();
  };

  const handleResetVirtualAll = () => handleBotAction('RESET_VIRTUAL_ALL');

  const handleSelectRealBots = async (selectedBotIds) => {
    if (!Array.isArray(selectedBotIds) || selectedBotIds.length !== 3) {
      setModalInfo({
        title: '선택 안내',
        message: '실전 거래를 담당할 퀀트 봇을 정확히 3개 선택해주세요.',
        type: 'warning',
      });
      return;
    }

    if (isSelectingRealBots) return; // 더블클릭 중복 요청 방지

    const selectedBotNames = selectedBotIds
      .map((id) => {
        const b = bots.find((x) => x.bot_id === id);
        return b ? `${b.name} (${b.nickname})` : id;
      })
      .join('\n• ');

    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '✅ 3개 봇 실전 확정',
      title: '🎯 실전 거래 담당 봇 (3개) 지정 확인',
      message: `선택하신 3개의 퀀트 봇을 실전 매매 담당으로 확정하시겠습니까?\n\n• ${selectedBotNames}\n\n'확인'을 누르면 확정 후 [환경설정] 화면으로 이동하여 투자금 배분 비율(%)을 설정하게 됩니다.`,
      onConfirm: async () => {
        setIsSelectingRealBots(true);
        try {
          const res = await api.selectRealBots(selectedBotIds);
          if (res.bots && res.bots.length > 0) {
            setBots(res.bots);
          }
          setArenaSelectedIds(selectedBotIds);
          arenaInitRef.current = true;

          setActiveMenu('SETTINGS');
          setModalInfo({
            title: '실전 담당 봇 (3개) 확정 완료',
            message: '선택하신 3개의 봇이 실전 거래 담당으로 지정되었습니다.\n\n[환경설정] 화면으로 이동했습니다. 각 봇의 투자금 배분 비율(%)을 조정한 뒤 하단의 [확인] 버튼을 눌러주세요.',
            type: 'success',
          });
          await fetchBots();
          await fetchSettingsAndBalance();
        } catch (err) {
          setModalInfo({ title: '실전 봇 선택 실패', message: err.message, type: 'error' });
        } finally {
          setIsSelectingRealBots(false);
        }
      },
    });
  };

  const handleRealToggle = (botId, isRealRunning) => {
    const targetBot = bots.find((b) => b.bot_id === botId);
    const botName = targetBot ? `${targetBot.name} (${targetBot.nickname})` : botId;
    const isStart = !!isRealRunning;

    setModalInfo({
      type: 'confirm',
      confirmColor: isStart ? 'success' : 'danger',
      confirmText: isStart ? '▶ 실전 가동 시작' : '⏹ 실전 거래 중지',
      title: isStart ? '🚨 실전 거래 시작(가동) 확인' : '⚠️ 실전 거래 중지 확인',
      message: isStart
        ? `[${botName}]의 실전 자동매매를 시작(가동)하시겠습니까?\n\n• 상태: 실전 거래 가동 중 (키움/토스 실계좌 직접 연동)\n• 배정 예산: ${(targetBot?.real_allocated_capital || targetBot?.allocated_capital || 0).toLocaleString()}원\n• 가용 예수금: ${(targetBot?.real_available_krw || 0).toLocaleString()}원\n• 매매 대상: 국내 대표주 1주 온주 및 미국 우량주 소수점\n\n'▶ 실전 가동 시작'을 누르면 실시간 퀀트 알고리즘 신호에 따라 실제 증권사 계좌로 즉시 매수/매도 주문이 집행됩니다.`
        : `[${botName}]의 실전 자동매매를 일시 중지하시겠습니까?\n\n• 상태: 실전 거래 중지 대기\n• 안내: 중지 상태에서는 해당 봇의 신규 실전 매수/매도 주문이 전송되지 않습니다.\n\n'⏹ 실전 거래 중지'를 누르면 해당 봇의 실전 거래가 즉시 중지됩니다.`,
      onConfirm: async () => {
        try {
          const res = await api.realToggleBot(botId, isStart);
          setModalInfo({
            title: isStart ? '실전 거래 가동 완료' : '실전 거래 중지 완료',
            message: res.message,
            type: isStart ? 'success' : 'info',
          });
          await fetchBots();
        } catch (err) {
          setModalInfo({ title: '가동 변경 실패', message: err.message, type: 'error' });
        }
      },
    });
  };

  const handleSaveRealAllocation = (totalBudget, allocs) => {
    const summary = allocs
      .map((a) => {
        const b = bots.find((x) => x.bot_id === a.bot_id);
        const name = b ? `${b.name} (${b.nickname})` : a.bot_id;
        return `• ${name}: ${a.ratio}% (배정 예산: ${Math.floor(totalBudget * (a.ratio / 100)).toLocaleString()}원)`;
      })
      .join('\n');

    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '💾 배분 확정 및 실전 적용',
      title: '💾 실전 투자금 배분 저장 및 실전 매매 적용 확인',
      message: `설정한 투자금 및 배분 비율을 실전 거래에 적용하시겠습니까?\n\n총 실전 예산: ${Number(totalBudget).toLocaleString()}원\n\n${summary}\n\n'확인 진행'을 누르면 실전 계좌 잔고를 기준으로 즉시 실전 매매에 적용됩니다.`,
      onConfirm: async () => {
        try {
          const res = await api.saveRealAllocation(totalBudget, allocs);
          if (res.bots && res.bots.length > 0) {
            setBots(res.bots);
          }
          setActiveMenu('REAL_TRADING');
          setModalInfo({
            title: '실전 매매 적용 완료',
            message: '선택하신 3개 봇의 투자금 배분 비율이 정상 저장되었습니다.\n\n[실전 매매] 화면으로 이동하였으며, 배정된 예산으로 실전 거래가 집행됩니다.',
            type: 'success',
          });
          await fetchBots();
          await fetchSettingsAndBalance();
        } catch (err) {
          setModalInfo({ title: '배분 저장 실패', message: err.message, type: 'error' });
        }
      },
    });
  };

  const handleVirtualTradeTest = async (side, stockCode = selectedStockCode) => {
    if (!selectedBotId) return;

    const code = stockCode;
    const stockName = CANDIDATE_NAMES[code] || code;
    const isUs = /^[A-Za-z.]+$/.test(code);
    const isReal = selectedBot?.is_real_selected === 1 || selectedBot?.trade_mode === 'REAL';
    const sideText = side === 'BUY' ? '🛒 실전 매수' : '📉 실전 매도';

    const proceedManualTrade = async () => {
      try {
        const res = await api.botVirtualTrade(selectedBotId, { side, stockCode });
        setModalInfo({ title: '주문 체결 완료', message: res.message, type: 'success' });
        fetchBots();
        fetchTradesAndPositions();
        fetchLeaderboard();
        fetchSettingsAndBalance();
      } catch (err) {
        setModalInfo({ title: '주문 실패 / 거부', message: err.message, type: 'error' });
      }
    };

    if (isReal) {
      setModalInfo({
        type: 'confirm',
        confirmColor: side === 'BUY' ? 'success' : 'danger',
        confirmText: side === 'BUY' ? '🛒 실전 매수 집행' : '📉 실전 매도 집행',
        title: '🚨 Python 실전 즉시 매매 확인',
        message: `Python 코어 실행기를 통해 실제 증권사 계좌 주문을 즉시 집행하시겠습니까?\n\n• 주문 구분: ${sideText}\n• 대상 종목: ${stockName} (${code})\n• 실행 봇: ${selectedBot?.nickname || selectedBot?.name}\n• 거래 시장: ${isUs ? '🇺🇸 미국주식 (토스증권 실계좌 API)' : '🇰🇷 국내주식 (키움 연동)'}\n• 실행 엔진: 🐍 Python Core Executor (toss_executor.py)\n\n'확인 진행'을 누르시면 실제 증권사 계좌로 즉시 주문이 전송됩니다.`,
        onConfirm: () => {
          proceedManualTrade();
        },
      });
      return;
    }

    setModalInfo({
      type: 'confirm',
      confirmColor: side === 'BUY' ? 'success' : 'danger',
      confirmText: side === 'BUY' ? '🛒 가상 매수 집행' : '📉 가상 매도 집행',
      title: `🧪 가상 즉시 ${side === 'BUY' ? '매수' : '매도'} 확인`,
      message: `가상 체결 엔진을 통해 모의 ${side === 'BUY' ? '매수' : '매도'} 주문을 집행하시겠습니까?\n\n• 주문 구분: ${side === 'BUY' ? '🛒 가상 매수' : '📉 가상 매도'}\n• 대상 종목: ${stockName} (${code})\n• 실행 봇: ${selectedBot?.nickname || selectedBot?.name}\n\n'확인 진행'을 누르시면 가상 잔고 및 모의 포지션에 반영됩니다.`,
      onConfirm: () => {
        proceedManualTrade();
      },
    });
  };

  const handleSellPosition = async (positionId, botId) => {
    const targetBot = botId || selectedBotId;
    const targetPos = positions.find((p) => p.id === positionId);

    const proceedSell = async () => {
      try {
        const res = await api.botVirtualTrade(targetBot, { side: 'SELL', positionId });
        setModalInfo({ title: '매도 청산 완료', message: res.message, type: 'info' });
        fetchBots();
        fetchTradesAndPositions();
        fetchLeaderboard();
        fetchSettingsAndBalance();
      } catch (err) {
        setModalInfo({ title: '매도 실패', message: err.message, type: 'error' });
      }
    };

    const isReal = targetPos?.trade_mode === 'REAL';
    const posName = targetPos ? `${targetPos.stock_name} (${targetPos.stock_code})` : `포지션 #${positionId}`;
    const posQty = targetPos?.qty ?? '전량';

    setModalInfo({
      type: 'confirm',
      confirmColor: 'danger',
      confirmText: '📉 즉시 청산(매도)',
      title: isReal ? '🚨 Python 실전 즉시 청산(매도) 확인' : '🧪 가상 보유 종목 매도(청산) 확인',
      message: isReal
        ? `실전 보유 종목을 시장가로 즉시 청산(매도)하시겠습니까?\n\n• 대상 종목: ${posName}\n• 매도 수량: ${posQty}주\n• 실행 엔진: 🐍 Python Core Executor (토스증권 Open API)\n\n'확인 진행'을 누르시면 토스증권 실계좌로 즉시 매도 주문이 집행됩니다.`
        : `가상 보유 종목을 시장가로 매도(청산)하시겠습니까?\n\n• 대상 종목: ${posName}\n• 매도 수량: ${posQty}주\n\n'확인 진행'을 누르시면 가상 계좌로 매도 대금이 환원됩니다.`,
      onConfirm: () => {
        proceedSell();
      },
    });
  };

  const handleAiEvaluateAndTrade = async (executeTrade = false, targetCode = null) => {
    const code = targetCode || selectedStockCode;
    const stockName = CANDIDATE_NAMES[code] || code;
    const isUs = /^[A-Za-z.]+$/.test(code);
    const modeText = selectedBot?.trade_mode === 'REAL' ? '💰 실전매매 (토스 API)' : '🧪 가상매매';

    const proceedAiTrade = async () => {
      setIsAiEvaluating(true);
      try {
        const res = await api.aiEvaluateAndTrade({
          botId: selectedBotId,
          candidateCode: code,
          executeTrade,
        });

        setAiDecisions(res.decisions || []);
        if (executeTrade && res.executedResult) {
          setModalInfo({
            title: 'AI 퀀트 ⨉ Python 주문 실행 완료',
            message: `[${stockName} (${res.executedResult.symbol || code})] 주문이 Python Core Executor를 통해 성공적으로 집행되었습니다.`,
            type: 'success',
          });
          fetchTradesAndPositions();
          fetchSettingsAndBalance();
          fetchBots();
          fetchLeaderboard();
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

    // 파이썬 즉시 매매 실행 시 확인 Alert 모달
    if (executeTrade) {
      setModalInfo({
        type: 'confirm',
        confirmColor: 'success',
        confirmText: '🤖 AI 즉시 매매 집행',
        title: '🚨 Python 즉시 매매 실행 확인',
        message: `AI 실시간 판단 결과에 따라 Python 실행기를 통해 즉시 매매를 집행하시겠습니까?\n\n• 대상 종목: ${stockName} (${code})\n• 거래 시장: ${isUs ? '🇺🇸 미국주식 (토스 소수점/온주)' : '🇰🇷 국내주식 (키움 시세)'}\n• 실행 모드: ${modeText}\n• 실행 엔진: 🐍 Python Core Executor (toss_executor.py)\n\n'확인 진행'을 누르시면 즉시 브로커 주문이 전송됩니다.`,
        onConfirm: () => {
          proceedAiTrade();
        },
      });
      return;
    }

    proceedAiTrade();
  };

  const handleFastReplay = async () => {
    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '⚡ 시뮬레이션 시작',
      title: '⚡ 30영업일 고속 시뮬레이션 실행 확인',
      message: '최근 30영업일 시장 데이터(코스피/코스닥/나스닥)를 기반으로 10대 알고리즘의 성과 백테스팅 및 추천 봇 선별을 진행하시겠습니까?\n\n약 1~2초가 소요됩니다.',
      onConfirm: async () => {
        setIsReplaying(true);
        setReplayResult(null);
        try {
          const res = await api.fastReplay(1000000);
          setReplayResult(res.result);
          fetchLeaderboard();
          setModalInfo({
            title: '고속 시뮬레이션 완료',
            message: '최근 30영업일 시뮬레이션 분석이 완료되었습니다.\n\n아레나 하단의 성과 리포트와 최적 알고리즘 추천 내역을 확인해 주세요.',
            type: 'success',
          });
        } catch (err) {
          setModalInfo({ title: '시뮬레이션 실패', message: err.message, type: 'error' });
        } finally {
          setIsReplaying(false);
        }
      },
    });
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
    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '💾 예산 저장',
      title: '💾 가상 운용 예산 저장 확인',
      message: `가상 매매 총 운용 자본금을 ${Number(budgetSettings.virtualTotalBudget || 10000000).toLocaleString()}원으로 저장하시겠습니까?`,
      onConfirm: async () => {
        const allocations = bots.map((b) => ({
          bot_id: b.bot_id,
          ratio: botRatios[b.bot_id] ?? Math.round((b.allocation_ratio || 0.1) * 100),
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
      },
    });
  };

  const handleSavePurchasePriority = async (newPriority) => {
    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '💾 우선순위 저장',
      title: '🎯 주식 구매 우선순위 저장 확인',
      message: '변경하신 주식 구매 우선순위(1~3순위)를 저장하여 향후 자동/전략 매매에 적용하시겠습니까?',
      onConfirm: async () => {
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
      },
    });
  };

  const handleSaveKeys = async (form, onSuccess) => {
    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '🔑 설정 저장',
      title: '🔑 API 인증키 변경 확인',
      message: '입력하신 신규 증권사 Open API 및 Gemini API 키 설정을 저장하시겠습니까?\n\n기존 설정 파일이 갱신됩니다.',
      onConfirm: async () => {
        try {
          const res = await api.saveSettings({ brokerConfig: form });
          setModalInfo({ title: '키 갱신 완료', message: res.message, type: 'success' });
          if (onSuccess) onSuccess();
          fetchSettingsAndBalance();
        } catch (err) {
          setModalInfo({ title: '오류', message: err.message, type: 'error' });
        }
      },
    });
  };

  const handleExportBackup = () => {
    setModalInfo({
      type: 'confirm',
      confirmColor: 'success',
      confirmText: '📦 백업 다운로드',
      title: '📦 데이터베이스 백업 내보내기',
      message: '현재 SQLite 데이터베이스 및 모든 설정/거래 원장을 백업 파일로 다운로드하시겠습니까?',
      onConfirm: () => {
        window.open('/api/backup/export', '_blank');
        setModalInfo({
          title: '백업 다운로드 시작',
          message: '데이터베이스 백업 파일 생성을 완료했습니다.\n\n브라우저 다운로드 폴더를 확인해 주세요.',
          type: 'info',
        });
      },
    });
  };

  const handleUserRefreshBalance = async () => {
    try {
      await fetchSettingsAndBalance();
      setModalInfo({
        title: '실전 계좌 동기화 완료',
        message: '토스증권 실전 계좌의 실시간 예수금 및 보유 주식 평가 정보가 최신 상태로 갱신되었습니다.',
        type: 'info',
      });
    } catch (err) {
      setModalInfo({ title: '동기화 실패', message: err.message, type: 'error' });
    }
  };

  const handleUserRefreshLeaderboard = async () => {
    try {
      await Promise.all([fetchLeaderboard(), fetchBots()]);
      setModalInfo({
        title: '아레나 리더보드 갱신 완료',
        message: '10대 퀀트 알고리즘의 실시간 누적 수익률, 거래 건수, 손익 지표가 최신 시세 기준으로 갱신되었습니다.',
        type: 'info',
      });
    } catch (err) {
      setModalInfo({ title: '갱신 실패', message: err.message, type: 'error' });
    }
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
            MENU 1: 실전 매매 (선택된 1~3개 실전 봇 전용)
            ======================================================== */}
        {(activeMenu === 'REAL_TRADING' || activeMenu === 'TRADING') && (() => {
          const selectedRealBots = bots.filter((b) => Number(b.is_real_selected) === 1);
          const currentRealBot = selectedRealBots.find((b) => b.bot_id === selectedBotId) || selectedRealBots[0];

          if (selectedRealBots.length === 0) {
            return (
              <div className="board-card" style={{ padding: '40px 24px', textAlign: 'center', borderColor: 'rgba(245, 158, 11, 0.4)', marginTop: '20px' }}>
                <div style={{ fontSize: '42px', marginBottom: '14px' }}>🎯</div>
                <h3 style={{ fontSize: '18px', color: '#f8fafc', marginBottom: '8px' }}>
                  실전 매매를 담당할 퀀트 봇(1~3개)을 먼저 선택해주세요
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '13px', maxWidth: '580px', margin: '0 auto 22px auto', lineHeight: 1.6 }}>
                  10대 퀀트 알고리즘이 24시간 가상 경쟁 아레나에서 상시 모의 거래를 수행하고 있습니다.<br />
                  <strong>[⚡ 가상 경쟁 아레나]</strong> 탭에서 실시간 누적 수익률을 확인하신 후, 실전을 담당할 1~3개의 봇을 체크하여 확정해주세요.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 700 }}
                    onClick={() => setActiveMenu('VIRTUAL_ARENA')}
                  >
                    ⚡ 가상 경쟁 아레나로 이동하여 실전 봇 선택하기
                  </button>
                  {bots.length >= 3 && (
                    <button
                      className="btn-action success"
                      style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 700 }}
                      onClick={() => handleSelectRealBots([bots[0].bot_id, bots[1].bot_id, bots[2].bot_id])}
                    >
                      👑 상위 3개 봇으로 자동 지정하기
                    </button>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div>
              {/* Top Market AI Streaming Marquee Box */}
              <MarketBanner
                aiBriefingText={aiBriefingText}
                isBriefingStreaming={isBriefingStreaming}
                onStartBriefing={handleStartBriefing}
              />

              {/* Account Assets Summary Bar */}
              <BudgetBar
                tradingModeFilter="REAL"
                setTradingModeFilter={() => {}}
                activeTradeMode="REAL"
                selectedBot={currentRealBot}
                accountBalance={accountBalance}
                onRefreshBalance={handleUserRefreshBalance}
              />

              {/* Real Bot Tabs & Action Controls & Metrics */}
              <BotCard
                bots={selectedRealBots}
                selectedBotId={currentRealBot?.bot_id}
                setSelectedBotId={setSelectedBotId}
                selectedBot={currentRealBot}
                onBotAction={handleBotAction}
                onRealToggle={handleRealToggle}
                positionsCount={
                  positions.filter(
                    (p) =>
                      p.bot_id === currentRealBot?.bot_id &&
                      p.trade_mode === 'REAL'
                  ).length
                }
                activeTradeMode="REAL"
              />

              {/* Hybrid Architecture Board (AI LLM Decisions & Python Executor) */}
              <HybridBoard
                aiDecisions={aiDecisions}
                isAiEvaluating={isAiEvaluating}
                onAiEvaluateAndTrade={handleAiEvaluateAndTrade}
              />

              {/* Active Real Positions Table */}
              <PositionsTable
                positions={positions.filter((p) => p.trade_mode === 'REAL')}
                onSellPosition={handleSellPosition}
                activeTradeMode="REAL"
              />

              {/* Closed Real Trades History Table */}
              <TradesTable
                trades={trades.filter((t) => t.trade_mode === 'REAL')}
                activeTradeMode="REAL"
              />
            </div>
          );
        })()}

        {/* ========================================================
            MENU 2: 가상 경쟁 아레나 (10대 봇 상시 거래 및 랭킹)
            ======================================================== */}
        {(activeMenu === 'VIRTUAL_ARENA' || activeMenu === 'LAB') && (
          <LabPanel
            bots={bots}
            selectedIds={arenaSelectedIds}
            setSelectedIds={setArenaSelectedIds}
            isSelecting={isSelectingRealBots}
            virtualPositions={positions.filter((p) => p.trade_mode === 'VIRTUAL')}
            virtualTrades={trades.filter((t) => t.trade_mode === 'VIRTUAL')}
            onSelectRealBots={handleSelectRealBots}
            onFastReplay={handleFastReplay}
            onResetVirtualAll={handleResetVirtualAll}
            isReplaying={isReplaying}
            replayResult={replayResult}
            onRefreshLeaderboard={handleUserRefreshLeaderboard}
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
                await fetchNews(1);
                setModalInfo({
                  title: '증시 뉴스 최신화 완료',
                  message: '국내외 주요 언론사의 실시간 증시 뉴스 및 공시 피드를 성공적으로 새로고침했습니다.',
                  type: 'info',
                });
              } catch (err) {
                setModalInfo({ title: '뉴스 갱신 실패', message: err.message, type: 'error' });
              }
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
            onSaveRealAllocation={handleSaveRealAllocation}
            onSaveKeys={handleSaveKeys}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onGoToArena={() => setActiveMenu('VIRTUAL_ARENA')}
          />
        )}
      </main>

      {/* Modal Dialog */}
      <Modal modalInfo={modalInfo} onClose={() => setModalInfo(null)} />
    </div>
  );
}
