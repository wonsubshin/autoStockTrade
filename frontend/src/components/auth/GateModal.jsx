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
        localStorage.setItem('kis_gate_passed', 'true');
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto text-2xl shadow-lg">
            🔐
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">AutoStockTrader 시스템</h2>
          <p className="text-sm text-slate-400">
            키움증권 시세 ⨉ Gemini LLM ⨉ 토스증권 소수점 매매
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              입장 암호 (Gate Passcode)
            </label>
            <input
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder="패스코드 입력"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition"
              autoFocus
            />
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-950/60 border border-red-800/60 rounded-xl text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-sm transition shadow-lg shadow-blue-600/30"
          >
            {isLoading ? '인증 확인 중...' : '시스템 접속하기'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-500">
          안전한 퀀트 트레이딩을 위해 허가된 사용자만 접속 가능합니다.
        </div>
      </div>
    </div>
  );
}
