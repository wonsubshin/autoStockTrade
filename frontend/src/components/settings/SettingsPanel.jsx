import React, { useState } from 'react';
import { StrategyFamilyBadge } from '../../utils/strategyFamilies';

export default function SettingsPanel({
  appVersion,
  accountBalance,
  budgetSettings,
  setBudgetSettings,
  botRatios,
  setBotRatios,
  bots = [],
  brokerConfig,
  purchasePriority,
  setPurchasePriority,
  gatePasscode = 'sws@2129',
  tunnelUrl,
  onSavePasscode,
  onSavePriority,
  onSaveBudget,
  onSaveRealAllocation,
  onSaveBotConfig,
  onResetBotConfig,
  onSaveKeys,
  onExportBackup,
  onImportBackup,
  onGoToArena,
}) {
  const [showNewKeyInputs, setShowNewKeyInputs] = useState(false);
  const [newPasscode, setNewPasscode] = useState(gatePasscode || 'sws@2129');

  React.useEffect(() => {
    if (gatePasscode) {
      setNewPasscode(gatePasscode);
    }
  }, [gatePasscode]);
  const selectedRealBots = bots.filter((b) => Number(b.is_real_selected) === 1);
  const [realTotalBudget, setRealTotalBudget] = useState(budgetSettings?.realTotalBudget || 10000000);
  const [allocations, setAllocations] = useState(() => {
    if (selectedRealBots.length > 0) {
      return selectedRealBots.map((b) => ({
        bot_id: b.bot_id,
        name: b.name,
        nickname: b.nickname,
        ratio: Number(b.real_allocation_ratio || (100 / selectedRealBots.length).toFixed(1)),
      }));
    }
    return [];
  });

  React.useEffect(() => {
    if (budgetSettings?.realTotalBudget) {
      setRealTotalBudget(budgetSettings.realTotalBudget);
    }
  }, [budgetSettings?.realTotalBudget]);

  const selectedBotIdsKey = selectedRealBots.map((b) => b.bot_id).sort().join(',');
  const prevBotIdsKeyRef = React.useRef(selectedBotIdsKey);

  React.useEffect(() => {
    if (selectedRealBots.length > 0) {
      if (allocations.length === 0 || prevBotIdsKeyRef.current !== selectedBotIdsKey) {
        prevBotIdsKeyRef.current = selectedBotIdsKey;
        const count = selectedRealBots.length;
        const base = Math.floor(100 / count);
        let rem = 100;
        const initialRatios = selectedRealBots.map((b, idx) => {
          const defaultRatio = idx === count - 1 ? rem : base;
          rem -= base;
          const userRatio = Math.round(Number(b.real_allocation_ratio));
          return userRatio > 0 ? userRatio : defaultRatio;
        });

        const curSum = initialRatios.reduce((s, r) => s + r, 0);
        if (curSum !== 100 && initialRatios.length > 0) {
          initialRatios[initialRatios.length - 1] += (100 - curSum);
        }

        setAllocations(
          selectedRealBots.map((b, idx) => ({
            bot_id: b.bot_id,
            name: b.name,
            nickname: b.nickname,
            ratio: initialRatios[idx],
          }))
        );
      }
    }
  }, [selectedBotIdsKey, selectedRealBots, allocations.length]);

  const handleRatioChange = (targetBotId, val) => {
    const rawVal = parseFloat(val);
    const targetVal = isNaN(rawVal) ? 0 : Math.max(0, Math.min(100, Math.round(rawVal)));

    if (allocations.length <= 1) {
      setAllocations(allocations.map((a) => ({ ...a, ratio: 100 })));
      return;
    }

    if (allocations.length === 2) {
      setAllocations(
        allocations.map((a) =>
          a.bot_id === targetBotId
            ? { ...a, ratio: targetVal }
            : { ...a, ratio: 100 - targetVal }
        )
      );
      return;
    }

    // 3개 봇 대상: 조작하지 않은 나머지 두 봇의 비율을 자동 조절하여 항상 합계 100% 엄격 유지
    const otherBots = allocations.filter((a) => a.bot_id !== targetBotId);
    const remaining = 100 - targetVal;
    const otherSum = otherBots.reduce((sum, b) => sum + (Number(b.ratio) || 0), 0);

    let updatedOthers;
    if (otherSum <= 0) {
      const split = Math.floor(remaining / otherBots.length);
      let remAcc = remaining;
      updatedOthers = otherBots.map((b, idx) => {
        const r = idx === otherBots.length - 1 ? remAcc : split;
        remAcc -= r;
        return { ...b, ratio: Math.max(0, r) };
      });
    } else {
      let remAcc = remaining;
      updatedOthers = otherBots.map((b, idx) => {
        if (idx === otherBots.length - 1) {
          return { ...b, ratio: Math.max(0, remAcc) };
        }
        const weight = (Number(b.ratio) || 0) / otherSum;
        const r = Math.max(0, Math.min(remAcc, Math.round(remaining * weight)));
        remAcc -= r;
        return { ...b, ratio: r };
      });
    }

    setAllocations(
      allocations.map((a) => {
        if (a.bot_id === targetBotId) {
          return { ...a, ratio: targetVal };
        }
        const found = updatedOthers.find((o) => o.bot_id === a.bot_id);
        return found ? found : a;
      })
    );
  };

  const handleEqualSplit = () => {
    const n = allocations.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    let rem = 100;
    setAllocations(
      allocations.map((a, idx) => {
        const r = idx === n - 1 ? rem : base;
        rem -= base;
        return { ...a, ratio: r };
      })
    );
  };

  const totalAllocRatio = allocations.reduce((s, a) => s + Number(a.ratio || 0), 0);
  const isAllocValid = totalAllocRatio === 100 || Math.abs(totalAllocRatio - 100) <= 0.5;
  const [localPriority, setLocalPriority] = useState(
    purchasePriority && purchasePriority.length === 3
      ? purchasePriority
      : ['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']
  );

  React.useEffect(() => {
    if (purchasePriority && purchasePriority.length === 3) {
      setLocalPriority(purchasePriority);
    }
  }, [purchasePriority]);

  const movePriority = (index, direction) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= localPriority.length) return;
    const nextList = [...localPriority];
    const temp = nextList[index];
    nextList[index] = nextList[targetIdx];
    nextList[targetIdx] = temp;
    setLocalPriority(nextList);
  };

  const resetPriorityToDefault = () => {
    setLocalPriority(['KR_UNIT', 'US_UNIT', 'US_FRACTIONAL']);
  };

  const PRIORITY_META = {
    KR_UNIT: {
      title: '국내 주식 1주 구매 (온주)',
      desc: '키움증권 호가 기반 삼성전자, SK하이닉스 등 KRX 대표 우량주 1주 정수 단위 매수',
      icon: '🇰🇷',
    },
    US_UNIT: {
      title: '미국 주식 1주 구매 (온주)',
      desc: '토스증권 실시간 시세 기반 애플, 엔비디아, 테슬라 등 1주 정수 단위 매수',
      icon: '🇺🇸',
    },
    US_FRACTIONAL: {
      title: '미국 주식 소수점 구매 (금액 단위)',
      desc: '토스증권 공식 소수점 매매(orderAmount)를 통해 소액($10 / 약 1.3만원) 분할 적립 매수',
      icon: '🪙',
    },
  };
  const [newBrokerConfig, setNewBrokerConfig] = useState({
    account_mode: 'VIRTUAL',
    kiwoom_app_key: '',
    kiwoom_app_secret: '',
    toss_api_key: '',
    toss_api_secret: '',
    toss_account_no: '',
    gemini_api_key: '',
  });

  const tossAvailableKrw = accountBalance?.real?.availableCash ?? accountBalance?.availableCash ?? budgetSettings.tossAvailableCash ?? 0;
  const tossAvailableUsd = Number(accountBalance?.real?.availableUsd ?? accountBalance?.availableUsd ?? budgetSettings.tossAvailableUsd ?? 0);
  const tossAvailable = accountBalance?.real?.totalCashKrw ?? accountBalance?.totalCashKrw ?? budgetSettings.tossTotalCashKrw ?? tossAvailableKrw;

  return (
    <div>
      {/* 1. Broker Account Assets Status Card */}
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">💼 토스증권 실전 계좌 잔고 & 예수금 현황 (실시간 연동)</div>
          <span className="badge-mode real">토스증권 공식 Open API 연동</span>
        </div>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">주문 가능 예수금 (원화 / 달러)</div>
            <div className="metric-value">
              {tossAvailableKrw.toLocaleString()}원
              <span style={{ fontSize: '12px', color: '#10b981', marginLeft: '6px', fontWeight: 700 }}>
                · ${tossAvailableUsd.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              통합 환산: 약 {tossAvailable.toLocaleString()}원
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-title">주식 매입/평가 금액</div>
            <div className="metric-value">{(accountBalance?.real?.stockEvalAmount ?? accountBalance?.stockEvalAmount ?? 0).toLocaleString()}원</div>
          </div>
          <div className="metric-card">
            <div className="metric-title">총 평가 자산</div>
            <div className="metric-value">{(accountBalance?.real?.totalAssetAmount ?? accountBalance?.totalAssetAmount ?? 0).toLocaleString()}원</div>
          </div>
          <div className="metric-card">
            <div className="metric-title">평가 손익률</div>
            <div className={`metric-value ${(accountBalance?.real?.profitRate ?? accountBalance?.profitRate ?? 0) >= 0 ? 'up' : 'down'}`}>
              {(accountBalance?.real?.profitRate ?? accountBalance?.profitRate ?? 0) >= 0 ? '+' : ''}
              {accountBalance?.real?.profitRate ?? accountBalance?.profitRate ?? 0}%
            </div>
          </div>
        </div>
      </div>

      {/* 2. Dynamic Real Budget Allocation for Selected 1~3 Bots */}
      <div className="board-card" style={{ borderColor: 'rgba(59, 130, 246, 0.4)', marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🎯 선택된 실전 담당 봇 ({allocations.length || 3}개) 동적 투자금 비율 설정</div>
          <span className="badge-mode real">
            실전 배분 엔진
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px', lineHeight: 1.5 }}>
          가상 아레나에서 선발된 <strong>1~3개의 실전 담당 봇</strong>의 투자금 비율(합계 100%)을 설정합니다. 하단의 <strong>[확인 및 실전 매매 적용]</strong>을 누르면 설정이 저장되고 즉시 <strong>실전 매매 화면으로 이동</strong>하여 매매에 적용됩니다.
        </p>

        {allocations.length === 0 ? (
          <div style={{ padding: '20px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#fca5a5', fontSize: '13px' }}>
            <div style={{ marginBottom: '12px' }}>
              ⚠️ 현재 선택된 실전 담당 봇이 없습니다. 상단 메뉴의 <strong>[⚡ 가상 경쟁 아레나]</strong>에서 실전을 담당할 1~3개의 봇을 먼저 체크 후 확정해주세요.
            </div>
            {onGoToArena && (
              <button
                type="button"
                className="btn-action success"
                style={{ fontWeight: 700, padding: '7px 16px' }}
                onClick={onGoToArena}
              >
                ⚡ 가상 경쟁 아레나로 이동하여 실전 봇 선택하기
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Real Total Budget Setup - 토스 주문가능 예수금 90% 자동 계산 */}
            {(() => {
              const dynamicOperatingBudget = Math.floor(tossAvailable * 0.90);
              const effectiveBudget = dynamicOperatingBudget > 0 ? dynamicOperatingBudget : (realTotalBudget || 10000000);

              return (
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>🚨 총 실전 투자 예산 (운영원금)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#34d399', fontWeight: 600 }}>
                        토스 통합 주문가능 예수금: {tossAvailable.toLocaleString()}원 ({tossAvailableKrw.toLocaleString()}원 + ${tossAvailableUsd.toFixed(2)})
                      </span>
                      <button
                        type="button"
                        className="btn-action"
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={handleEqualSplit}
                      >
                        ⚖️ 균등 배분 ({allocations.length}등분)
                      </button>
                    </div>
                  </div>

                  {/* 자동 계산된 운영원금 카드 */}
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      borderRadius: '8px',
                      padding: '14px 18px',
                      marginBottom: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>토스증권 통합 예수금(원화+달러) 기반 자동 운영원금 (90%)</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginTop: '2px' }}>
                          {effectiveBudget.toLocaleString()}원
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '3px 9px',
                          borderRadius: '4px',
                          background: 'rgba(56, 189, 248, 0.2)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.45)',
                          fontWeight: 600,
                        }}
                      >
                        ⚡ 예수금 90% 자동 연동
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '8px', lineHeight: 1.5 }}>
                      💡 총 실전 투자 예산은 사용자가 수동 입력하지 않고, 실제 토스증권 계좌의 통합 주문가능 예수금({tossAvailable.toLocaleString()}원 = 원화 {tossAvailableKrw.toLocaleString()}원 + 달러 ${tossAvailableUsd.toFixed(2)})의 <strong>90%({effectiveBudget.toLocaleString()}원)</strong>를 운영원금으로 자동 계산합니다. 아래 슬라이더에서 각 봇의 비율(%)을 조절하면 이 금액이 비율대로 실시간 분배됩니다.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Dynamic Allocation List */}
            {(() => {
              const dynamicOperatingBudget = Math.floor(tossAvailable * 0.90);
              const effectiveBudget = dynamicOperatingBudget > 0 ? dynamicOperatingBudget : (realTotalBudget || 10000000);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
                  {allocations.map((item) => {
                    const allocatedKrw = Math.floor(effectiveBudget * (item.ratio / 100));
                    const fullBot = bots.find((b) => b.bot_id === item.bot_id) || item;
                    return (
                      <div
                        key={item.bot_id}
                        style={{
                          padding: '14px 18px',
                          background: 'rgba(0, 0, 0, 0.3)',
                          border: '1px solid rgba(59, 130, 246, 0.25)',
                          borderRadius: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '14px', color: '#f8fafc' }}>{item.name}</strong>
                            <span style={{ color: '#818cf8', fontSize: '12px' }}>({item.nickname})</span>
                            <StrategyFamilyBadge bot={fullBot} showCode />
                          </div>
                          <span className="badge-mode real" style={{ fontSize: '12px', padding: '3px 8px' }}>
                            실전 배정금: <strong>{allocatedKrw.toLocaleString()}원</strong> ({item.ratio}%)
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            style={{ flex: 1, accentColor: '#3b82f6' }}
                            value={item.ratio}
                            onChange={(e) => handleRatioChange(item.bot_id, e.target.value)}
                          />
                          <div style={{ width: '75px', display: 'flex', alignItems: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              className="input-field"
                              style={{ padding: '5px 8px', fontSize: '13px', textAlign: 'center' }}
                              value={item.ratio}
                              onChange={(e) => handleRatioChange(item.bot_id, e.target.value)}
                            />
                            <span style={{ fontSize: '13px', color: '#cbd5e1', marginLeft: '4px' }}>%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Ratio Validation & Save Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <span className={isAllocValid ? 'num-up' : 'num-down'} style={{ fontWeight: 700, fontSize: '13px' }}>
                비율 합계: <strong>{totalAllocRatio}%</strong> / 100% {isAllocValid ? '✓ (자동 100% 균형 유지)' : '(비율 조정 필요)'}
              </span>
              <button
                className="btn-primary"
                disabled={!isAllocValid}
                onClick={() => {
                  const dynamicOperatingBudget = Math.floor(tossAvailable * 0.90);
                  const effectiveBudget = dynamicOperatingBudget > 0 ? dynamicOperatingBudget : (realTotalBudget || 10000000);
                  if (onSaveRealAllocation) onSaveRealAllocation(effectiveBudget, allocations);
                }}
              >
                💾 실전 투자금 비율 저장 및 실전 매매 적용 (확인)
              </button>
            </div>
          </>
        )}
      </div>

      {/* 2-0. 11대 퀀트 봇 알고리즘 파라미터 정밀 튜닝 */}
      <BotStrategyTunerSection
        bots={bots}
        onSaveBotConfig={onSaveBotConfig}
        onResetBotConfig={onResetBotConfig}
      />

      {/* 2-1. Virtual Budget Configuration */}
      <div className="board-card" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🧪 가상 매매 총 운용 예산 설정 ({bots?.length || 11}대 퀀트 봇 아레나)</div>
          <span className="badge-mode virtual">가상 아레나</span>
        </div>
        <div className="form-group">
          <label className="form-label">가상 매매 총 운용 자본금 (KRW)</label>
          <input
            type="number"
            className="input-field"
            value={budgetSettings.virtualTotalBudget}
            onChange={(e) => setBudgetSettings({ ...budgetSettings, virtualTotalBudget: parseInt(e.target.value, 10) || 0 })}
          />
          <div className="budget-quick-btns">
            <button type="button" className="budget-quick-btn" onClick={() => setBudgetSettings({ ...budgetSettings, virtualTotalBudget: 10000000 })}>1천만</button>
            <button type="button" className="budget-quick-btn" onClick={() => setBudgetSettings({ ...budgetSettings, virtualTotalBudget: 30000000 })}>3천만</button>
            <button type="button" className="budget-quick-btn" onClick={() => setBudgetSettings({ ...budgetSettings, virtualTotalBudget: 50000000 })}>5천만</button>
            <button type="button" className="budget-quick-btn" onClick={() => setBudgetSettings({ ...budgetSettings, virtualTotalBudget: 100000000 })}>1억</button>
          </div>
        </div>
        <button
          className="btn-action success"
          style={{ marginTop: '14px' }}
          onClick={onSaveBudget}
        >
          💾 가상 예산 저장
        </button>
      </div>

      {/* 2-1. Purchase Priority Configuration Card */}
      <div className="board-card" style={{ borderColor: 'rgba(168, 85, 247, 0.4)', marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🎯 주식 구매 우선순위 설정 (자동 & 전략 매매)</div>
          <span className="badge-mode" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.35)' }}>
            매수 체결 알고리즘
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
          매수 발생 시 아래의 <strong>우선순위(1순위 ➔ 2순위 ➔ 3순위)</strong>에 따라 잔여 가용 예산을 확인하고 순차적으로 매수를 집행합니다.<br />
          예를 들어 1순위(국내 1주) 매수 예산이 부족하거나 조건 미충족 시 다음 순위(미국 1주 ➔ 미국 소수점)로 자동 전환됩니다.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
          {localPriority.map((key, idx) => {
            const meta = PRIORITY_META[key] || { title: key, desc: '', icon: '📌' };
            const rankColor = idx === 0 ? '#10b981' : idx === 1 ? '#3b82f6' : '#a855f7';
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  backgroundColor: 'rgba(0, 0, 0, 0.35)',
                  border: `1px solid ${idx === 0 ? 'rgba(16, 185, 129, 0.4)' : idx === 1 ? 'rgba(59, 130, 246, 0.4)' : 'rgba(168, 85, 247, 0.4)'}`,
                  borderRadius: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: rankColor,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '14px',
                      boxShadow: `0 0 10px ${rankColor}44`,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14.5px', color: '#f8fafc' }}>
                        {meta.icon} {meta.title}
                      </span>
                      <span
                        style={{
                          fontSize: '10.5px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: `${rankColor}22`,
                          color: rankColor,
                          border: `1px solid ${rankColor}44`,
                          fontWeight: 600,
                        }}
                      >
                        {idx + 1}순위
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
                      {meta.desc}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn-action"
                    disabled={idx === 0}
                    style={{ padding: '6px 12px', fontSize: '11.5px', opacity: idx === 0 ? 0.35 : 1 }}
                    onClick={() => movePriority(idx, -1)}
                  >
                    ▲ 위로
                  </button>
                  <button
                    type="button"
                    className="btn-action"
                    disabled={idx === localPriority.length - 1}
                    style={{ padding: '6px 12px', fontSize: '11.5px', opacity: idx === localPriority.length - 1 ? 0.35 : 1 }}
                    onClick={() => movePriority(idx, 1)}
                  >
                    ▼ 아래로
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, minWidth: '180px' }}
            onClick={() => onSavePriority && onSavePriority(localPriority)}
          >
            💾 구매 우선순위 설정 저장
          </button>
          <button
            type="button"
            className="btn-action"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={resetPriorityToDefault}
          >
            🔄 기본 순위로 복원 (1.국내1주 ➔ 2.미국1주 ➔ 3.미국소수점)
          </button>
        </div>
      </div>

      {/* Security Gate Passcode Configuration */}
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🔑 시스템 보안 입장 코드 (Gate Passcode) 설정</div>
          <span className="badge-mode real" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.35)' }}>
            접속 인증 보안
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px', lineHeight: 1.5 }}>
          웹 브라우저 접속 시 인증에 사용되는 보안 입장 코드(Passcode)를 설정합니다. 기본값은 <code>sws@2129</code>이며, 언제든지 원하는 코드로 안전하게 변경하실 수 있습니다.
        </p>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: '640px' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
              새로운 입장 코드 입력
            </label>
            <input
              type="text"
              className="input-field"
              style={{ width: '100%', padding: '10px 14px', fontSize: '14px', fontFamily: 'monospace' }}
              value={newPasscode}
              onChange={(e) => setNewPasscode(e.target.value)}
              placeholder="변경할 입장 코드 (기본: sws@2129)"
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 700 }}
            onClick={() => onSavePasscode && onSavePasscode(newPasscode)}
          >
            💾 입장 코드 변경 저장
          </button>
          <button
            type="button"
            className="btn-action"
            style={{ padding: '10px 14px', fontSize: '12px' }}
            onClick={() => setNewPasscode('sws@2129')}
          >
            기본값(sws@2129)으로 재설정
          </button>
        </div>

        <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#94a3b8' }}>
          💡 현재 등록된 입장 코드: <strong style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '13.5px' }}>{gatePasscode || 'sws@2129'}</strong>
        </div>
      </div>

      {/* 3. Broker API Keys Security (Hidden & Masked Protected View) */}
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🔒 키움증권(시세) ⨉ 토스증권(매매) ⨉ Gemini API 보안 보호</div>
          <span className="badge-mode" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.35)' }}>
            안전 마스킹 암호화 보관
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px', lineHeight: 1.5 }}>
          보안 강화를 위해 증권사 및 AI 연동 API Key는 설정 화면에서 평문으로 노출되지 않으며, 암호화 마스킹 보호 상태로 관리됩니다.
        </p>

        {/* Security Status Cards */}
        <div className="security-card-grid">
          {/* Kiwoom Card */}
          <div className="security-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, color: '#60a5fa', fontSize: '14px' }}>🔍 키움증권 Open API (시세/호가)</span>
              <span className="security-status-badge ok">✅ 키 등록 완료</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
              • App Key: <span className="masked-value">••••••••••••••••</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              • Secret Key: <span className="masked-value">••••••••••••••••</span>
            </div>
          </div>

          {/* Toss Card */}
          <div className="security-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, color: '#34d399', fontSize: '14px' }}>⚡ 토스증권 Open API (주문/잔고)</span>
              <span className="security-status-badge ok">✅ 실계좌 연동 완료</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              • API Key: <span className="masked-value">••••••••••••••••</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              • Secret Key: <span className="masked-value">••••••••••••••••</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              • 연동 계좌: <span className="masked-value">••••••••</span>
            </div>
          </div>

          {/* Gemini Card */}
          <div className="security-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, color: '#c084fc', fontSize: '14px' }}>🤖 Google Gemini AI (시황 인텔리전스)</span>
              <span className="security-status-badge ok">✅ API 연동 완료</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
              • Gemini Key: <span className="masked-value">••••••••••••••••</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              • Model: <span>gemini-2.5-flash</span>
            </div>
          </div>
        </div>

        {/* Change Keys Toggle Button */}
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn-action"
            style={{ fontSize: '12px' }}
            onClick={() => setShowNewKeyInputs(!showNewKeyInputs)}
          >
            {showNewKeyInputs ? '▲ 새로운 API 키 입력창 닫기' : '🔑 새로운 증권사 / AI 키로 변경하기'}
          </button>
        </div>

        {/* New Keys Input Accordion */}
        {showNewKeyInputs && (
          <div style={{ marginTop: '16px', padding: '20px', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#f1f5f9', marginBottom: '14px' }}>
              새로운 API 키 등록 (변경할 항목만 입력하세요. 빈칸은 기존 키를 그대로 유지합니다)
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">매매 기본 모드</label>
                <select
                  className="input-field"
                  value={newBrokerConfig.account_mode}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, account_mode: e.target.value })}
                >
                  <option value="VIRTUAL">🧪 가상매매 (키움 모의 체결)</option>
                  <option value="REAL">💰 실전매매 (토스증권 실주문 체결)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">새로운 Gemini API 키</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.gemini_api_key}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, gemini_api_key: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">새로운 키움증권 App Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.kiwoom_app_key}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, kiwoom_app_key: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">새로운 키움증권 Secret Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.kiwoom_app_secret}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, kiwoom_app_secret: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">새로운 토스증권 API Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.toss_api_key}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, toss_api_key: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">새로운 토스증권 Secret Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.toss_api_secret}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, toss_api_secret: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">새로운 토스증권 계좌번호</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="새로 변경할 경우에만 입력"
                  value={newBrokerConfig.toss_account_no}
                  onChange={(e) => setNewBrokerConfig({ ...newBrokerConfig, toss_account_no: e.target.value })}
                />
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => onSaveKeys(newBrokerConfig, () => setShowNewKeyInputs(false))}
            >
              💾 신규 API 키 저장
            </button>
          </div>
        )}
      </div>

      {/* 4. External Web Access Cloudflare Security Tunnel */}
      {(() => {
        const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
        const isTunnelOrigin = currentOrigin.includes('trycloudflare.com');
        const activeTunnelUrl = tunnelUrl || (isTunnelOrigin ? currentOrigin : null);

        return (
          <div className="board-card" style={{ marginBottom: '24px' }}>
            <div className="card-title-row">
              <div className="card-title">🌐 외부 인터넷 모바일/PC 보안 접속 (Cloudflare Tunnel)</div>
              {activeTunnelUrl ? (
                <span className="security-status-badge ok">🟢 HTTPS 정상 연결됨</span>
              ) : (
                <span className="security-status-badge" style={{ background: '#334155', color: '#94a3b8' }}>⚪ 터널 미가동</span>
              )}
            </div>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: 1.5 }}>
              포트포워딩 없이 Cloudflare 보안 터널을 통해 외부 모바일/태블릿에서도 암호화된 HTTPS로 안전하게 접속할 수 있습니다.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.3)', padding: '12px 16px', borderRadius: '8px' }}>
              <span style={{ fontSize: '13px', color: '#60a5fa', fontWeight: 600 }}>공개 주소:</span>
              {activeTunnelUrl ? (
                <a
                  href={activeTunnelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#38bdf8', textDecoration: 'underline', fontWeight: 600, fontSize: '13px' }}
                >
                  {activeTunnelUrl}
                </a>
              ) : (
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>
                  터널 미실행 상태입니다 (외부 접속 필요 시: <code>bash start_tunnel.sh</code> 실행)
                </span>
              )}
              <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>
                게이트 암호: <strong>{gatePasscode || 'sws@2129'}</strong>
              </span>
            </div>
          </div>
        );
      })()}

      {/* 5. JSON Data Backup & Restore */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">💾 JSON 데이터 백업 및 복원</div>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
          PostgreSQL 내 모든 테이블(봇 설정, 실전/가상 거래 내역, 포지션, 알고리즘 리포트)을 단일 JSON으로 Export하거나 복원합니다.
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-action" onClick={onExportBackup}>
            📥 JSON 백업 파일 다운로드 (Export)
          </button>
          <label className="btn-action" style={{ cursor: 'pointer' }}>
            📤 JSON 백업 파일 복원 (Import)
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={onImportBackup} />
          </label>
        </div>
      </div>

      {/* 6. System Version & History Info */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">🏷️ 시스템 버전 및 릴리즈 정보</div>
          <span className="app-footer-badge" style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8', padding: '4px 10px', fontSize: '12px' }}>
            v{appVersion || '0.0.7'}
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: 1.5 }}>
          autoStockTrader는 Git 커밋 1건당 버전이 0.0.X 형태로 1씩 증가하는 체계를 엄격히 유지합니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>CURRENT VERSION</div>
            <div style={{ fontSize: '15px', color: '#38bdf8', fontWeight: 700, marginTop: '2px' }}>v{appVersion || '0.0.7'}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>VERSION RULE</div>
            <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 600, marginTop: '2px' }}>0.0.X (Git Commit +1)</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>CHANGELOG FILE</div>
            <div style={{ fontSize: '13px', color: '#a78bfa', fontWeight: 600, marginTop: '2px' }}>history.md</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>LICENSE</div>
            <div style={{ fontSize: '13px', color: '#34d399', fontWeight: 600, marginTop: '2px' }}>Apache-2.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 11대 봇 config_json 세부 파라미터 한글 메타데이터 사전
export const PARAM_META = {
  k_factor: { label: '변동성 돌파 K 계수', unit: '배', step: 0.05, min: 0.2, max: 0.9, desc: '전일 변동폭(고가-저가) 대비 당일 돌파 목표가 가중치 (래리 윌리엄스 표준 0.5)' },
  vol_surge_ratio: { label: '최소 거래량 급증 배수', unit: '배', step: 0.1, min: 1.1, max: 5.0, desc: '평균 거래량 대비 최소 유입 거래량 배수 (2.0 = 200%)' },
  lookback_days: { label: '모멘텀 산출 기간', unit: '일', step: 1, min: 5, max: 60, desc: '상대 모멘텀 수익률을 계산할 과거 영업일 수' },
  min_inst_streak: { label: '외인·기관 연속 순매수', unit: '일', step: 1, min: 1, max: 10, desc: '외국인 및 기관 수급 연속 유입 최소 일수' },
  bb_period: { label: '볼린저 밴드 중심선 기간', unit: '일', step: 1, min: 10, max: 50, desc: '볼린저 밴드 이동평균 산출 기간 (표준 20일)' },
  bb_std: { label: '볼린저 밴드 표준편차(σ)', unit: 'σ', step: 0.1, min: 1.2, max: 3.0, desc: '하단 밴드 과매도 이탈 판정 표준편차 배수 (표준 2.0σ)' },
  rsi_low: { label: 'RSI 과매도 진입 기준선', unit: 'pt', step: 1, min: 15, max: 45, desc: '평균회귀 매수를 트리거할 RSI(14) 상한선' },
  fast: { label: 'MACD 단기 EMA', unit: '일', step: 1, min: 5, max: 20, desc: 'MACD 단기 지수이동평균 기간 (표준 12)' },
  slow: { label: 'MACD 장기 EMA', unit: '일', step: 1, min: 15, max: 40, desc: 'MACD 장기 지수이동평균 기간 (표준 26)' },
  signal: { label: 'MACD 시그널 기간', unit: '일', step: 1, min: 5, max: 15, desc: 'MACD 시그널선 산출 기간 (표준 9)' },
  vol_mult: { label: '거래량 폭발 배수', unit: '배', step: 0.2, min: 1.5, max: 6.0, desc: '골든크로스 동반 거래량 폭발 기준 (3.0 = 300%)' },
  atr_period: { label: 'ATR 변동성 산출 기간', unit: '일', step: 1, min: 5, max: 30, desc: '평균진폭(ATR) 계산 캔들 수' },
  multiplier: { label: 'SuperTrend ATR 배수', unit: '배', step: 0.2, min: 1.5, max: 5.0, desc: '상단 추세선 돌파 채널 폭 배수' },
  min_adx: { label: '최소 ADX 추세강도', unit: 'pt', step: 1, min: 15, max: 45, desc: '추세장 진입을 허용할 최소 ADX(14) 수치 (25 이상 강세장)' },
  ma_period: { label: '엔벨로프 중심 이평선', unit: '일', step: 1, min: 10, max: 60, desc: '이격도 산출 기준 이동평균선 기간' },
  envelope_pct: { label: '엔벨로프 하단 이격률', unit: '%', step: 0.5, min: -15.0, max: -2.0, desc: '중심선 대비 낙폭과대 매수 진입 이격도 (%)' },
  tenkan: { label: '일목 전환선 기간', unit: '일', step: 1, min: 5, max: 15, desc: '일목균형표 단기 전환선 주기 (표준 9)' },
  kijun: { label: '일목 기준선 기간', unit: '일', step: 1, min: 15, max: 40, desc: '일목균형표 중기 기준선 주기 (표준 26)' },
  senkou: { label: '일목 선행스팬B 기간', unit: '일', step: 1, min: 30, max: 80, desc: '구름대(양운) 산출 장기 주기 (표준 52)' },
  stoch_k: { label: 'Stoch-RSI %K 기간', unit: '일', step: 1, min: 5, max: 25, desc: '스토캐스틱 RSI %K 산출 기간' },
  stoch_d: { label: 'Stoch-RSI %D 스무딩', unit: '일', step: 1, min: 2, max: 10, desc: '스토캐스틱 RSI 시그널 %D 이동평균 기간' },
  vwap_margin: { label: 'VWAP 상단 지지 마진', unit: '비율', step: 0.001, min: 0.0, max: 0.02, desc: '당일 거래량가중평균가(VWAP) 대비 최소 상회 비율 (0.002 = +0.2%)' },
  ema_period: { label: '켈트너 중심 EMA 기간', unit: '일', step: 1, min: 10, max: 40, desc: '켈트너 채널 중심 지수이평선 기간' },
  atr_mult: { label: '켈트너 채널 ATR 배수', unit: '배', step: 0.1, min: 1.0, max: 3.0, desc: '스퀴즈 돌파 상단선 ATR 배수' },
  fast_ma: { label: '단기 정배열 이평선', unit: '일', step: 1, min: 10, max: 30, desc: '눌림목 지지 기준 단기 이동평균선 (표준 20일)' },
  slow_ma: { label: '장기 정배열 이평선', unit: '일', step: 1, min: 40, max: 120, desc: '추세 필터용 장기 이동평균선 (표준 60일)' },
  pullback_tolerance: { label: '20일선 눌림목 허용폭', unit: '±%', step: 0.1, min: 0.2, max: 2.5, desc: '단기 이평선 부근 지지 판정 허용 오차 (%)' },
  min_vol_ratio: { label: '잭 켈로그 최소 거래량 배수', unit: '배', step: 0.1, min: 1.5, max: 5.0, desc: '대장주 유동성 확인을 위한 평소 대비 거래량 배수 (2.0 = 200%)' },
  max_dist_from_high_pct: { label: '당일 고가 대비 최대 이격', unit: '%', step: 0.5, min: 1.0, max: 8.0, desc: '전고점 돌파 직전 눌림 허용 범위 (고가 대비 -3.5% 이내)' },
  vwap_stop_buffer: { label: 'VWAP 칼손절 버퍼 비율', unit: '배', step: 0.001, min: 0.98, max: 1.0, desc: 'VWAP 하향 이탈 칼손절 기준 (0.995 = VWAP -0.5% 이탈 시 즉시 손절)' },
  max_rsi: { label: '과열 추격 방지 최대 RSI', unit: 'pt', step: 1, min: 65, max: 88, desc: '극단적 고점(Euphoria) 추격 매수를 차단할 RSI 상한선' }
};

export function BotStrategyTunerSection({ bots = [], onSaveBotConfig, onResetBotConfig }) {
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'REAL_ONLY'
  const [activeBotId, setActiveBotId] = useState('');
  const [takeProfit, setTakeProfit] = useState(4.0);
  const [stopLoss, setStopLoss] = useState(-2.0);
  const [minVolumeEok, setMinVolumeEok] = useState(50); // 억 단위 표시
  const [configObj, setConfigObj] = useState({});
  const [saving, setSaving] = useState(false);

  const visibleBots = filterMode === 'REAL_ONLY'
    ? bots.filter((b) => Number(b.is_real_selected) === 1)
    : bots;

  const currentBot = bots.find((b) => b.bot_id === activeBotId) || visibleBots[0] || bots[0];

  React.useEffect(() => {
    if (!currentBot) return;
    if (activeBotId !== currentBot.bot_id) {
      setActiveBotId(currentBot.bot_id);
    }
    setTakeProfit(Number(currentBot.take_profit_pct ?? 4.0));
    setStopLoss(Number(currentBot.stop_loss_pct ?? -2.0));
    setMinVolumeEok(Math.round(Number(currentBot.min_volume_krw ?? 5000000000) / 100000000));
    try {
      const parsed = typeof currentBot.config_json === 'string'
        ? JSON.parse(currentBot.config_json || '{}')
        : (currentBot.config_json || {});
      setConfigObj(parsed);
    } catch (_) {
      setConfigObj({});
    }
  }, [currentBot?.bot_id, currentBot?.take_profit_pct, currentBot?.stop_loss_pct, currentBot?.min_volume_krw, currentBot?.config_json]);

  if (!currentBot) return null;

  const handleParamChange = (key, rawVal) => {
    const num = Number(rawVal);
    setConfigObj((prev) => ({ ...prev, [key]: Number.isNaN(num) ? rawVal : num }));
  };

  const handleSave = async () => {
    if (!onSaveBotConfig) return;
    setSaving(true);
    try {
      await onSaveBotConfig(currentBot.bot_id, {
        take_profit_pct: Number(takeProfit),
        stop_loss_pct: Number(stopLoss),
        min_volume_krw: Math.round(Number(minVolumeEok) * 100000000),
        config_json: configObj,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="board-card" style={{ borderColor: 'rgba(59, 130, 246, 0.4)', marginBottom: '24px' }}>
      <div className="card-title-row">
        <div>
          <div className="card-title">🎛️ 11대 퀀트 봇 알고리즘 파라미터 정밀 튜닝</div>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0', lineHeight: 1.5 }}>
            • 각 봇의 익절/손절 기준과 고유 기술적 지표 수식(<code>config_json</code>)을 실시간으로 조정합니다.<br />
            • 저장 즉시 다음 스케줄러 주기(7초)부터 가상 경쟁 아레나와 실전 매매 양쪽에 무중단 반영됩니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn-action ${filterMode === 'ALL' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => setFilterMode('ALL')}
          >
            전체 봇 ({bots.length}개)
          </button>
          <button
            type="button"
            className={`btn-action ${filterMode === 'REAL_ONLY' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 12px', fontSize: '12px', borderColor: '#f59e0b', color: filterMode === 'REAL_ONLY' ? '#fff' : '#f59e0b' }}
            onClick={() => setFilterMode('REAL_ONLY')}
          >
            ★ 실전 담당 봇만 보기
          </button>
          <button
            type="button"
            className="btn-action danger"
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => {
              if (window.confirm('11개 모든 봇의 알고리즘 파라미터를 초기 권장 기본값으로 되돌리시겠습니까?')) {
                if (onResetBotConfig) onResetBotConfig('ALL');
              }
            }}
          >
            🔄 전체 봇 기본값 복원
          </button>
        </div>
      </div>

      {/* 봇 선택 탭 리스트 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '16px 0' }}>
        {visibleBots.map((b) => {
          const isSelected = b.bot_id === currentBot.bot_id;
          const isReal = Number(b.is_real_selected) === 1;
          return (
            <button
              key={b.bot_id}
              type="button"
              onClick={() => setActiveBotId(b.bot_id)}
              className={`btn-action ${isSelected ? 'primary' : 'secondary'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: isReal ? (isSelected ? '2px solid #f59e0b' : '1px solid #f59e0b') : undefined,
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: isSelected ? 700 : 500,
                backgroundColor: isSelected ? undefined : (isReal ? 'rgba(245, 158, 11, 0.08)' : undefined),
              }}
            >
              {isReal && <span style={{ color: '#f59e0b' }}>★</span>}
              <span>{b.nickname || b.name}</span>
              <StrategyFamilyBadge bot={b} compact />
            </button>
          );
        })}
      </div>

      {/* 선택된 봇 상세 튜닝 폼 */}
      <div style={{ background: '#111827', padding: '18px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {currentBot.name}
              <small style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 400 }}>
                ({currentBot.nickname} · {currentBot.strategy_type})
              </small>
              <StrategyFamilyBadge bot={currentBot} showCode />
              {Number(currentBot.is_real_selected) === 1 && (
                <span className="badge-mode real" style={{ fontSize: '11px', padding: '2px 8px' }}>★ 실전 담당</span>
              )}
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>{currentBot.description}</p>
          </div>
          <span style={{ fontSize: '13px', color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '6px 12px', borderRadius: '6px' }}>
            가상 수익률: <strong style={{ color: (currentBot.virtual_return_pct ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
              {(currentBot.virtual_return_pct ?? 0) >= 0 ? `+${currentBot.virtual_return_pct}%` : `${currentBot.virtual_return_pct}%`}
            </strong>
          </span>
        </div>

        {/* 공통 리스크 관리 파라미터 (익절 / 손절 / 최소 거래대금) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <label style={{ fontSize: '12px', color: '#cbd5e1' }}><strong>📈 목표 익절률 (Take Profit %)</strong></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="50"
                className="input-field"
                style={{ flex: 1, padding: '6px 10px' }}
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>%</span>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <label style={{ fontSize: '12px', color: '#cbd5e1' }}><strong>🛡️ 원칙 손절선 (Stop Loss %)</strong></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input
                type="number"
                step="0.1"
                min="-30"
                max="-0.3"
                className="input-field"
                style={{ flex: 1, padding: '6px 10px' }}
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>%</span>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <label style={{ fontSize: '12px', color: '#cbd5e1' }}><strong>💰 최소 거래대금 필터 (억 원)</strong></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input
                type="number"
                step="10"
                min="5"
                max="5000"
                className="input-field"
                style={{ flex: 1, padding: '6px 10px' }}
                value={minVolumeEok}
                onChange={(e) => setMinVolumeEok(e.target.value)}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8', whiteSpace: 'nowrap' }}>억 원 이상</span>
            </div>
          </div>
        </div>

        {/* 전략 고유 config_json 세부 파라미터 동적 폼 */}
        <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#cbd5e1' }}>
          ⚙️ 전략 고유 수식 파라미터 (<code>config_json</code>)
        </h5>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          {Object.entries(configObj).map(([key, val]) => {
            const meta = PARAM_META[key] || {
              label: key,
              unit: '',
              step: 0.1,
              min: -100,
              max: 1000,
              desc: `${key} 파라미터 설정값`,
            };
            return (
              <div
                key={key}
                style={{
                  background: 'rgba(0,0,0,0.25)',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px', color: '#e2e8f0' }}>{meta.label}</strong>
                  <code style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 5px', borderRadius: '4px' }}>{key}</code>
                </div>
                <p style={{ margin: '4px 0 8px 0', fontSize: '11px', color: '#94a3b8', minHeight: '32px' }}>
                  {meta.desc}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="range"
                    min={meta.min}
                    max={meta.max}
                    step={meta.step}
                    value={val}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    style={{ flex: 1, accentColor: '#3b82f6' }}
                  />
                  <input
                    type="number"
                    min={meta.min}
                    max={meta.max}
                    step={meta.step}
                    value={val}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    className="input-field"
                    style={{ width: '85px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' }}
                  />
                  <span style={{ fontSize: '12px', color: '#94a3b8', width: '30px' }}>{meta.unit}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 하단 저장 및 개별 초기화 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', flexWrap: 'wrap', gap: '10px' }}>
          <button
            type="button"
            className="btn-action secondary"
            onClick={() => {
              if (window.confirm(`[${currentBot.nickname || currentBot.name}]의 알고리즘 파라미터를 초기 기본값으로 되돌리시겠습니까?`)) {
                if (onResetBotConfig) onResetBotConfig(currentBot.bot_id);
              }
            }}
          >
            ↩️ 이 봇({currentBot.nickname || currentBot.name})만 기본값 복원
          </button>
          <button
            type="button"
            className="btn-action success"
            disabled={saving}
            onClick={handleSave}
            style={{ fontWeight: 700 }}
          >
            {saving ? '저장 중...' : `💾 ${currentBot.nickname || currentBot.name} 파라미터 저장 및 즉시 적용`}
          </button>
        </div>
      </div>
    </div>
  );
}

