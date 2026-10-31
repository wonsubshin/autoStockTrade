import React from 'react';

export default function Header({
  healthData,
  activeMenu,
  setActiveMenu,
  onLogout,
}) {
  const marketStatus = healthData?.marketStatus;
  const regime = healthData?.marketRegime;

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="brand">
        <div className="brand-icon">📈</div>
        <div>
          <div className="brand-title">Kiwoom ⨉ Toss</div>
          <div className="brand-subtitle">AI Quant Trader</div>
        </div>
      </div>

      {/* Real-time Status Panel */}
      <div className="status-panel">
        <div className="status-row">
          <span className="status-label">키움 시세</span>
          <span className={`status-pill ${healthData?.kiwoomHealth?.status || 'gray'}`}>
            ● {healthData?.kiwoomHealth?.status === 'green' ? '정상연결' : healthData?.kiwoomHealth?.status === 'yellow' ? '가상대기' : '미연결'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">토스 매매</span>
          <span className={`status-pill ${healthData?.tossHealth?.status || 'gray'}`}>
            ● {healthData?.tossHealth?.status === 'green' ? '정상연결' : healthData?.tossHealth?.status === 'yellow' ? '가상대기' : '미연결'}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">국내 장운영</span>
          <span className="status-pill gray" style={{ fontSize: '10px' }}>
            {marketStatus?.phase || 'CHECKING'}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
          {marketStatus?.badge || '장 상태 확인 중...'}
        </div>
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
      <div className="sidebar-footer">
        <div>PostgreSQL: {healthData?.pgConnected ? '🟢 동기화 정상' : '🟡 대기/로컬모드'}</div>
        <div>Dual DB: SQLite + PG16</div>
        <div
          style={{ cursor: 'pointer', color: '#ef4444', marginTop: '8px' }}
          onClick={onLogout}
        >
          🚪 로그아웃 (게이트 락)
        </div>
      </div>
    </aside>
  );
}
