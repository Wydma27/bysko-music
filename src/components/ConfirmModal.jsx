import React from 'react';

export function ConfirmModal({ title, message, confirmLabel = 'Potwierdź', cancelLabel = 'Anuluj', danger = false, onConfirm, onCancel }) {
  return (
    <div className="upload-overlay" onClick={onCancel}>
      <div className="mini-modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p className="confirm-modal-message">{message}</p>}
        <div className="mini-modal-footer">
          <button className="btn btn--ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
