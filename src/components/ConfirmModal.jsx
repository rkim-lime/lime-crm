import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function ConfirmModal({
  isOpen, title, message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  onConfirm, onCancel,
  loading = false,
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const btnClass = confirmVariant === 'warning' ? 'btn-warning' : 'btn-danger';

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-dialog"
        style={{ width: 420, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">
            {confirmVariant === 'danger' && (
              <span style={{ marginRight: 8, color: 'var(--red)' }}>⚠</span>
            )}
            {title}
          </span>
          <button className="modal-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {message && (
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              {message}
            </p>
          )}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button className={`btn ${btnClass}`} onClick={onConfirm} disabled={loading}>
              {loading ? 'Processing…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
