import React from 'react';

export default function Modal({ modalInfo, onClose }) {
  if (!modalInfo) return null;

  const { title, message, type = 'info', onConfirm } = modalInfo;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button
            className="btn-action"
            style={{ padding: '4px 8px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
          {message}
        </div>
        <div className="modal-footer">
          {type === 'confirm' ? (
            <>
              <button className="btn-action" onClick={onClose}>
                취소
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (onConfirm) onConfirm();
                  onClose();
                }}
              >
                확인 진행
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={onClose}>
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
