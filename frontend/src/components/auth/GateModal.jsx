import React, { useState } from 'react';
import { api } from '../../services/api';

export default function GateModal({ onAuthenticated }) {
  const [passcodeInput, setPasscodeInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!passcodeInput.trim()) return;

    setErrorMsg('');
    setIsLoading(true);
    try {
      const res = await api.verifyGate(passcodeInput);
      if (res.success) {
        const authTime = res.authTime || Date.now();
        localStorage.setItem('kis_gate_passed', 'true');
        localStorage.setItem('kis_gate_auth_time', authTime.toString());
        onAuthenticated();
      } else {
        setErrorMsg(res.message || '인증에 실패했습니다.');
      }
    } catch (err) {
      setErrorMsg(err.message || '인증 서버 통신 오류');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-icon">📈</div>
        <h1 className="gate-title">키움(시세) ⨉ 토스(매매) AI 퀀트 시스템</h1>
        <p className="gate-desc">
          본 시스템은 키움증권 시세 조회 및 토스증권 매매 연동 전용 게이트입니다.<br />
          개인 입장 코드를 입력하고 접속하세요.
        </p>
        <form onSubmit={handleSubmit} className="gate-form">
          <input
            type="password"
            className="input-field"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            autoFocus
          />
          {errorMsg && <div style={{ color: '#ef4444', fontSize: '13px' }}>{errorMsg}</div>}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '인증 확인 중...' : '보안 게이트 입장'}
          </button>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px', lineHeight: '1.4' }}>
            🔒 24시간 보안 세션: 1일이 지나면 안전을 위해 인증이 만료됩니다.
          </div>
        </form>
      </div>
    </div>
  );
}
