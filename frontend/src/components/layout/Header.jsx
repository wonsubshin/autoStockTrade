import React from 'react';

export default function Header({
  healthData,
  activeMenu,
  setActiveMenu,
  onLogout,
}) {
  const marketStatus = healthData?.marketStatus;
  const regime = healthData?.marketRegime;

  const [remainingSessionStr, setRemainingSessionStr] = React.useState('24시간');
  const [mobileStatusOpen, setMobileStatusOpen] = React.useState(false);

  React.useEffect(() => {
    const updateRemaining = () => {
      const authTimeStr = localStorage.getItem('kis_gate_auth_time');
      if (!authTimeStr) {
        setRemainingSessionStr('24시간');
        return;
      }
      const authTime = parseInt(authTimeStr, 10);
      const remainingMs = Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - authTime));
      const hours = Math.floor(remainingMs / (60 * 60 * 1000));
      const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      setRemainingSessionStr(`${hours}시간 ${mins}분 남음`);
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="brand-icon">📈</div>
          <div>
            <div className="brand-title">Kiwoom ⨉ Toss</div>
            <div className="brand-subtitle">AI Quant Trader</div>
          </div>
        </div>

        {/* Mobile Header Actions (Visible only on mobile <= 900px) */}
        <div className="mobile-header-actions">
          <button
            type="button"
            className="mobile-status-btn"
            onClick={() => setMobileStatusOpen(!mobileStatusOpen)}
          >
            {mobileStatusOpen ? '▲ 접기' : '⚡ 시스템 상태'}
          </button>
          <button
            type="button"
            className="mobile-logout-btn"
            onClick={onLogout}
            title="로그아웃"
          >
            🚪
          </button>
        </div>
      </div>

      {/* Real-time Status Panel */}
      <div className={`status-panel ${mobileStatusOpen ? 'mobile-open' : ''}`}>
        <div className="status-row">
          <span className="status-label">키움 시세(KR)</span>
          <span className={`status-pill ${healthData?.kiwoomHealth?.status || 'gray'}`}>
            ● {healthData?.kiwoomHealth?.status === 'green' ? '정상연결' : healthData?.kiwoomHealth?.status === 'yellow' ? '가상대기' : '미연결'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">토스 시세/매매(US)</span>
          <span className={`status-pill ${healthData?.tossHealth?.status || 'gray'}`}>
            ● {healthData?.tossHealth?.status === 'green' ? '실시간연동' : healthData?.tossHealth?.status === 'yellow' ? '가상대기' : '미연결'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">국내 장운영</span>
          <span className="status-pill gray" style={{ fontSize: '10px' }}>
            {marketStatus?.kr?.phase || marketStatus?.phase || 'CHECKING'}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
          {marketStatus?.kr?.badge || marketStatus?.badge || '장 상태 확인 중...'}
        </div>
        {marketStatus?.us && (
          <>
            <div className="status-row" style={{ marginTop: '4px' }}>
              <span className="status-label">미국 장운영</span>
              <span className={`status-pill ${marketStatus.us.color || 'gray'}`} style={{ fontSize: '10px' }}>
                {marketStatus.us.phase || 'CLOSED'}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
              {marketStatus.us.badge}
            </div>
          </>
        )}
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
      <div className={`sidebar-footer ${mobileStatusOpen ? 'mobile-open' : ''}`}>
        <div>PostgreSQL: {healthData?.pgConnected ? '🟢 동기화 정상' : '🟡 대기/로컬모드'}</div>
        <div>Dual DB: SQLite + PG16</div>
        <div style={{ color: '#38bdf8', marginTop: '4px', fontSize: '10.5px' }}>
          ⏱️ 인증 만료: {remainingSessionStr}
        </div>
        <div
          style={{ cursor: 'pointer', color: '#ef4444', marginTop: '6px' }}
          onClick={onLogout}
        >
          🚪 로그아웃 (게이트 락)
        </div>
      </div>
    </aside>
  );
}
