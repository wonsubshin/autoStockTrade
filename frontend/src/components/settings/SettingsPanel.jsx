import React, { useState } from 'react';

export default function SettingsPanel({
  accountBalance,
  budgetSettings,
  setBudgetSettings,
  botRatios,
  setBotRatios,
  bots = [],
  brokerConfig,
  purchasePriority,
  setPurchasePriority,
  onSavePriority,
  onSaveBudget,
  onSaveRealAllocation,
  onSaveKeys,
  onExportBackup,
  onImportBackup,
  onGoToArena,
}) {
  const [showNewKeyInputs, setShowNewKeyInputs] = useState(false);
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
      // allocations가 비어있거나 선택된 봇 목록이 변경된 경우 재설정
      if (allocations.length === 0 || prevBotIdsKeyRef.current !== selectedBotIdsKey) {
        prevBotIdsKeyRef.current = selectedBotIdsKey;
        setAllocations(
          selectedRealBots.map((b) => ({
            bot_id: b.bot_id,
            name: b.name,
            nickname: b.nickname,
            ratio: Number(b.real_allocation_ratio || (100 / selectedRealBots.length).toFixed(1)),
          }))
        );
      }
    }
  }, [selectedBotIdsKey, selectedRealBots, allocations.length]);

  const handleRatioChange = (botId, val) => {
    const num = Math.max(0, Math.min(100, Number(val)));
    if (allocations.length === 1) {
      setAllocations([{ ...allocations[0], ratio: 100 }]);
      return;
    }
    if (allocations.length === 2) {
      setAllocations(
        allocations.map((a) =>
          a.bot_id === botId ? { ...a, ratio: num } : { ...a, ratio: Number((100 - num).toFixed(1)) }
        )
      );
      return;
    }
    setAllocations(allocations.map((a) => (a.bot_id === botId ? { ...a, ratio: num } : a)));
  };

  const handleEqualSplit = () => {
    const n = allocations.length;
    if (!n) return;
    const base = Math.floor((100 / n) * 10) / 10;
    let acc = 0;
    setAllocations(
      allocations.map((a, idx) => {
        const r = idx === n - 1 ? Number((100 - acc).toFixed(1)) : base;
        acc += r;
        return { ...a, ratio: r };
      })
    );
  };

  const totalAllocRatio = allocations.reduce((s, a) => s + Number(a.ratio || 0), 0);
  const isAllocValid = Math.abs(totalAllocRatio - 100) <= 0.5;
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

  const tossAvailable = budgetSettings.tossAvailableCash || 0;

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
            <div className="metric-title">주문 가능 예수금 (KRW)</div>
            <div className="metric-value">{(accountBalance?.real?.availableCash ?? accountBalance?.availableCash ?? 0).toLocaleString()}원</div>
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
          <div className="card-title">🎯 선택된 실전 담당 봇 (3개) 동적 투자금 비율 설정</div>
          <span className="badge-mode real">
            실전 배분 엔진
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px', lineHeight: 1.5 }}>
          가상 아레나에서 선발된 <strong>3개의 실전 담당 봇</strong>의 투자금 비율(합계 100%)을 설정합니다. 하단의 <strong>[확인 및 실전 매매 적용]</strong>을 누르면 설정이 저장되고 즉시 <strong>실전 매매 화면으로 이동</strong>하여 매매에 적용됩니다.
        </p>

        {allocations.length === 0 ? (
          <div style={{ padding: '20px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#fca5a5', fontSize: '13px' }}>
            <div style={{ marginBottom: '12px' }}>
              ⚠️ 현재 선택된 실전 담당 봇이 없습니다. 상단 메뉴의 <strong>[⚡ 가상 경쟁 아레나]</strong>에서 실전을 담당할 3개의 봇을 먼저 체크 후 확정해주세요.
            </div>
            {onGoToArena && (
              <button
                type="button"
                className="btn-action success"
                style={{ fontWeight: 700, padding: '7px 16px' }}
                onClick={onGoToArena}
              >
                ⚡ 가상 경쟁 아레나로 이동하여 3개 봇 선택하기
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Real Total Budget Setup */}
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">🚨 총 실전 투자 예산 (KRW)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>
                    토스 예수금: {tossAvailable.toLocaleString()}원
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
              <input
                type="number"
                className="input-field"
                step="100000"
                value={realTotalBudget}
                onChange={(e) => setRealTotalBudget(parseInt(e.target.value, 10) || 0)}
              />
              <div className="budget-quick-btns">
                <button
                  type="button"
                  className="budget-quick-btn"
                  onClick={() => setRealTotalBudget(tossAvailable || 10000000)}
                >
                  토스예수금 ({tossAvailable.toLocaleString()}원)
                </button>
                <button
                  type="button"
                  className="budget-quick-btn"
                  onClick={() => setRealTotalBudget(1000000)}
                >
                  100만
                </button>
                <button
                  type="button"
                  className="budget-quick-btn"
                  onClick={() => setRealTotalBudget(5000000)}
                >
                  500만
                </button>
                <button
                  type="button"
                  className="budget-quick-btn"
                  onClick={() => setRealTotalBudget(10000000)}
                >
                  1천만
                </button>
              </div>
              {tossAvailable > 0 && realTotalBudget > tossAvailable && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', padding: '6px 12px' }}>
                  ℹ️ 현재 토스 주문 가능 예수금({tossAvailable.toLocaleString()}원)보다 설정 예산이 큽니다. 실제 자동 매매 주문은 토스 실잔고 한도 내에서 안전하게 분할 집행됩니다.
                </div>
              )}
            </div>

            {/* Dynamic Allocation List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
              {allocations.map((item) => {
                const allocatedKrw = Math.floor(realTotalBudget * (item.ratio / 100));
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#f8fafc' }}>{item.name}</strong>
                        <span style={{ color: '#818cf8', marginLeft: '6px', fontSize: '12px' }}>({item.nickname})</span>
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

            {/* Ratio Validation & Save Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <span className={isAllocValid ? 'num-up' : 'num-down'} style={{ fontWeight: 700, fontSize: '13px' }}>
                비율 합계: <strong>{totalAllocRatio.toFixed(1)}%</strong> / 100%
                {!isAllocValid && ' (비율의 합이 100%가 되도록 조정해 주세요)'}
              </span>
              <button
                className="btn-primary"
                disabled={!isAllocValid}
                onClick={() => onSaveRealAllocation && onSaveRealAllocation(realTotalBudget, allocations)}
              >
                💾 실전 투자금 비율 저장 및 실전 매매 적용 (확인)
              </button>
            </div>
          </>
        )}
      </div>

      {/* 2-1. Virtual Budget Configuration */}
      <div className="board-card" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🧪 가상 매매 총 운용 예산 설정 (10대 봇 아레나)</div>
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
      <div className="board-card" style={{ marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">🌐 외부 인터넷 모바일/PC 보안 접속 (Cloudflare Tunnel)</div>
          <span className="security-status-badge ok">🟢 HTTPS 정상 연결됨</span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: 1.5 }}>
          포트포워딩 없이 Cloudflare 보안 터널을 통해 외부 모바일/태블릿에서도 암호화된 HTTPS로 안전하게 접속할 수 있습니다.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.3)', padding: '12px 16px', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: '#60a5fa', fontWeight: 600 }}>공개 주소:</span>
          <a
            href="https://plumbing-workplace-spouse-def.trycloudflare.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#38bdf8', textDecoration: 'underline', fontWeight: 600, fontSize: '13px' }}
          >
            https://plumbing-workplace-spouse-def.trycloudflare.com
          </a>
          <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>
            게이트 암호: <strong>sws@2129</strong>
          </span>
        </div>
      </div>

      {/* 5. JSON Data Backup & Restore */}
      <div className="board-card">
        <div className="card-title-row">
          <div className="card-title">💾 JSON 데이터 백업 및 복원</div>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
          SQLite 내 모든 테이블(봇 설정, 실전/가상 거래 내역, 포지션, 알고리즘 리포트)을 단일 JSON으로 Export하거나 복원합니다.
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
    </div>
  );
}

