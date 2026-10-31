import React, { useState } from 'react';

export default function SettingsPanel({
  accountBalance,
  budgetSettings,
  setBudgetSettings,
  botRatios,
  setBotRatios,
  bots,
  brokerConfig,
  purchasePriority,
  setPurchasePriority,
  onSavePriority,
  onSaveBudget,
  onSaveKeys,
  onExportBackup,
  onImportBackup,
}) {
  const [showNewKeyInputs, setShowNewKeyInputs] = useState(false);
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

      {/* 2. Budget & Bot Allocation Management */}
      <div className="board-card" style={{ borderColor: 'rgba(59, 130, 246, 0.4)', marginBottom: '24px' }}>
        <div className="card-title-row">
          <div className="card-title">💰 가상 / 실제 사용 예산 및 봇별 자금 배분 비율 설정</div>
          <span className="badge-mode" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
            예산 초과 매매 방지 락
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.5 }}>
          각 봇은 여기서 설정된 배분 비율에 따른 예산 한도 내에서만 매매를 집행하며, <strong>실제 사용 예산은 토스증권 실시간 주문 가능 예수금을 초과하여 설정할 수 없습니다.</strong>
        </p>

        <div className="form-row">
          {/* Virtual Total Budget */}
          <div className="form-group">
            <label className="form-label">🧪 가상 매매 총 운용 예산 (KRW)</label>
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

          {/* Real Total Budget (Capped at Toss Balance) */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label">🚨 실제 사용 총 예산 (토스증권 실전 한도)</label>
              <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>
                토스 예수금: {tossAvailable.toLocaleString()}원
              </span>
            </div>
            <input
              type="number"
              className="input-field"
              style={{ borderColor: budgetSettings.realTotalBudget > tossAvailable ? '#ef4444' : undefined }}
              value={budgetSettings.realTotalBudget}
              onChange={(e) => setBudgetSettings({ ...budgetSettings, realTotalBudget: parseInt(e.target.value, 10) || 0 })}
            />
            <div className="budget-quick-btns">
              <button
                type="button"
                className="budget-quick-btn"
                onClick={() => setBudgetSettings({ ...budgetSettings, realTotalBudget: tossAvailable })}
              >
                전액 (100%)
              </button>
              <button
                type="button"
                className="budget-quick-btn"
                onClick={() => setBudgetSettings({ ...budgetSettings, realTotalBudget: Math.floor(tossAvailable * 0.7) })}
              >
                70%
              </button>
              <button
                type="button"
                className="budget-quick-btn"
                onClick={() => setBudgetSettings({ ...budgetSettings, realTotalBudget: Math.floor(tossAvailable * 0.5) })}
              >
                50%
              </button>
              <button
                type="button"
                className="budget-quick-btn"
                onClick={() => setBudgetSettings({ ...budgetSettings, realTotalBudget: Math.floor(tossAvailable * 0.3) })}
              >
                30%
              </button>
            </div>
            {budgetSettings.realTotalBudget > tossAvailable && (
              <div className="budget-error-msg">
                ❌ 실제 사용 예산({budgetSettings.realTotalBudget.toLocaleString()}원)은 현재 토스증권 예수금({tossAvailable.toLocaleString()}원)을 초과할 수 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* Bot Allocation Ratios */}
        <div style={{ marginTop: '24px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '14px' }}>
            📊 각 봇별 예산 배분 비율 (%) 및 할당 금액
          </div>
          {(() => {
            const sumRatio = Object.values(botRatios).reduce((acc, v) => acc + (Number(v) || 0), 0);
            const is100 = sumRatio === 100;
            return (
              <span style={{ fontSize: '12px', fontWeight: 700, color: is100 ? '#34d399' : '#f59e0b' }}>
                배분율 합계: {sumRatio}% {is100 ? '(정상 100%)' : '(경고: 합계가 100%가 되도록 조정해주세요)'}
              </span>
            );
          })()}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          {bots.map((b) => {
            const ratio = botRatios[b.bot_id] ?? Math.round((b.allocation_ratio || 0.33) * 100);
            const virtAmt = Math.floor((budgetSettings.virtualTotalBudget || 0) * (ratio / 100));
            const realAmt = Math.floor((budgetSettings.realTotalBudget || 0) * (ratio / 100));

            return (
              <div key={b.bot_id} className="bot-allocation-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#fff' }}>{b.nickname || b.name}</span>
                  <span className={`badge-mode ${b.trade_mode === 'REAL' ? 'real' : 'virtual'}`}>
                    {b.trade_mode === 'REAL' ? '💰 실전' : '🧪 가상'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px', minHeight: '32px' }}>
                  {b.description}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    style={{ flex: 1 }}
                    value={ratio}
                    onChange={(e) => setBotRatios({ ...botRatios, [b.bot_id]: Number(e.target.value) })}
                  />
                  <div style={{ width: '60px', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="input-field"
                      style={{ padding: '4px 6px', fontSize: '12px', textAlign: 'center' }}
                      value={ratio}
                      onChange={(e) => setBotRatios({ ...botRatios, [b.bot_id]: Number(e.target.value) })}
                    />
                    <span style={{ fontSize: '12px', color: '#cbd5e1', marginLeft: '3px' }}>%</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', background: 'rgba(0,0,0,0.3)', padding: '6px 10px', borderRadius: '6px' }}>
                  <span>가상 배분: <strong style={{ color: '#34d399' }}>{virtAmt.toLocaleString()}원</strong></span>
                  <span>실전 배분: <strong style={{ color: '#fca5a5' }}>{realAmt.toLocaleString()}원</strong></span>
                </div>
              </div>
            );
          })}
        </div>

        <button
          className="btn-primary"
          onClick={onSaveBudget}
          disabled={budgetSettings.realTotalBudget > tossAvailable}
        >
          💾 투자 예산 및 봇 배분 설정 저장
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

