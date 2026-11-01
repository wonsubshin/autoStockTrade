const API_BASE = ''; // Proxied by Vite or relative URL

async function request(url, options = {}) {
  const resp = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.message || `요청 실패 (${resp.status})`);
    }
    return data;
  }

  if (!resp.ok) {
    throw new Error(`요청 실패 (${resp.status})`);
  }
  return resp;
}

export const api = {
  // Auth
  verifyGate: (passcode) =>
    request('/api/auth/gate', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),

  // Health & System
  getHealth: () => request('/api/health'),
  getSettings: () => request('/api/system/settings'),
  saveSettings: (payload) =>
    request('/api/system/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Budget
  getBudgetSettings: () => request('/api/budget/settings'),
  saveBudgetSettings: (payload) =>
    request('/api/budget/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveRealAllocation: (realTotalBudget, allocations) =>
    request('/api/budget/real-allocation', {
      method: 'POST',
      body: JSON.stringify({ realTotalBudget, allocations }),
    }),

  // Bots
  getBots: () => request('/api/bots'),
  selectRealBots: (selectedBotIds) =>
    request('/api/bots/select-real', {
      method: 'POST',
      body: JSON.stringify({ selectedBotIds }),
    }),
  realToggleBot: (botId, is_real_running) =>
    request(`/api/bots/${botId}/real-toggle`, {
      method: 'POST',
      body: JSON.stringify({ is_real_running }),
    }),
  botAction: (botId, action, extra = {}) =>
    request(`/api/bots/${botId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    }),
  botVirtualTrade: (botId, { side, stockCode, positionId }) =>
    request(`/api/bots/${botId}/virtual-trade`, {
      method: 'POST',
      body: JSON.stringify({ side, stockCode, positionId }),
    }),
  botUpdate: (botId, payload) =>
    request(`/api/bots/${botId}/update`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  botPromote: (botId) =>
    request(`/api/bots/${botId}/promote`, {
      method: 'POST',
    }),
  resetVirtualAll: (seedCapital = 1000000) =>
    request('/api/bots/reset-virtual-all', {
      method: 'POST',
      body: JSON.stringify({ action: 'RESET_VIRTUAL_ALL', seedCapital }),
    }),

  // Trades & Positions
  getTrades: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/trades${query ? `?${query}` : ''}`);
  },
  getPositions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/positions${query ? `?${query}` : ''}`);
  },

  // Lab & Stats
  getLeaderboard: () => request('/api/performance/leaderboard'),
  fastReplay: (seedCapital) =>
    request('/api/performance/fast-replay', {
      method: 'POST',
      body: JSON.stringify({ seedCapital }),
    }),
  getStats: (mode = 'ALL', period = 'daily') =>
    request(`/api/stats?mode=${mode}&period=${period}`),

  // Market & Account
  getCandidates: () => request('/api/stocks/candidates'),
  getAccountBalance: () => request('/api/account/balance'),

  // AI & LLM
  getAiDecisions: (limit = 15) => request(`/api/ai/decisions?limit=${limit}`),
  aiEvaluateAndTrade: ({ botId, candidateCode, executeTrade }) =>
    request('/api/ai/evaluate-and-trade', {
      method: 'POST',
      body: JSON.stringify({ botId, candidateCode, executeTrade }),
    }),

  // News
  getNews: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/news${query ? `?${query}` : ''}`);
  },
  refreshNews: () =>
    request('/api/news/refresh', {
      method: 'POST',
    }),

  // SSE Streams
  createBriefingStream: () => new EventSource(`${API_BASE}/api/ai/stream-briefing`),
  createNewsStream: () => new EventSource(`${API_BASE}/api/ai/stream-news-analyze`),
};

