import React from 'react';

export default function Modal({ modalInfo, onClose }) {
  if (!modalInfo) return null;

  const { title, message, type = 'info', onConfirm } = modalInfo;

  const getTypeStyle = () => {
    switch (type) {
      case 'error':
        return { badge: '🔴 오류', color: '#ef4444', border: 'border-red-500/40' };
      case 'success':
        return { badge: '🟢 성공', color: '#10b981', border: 'border-emerald-500/40' };
      case 'warning':
        return { badge: '🟡 경고', color: '#f59e0b', border: 'border-amber-500/40' };
      default:
        return { badge: '🔵 안내', color: '#3b82f6', border: 'border-blue-500/40' };
    }
  };

  const style = getTypeStyle();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className={`bg-gray-900 border ${style.border} rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4`}>
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-200">
              {style.badge}
            </span>
            <h3 className="text-lg font-bold text-white">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg p-1 transition"
          >
            ✕
          </button>
        </div>

        <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap py-2">
          {message}
        </div>

        <div className="flex justify-end space-x-3 pt-3 border-t border-gray-800">
          {onConfirm && (
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl text-sm transition"
            >
              확인
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl text-sm transition"
          >
            {onConfirm ? '취소' : '닫기'}
          </button>
        </div>
      </div>
    </div>
  );
}
