import React, { useState, useEffect } from 'react';

export default function SettingsModal({
  isOpen,
  onClose,
  budgetSettings,
  onSaveBudget,
  brokerConfig,
  onSaveKeys,
}) {
  if (!isOpen) return null;

  // Local Budget Form State
  const [virtualBudget, setVirtualBudget] = useState(budgetSettings.virtualTotalBudget || 30000000);
  const [realBudget, setRealBudget] = useState(budgetSettings.realTotalBudget || 10000000);
  const [botAllocations, setBotAllocations] = useState([]);

  // Local Broker Keys Form State
  const [showKeyInputs, setShowKeyInputs] = useState(false);
  const [keysForm, setKeysForm] = useState({
    account_mode: brokerConfig.account_mode || 'VIRTUAL',
    kiwoom_app_key: '',
    kiwoom_app_secret: '',
    toss_api_key: '',
    toss_api_secret: '',
    toss_account_no: '',
    gemini_api_key: '',
  });

  const tossMaxCash = budgetSettings.tossAvailableCash || 0;

  useEffect(() => {
    setVirtualBudget(budgetSettings.virtualTotalBudget || 30000000);
    setRealBudget(budgetSettings.realTotalBudget || 10000000);

    if (budgetSettings.bots) {
      setBotAllocations(
        budgetSettings.bots.map((b) => ({
          bot_id: b.bot_id,
          name: b.nickname || b.name,
          ratio: Math.round((b.allocation_ratio || 0.33) * 100),
        }))
      );
    }
  }, [budgetSettings]);

  const handleRatioChange = (botId, newRatio) => {
    setBotAllocations((prev) =>
      prev.map((b) => (b.bot_id === botId ? { ...b, ratio: Number(newRatio) } : b))
    );
  };

  const handleSaveBudgetSubmit = (e) => {
    e.preventDefault();
    if (realBudget > tossMaxCash) {
      alert(`실제 사용 예산(${realBudget.toLocaleString()}원)은 현재 토스증권 주문 가능 예수금(${tossMaxCash.toLocaleString()}원)을 초과할 수 없습니다.`);
      return;
    }

    onSaveBudget({
      virtualTotalBudget: virtualBudget,
      realTotalBudget: realBudget,
      botAllocations,
    });
  };

  const handleSaveKeysSubmit = (e) => {
    e.preventDefault();
    onSaveKeys(keysForm);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-6 my-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-xl">⚙️</span>
            <h3 className="text-lg font-bold text-white">시스템 설정 & 예산 배분 관리</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg p-1 transition">
            ✕
          </button>
        </div>

        {/* 1. Budget & Bot Allocation Section */}
        <form onSubmit={handleSaveBudgetSubmit} className="space-y-4">
          <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <span>💵</span>
            <span>예산 설정 및 봇별 배분율 (위험 관리 한도)</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                가상 시뮬레이션 총 예산 (원)
              </label>
              <input
                type="number"
                value={virtualBudget}
                onChange={(e) => setVirtualBudget(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm"
                step="1000000"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                실전 매매 총 예산 (원)
              </label>
              <input
                type="number"
                value={realBudget}
                onChange={(e) => setRealBudget(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm"
                step="100000"
              />
              <div className="text-[11px] text-amber-400 mt-1">
                토스 주문가능 예수금: {tossMaxCash.toLocaleString()}원 (초과 설정 불가)
              </div>
            </div>
          </div>

          {/* Bot Allocation Sliders */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">각 봇별 배분 비율 (%)</span>
              <span className={`font-bold ${
                botAllocations.reduce((sum, b) => sum + b.ratio, 0) === 100 ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                합계: {botAllocations.reduce((sum, b) => sum + b.ratio, 0)}%
              </span>
            </div>

            <div className="space-y-3">
              {botAllocations.map((bot) => (
                <div key={bot.bot_id} className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>{bot.name}</span>
                    <span className="font-bold">{bot.ratio}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={bot.ratio}
                    onChange={(e) => handleRatioChange(bot.bot_id, e.target.value)}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition"
            >
              예산/배분율 저장
            </button>
          </div>
        </form>

        <hr className="border-slate-800" />

        {/* 2. Broker Keys & Security Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
              <span>🔐</span>
              <span>증권사 API 키 관리 (마스킹 보호)</span>
            </h4>
            <button
              onClick={() => setShowKeyInputs(!showKeyInputs)}
              className="text-xs text-blue-400 hover:underline font-semibold"
            >
              {showKeyInputs ? '키 입력창 닫기' : '신규 키 등록/수정'}
            </button>
          </div>

          {/* Current Keys Status */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-slate-400 block text-[10px]">키움증권 키</span>
              <span className={`font-bold ${brokerConfig.has_kiwoom_keys ? 'text-emerald-400' : 'text-slate-500'}`}>
                {brokerConfig.has_kiwoom_keys ? '● 등록 완료' : '○ 미등록'}
              </span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-slate-400 block text-[10px]">토스증권 키</span>
              <span className={`font-bold ${brokerConfig.has_toss_keys ? 'text-emerald-400' : 'text-slate-500'}`}>
                {brokerConfig.has_toss_keys ? '● 등록 완료' : '○ 미등록'}
              </span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-slate-400 block text-[10px]">Gemini AI 키</span>
              <span className={`font-bold ${brokerConfig.has_gemini_key ? 'text-emerald-400' : 'text-slate-500'}`}>
                {brokerConfig.has_gemini_key ? '● 등록 완료' : '○ 미등록'}
              </span>
            </div>
          </div>

          {showKeyInputs && (
            <form onSubmit={handleSaveKeysSubmit} className="space-y-3 p-4 bg-slate-950 rounded-xl border border-slate-800 mt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">키움 App Key</label>
                  <input
                    type="password"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.kiwoom_app_key}
                    onChange={(e) => setKeysForm({ ...keysForm, kiwoom_app_key: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">키움 App Secret</label>
                  <input
                    type="password"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.kiwoom_app_secret}
                    onChange={(e) => setKeysForm({ ...keysForm, kiwoom_app_secret: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">토스 API Key</label>
                  <input
                    type="password"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.toss_api_key}
                    onChange={(e) => setKeysForm({ ...keysForm, toss_api_key: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">토스 API Secret</label>
                  <input
                    type="password"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.toss_api_secret}
                    onChange={(e) => setKeysForm({ ...keysForm, toss_api_secret: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">토스 계좌번호</label>
                  <input
                    type="text"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.toss_account_no}
                    onChange={(e) => setKeysForm({ ...keysForm, toss_account_no: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Gemini API Key</label>
                  <input
                    type="password"
                    placeholder="신규 입력 시 갱신"
                    value={keysForm.gemini_api_key}
                    onChange={(e) => setKeysForm({ ...keysForm, gemini_api_key: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition"
                >
                  보안 키 저장
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
