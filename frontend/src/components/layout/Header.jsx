import React from 'react';

export default function Header({
  healthData,
  activeMenu,
  setActiveMenu,
  onLogout,
}) {
  const marketStatus = healthData?.marketStatus;
  const regime = healthData?.marketRegime;
  const appVersion = healthData?.version || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.7');

  const [remainingSessionStr, setRemainingSessionStr] = React.useState('자정(00:00) 만료');
  const [mobileStatusOpen, setMobileStatusOpen] = React.useState(false);

  React.useEffect(() => {
    const updateRemaining = () => {
      const now = new Date();
      const kstParts = {};
      for (const p of new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(now)) {
        kstParts[p.type] = p.value;
      }
      const h = parseInt(kstParts.hour || '0', 10) % 24;
      const m = parseInt(kstParts.minute || '0', 10);
      const elapsedMin = h * 60 + m;
      const remainMin = Math.max(0, 24 * 60 - elapsedMin);
      const hours = Math.floor(remainMin / 60);
      const mins = remainMin % 60;
      setRemainingSessionStr(`자정 만료 (${hours}시간 ${mins}분 남음)`);
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
            <div className="brand-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Kiwoom ⨉ Toss</span>
              <span className="brand-version-badge" title="시스템 버전">
                v{appVersion}
              </span>
            </div>
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
          className={`nav-item ${activeMenu === 'REAL_TRADING' ? 'active' : ''}`}
          onClick={() => setActiveMenu('REAL_TRADING')}
        >
          <span>🔥</span>
          <span>실전 매매</span>
        </div>
        <div
          className={`nav-item ${activeMenu === 'VIRTUAL_ARENA' ? 'active' : ''}`}
          onClick={() => setActiveMenu('VIRTUAL_ARENA')}
        >
          <span>⚡</span>
          <span>가상 경쟁 아레나</span>
        </div>
        <div
          className={`nav-item ${activeMenu === 'STATS' ? 'active' : ''}`}
          onClick={() => setActiveMenu('STATS')}
        >
          <span>📊</span>
          <span>실전 수익/통계</span>
        </div>
        <div
          className={`nav-item ${activeMenu === 'NEWS' ? 'active' : ''}`}
          onClick={() => setActiveMenu('NEWS')}
        >
          <span>📰</span>
          <span>AI 뉴스/시황</span>
        </div>
        <div
          className={`nav-item ${activeMenu === 'SETTINGS' ? 'active' : ''}`}
          onClick={() => setActiveMenu('SETTINGS')}
        >
          <span>⚙️</span>
          <span>환경설정</span>
        </div>
      </nav>

      {/* Sidebar Footer */}
      <div className={`sidebar-footer ${mobileStatusOpen ? 'mobile-open' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>PostgreSQL: {healthData?.pgConnected ? '🟢 정상' : '🟡 대기/로컬'}</span>
          <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600 }}>v{appVersion}</span>
        </div>
        <div>Database: PostgreSQL 16</div>
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
