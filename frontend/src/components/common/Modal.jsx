import React, { useRef } from 'react';

export default function Modal({ modalInfo, onClose }) {
  if (!modalInfo) return null;

  const { title, message, type = 'info', onConfirm } = modalInfo;
  const mountTimeRef = useRef(Date.now());

  const handleOverlayClick = () => {
    // 더블클릭 오작동 방지: 모달 마운트 후 350ms 이내의 배경 클릭은 무시
    if (Date.now() - mountTimeRef.current < 350) return;
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
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
