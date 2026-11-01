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
              <button
                className="btn-action"
                style={{ padding: '8px 16px', fontSize: '13px' }}
                onClick={onClose}
              >
                {modalInfo.cancelText || '취소'}
              </button>
              <button
                className={
                  modalInfo.confirmColor === 'danger'
                    ? 'btn-action danger'
                    : modalInfo.confirmColor === 'success'
                    ? 'btn-action success'
                    : 'btn-primary'
                }
                style={{
                  fontWeight: 700,
                  padding: '8px 18px',
                  fontSize: '13px',
                }}
                onClick={() => {
                  if (onConfirm) onConfirm();
                  onClose();
                }}
              >
                {modalInfo.confirmText || '확인 진행'}
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              style={{ padding: '8px 22px', fontSize: '13px', fontWeight: 700 }}
              onClick={onClose}
            >
              {modalInfo.okText || '확인'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
