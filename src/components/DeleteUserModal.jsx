import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeleteUserPermanently } from '../hooks/useUsers';

export default function DeleteUserModal({ user, onClose }) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const deletePermanently = useDeleteUserPermanently();

  const confirmed = confirmation === user.email;

  const handleDelete = async () => {
    if (!confirmed) return;
    setError('');
    try {
      await deletePermanently.mutateAsync(user.id);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ width: 460, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Permanently Delete User</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
            padding: '12px 14px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 600, marginBottom: 4 }}>
              This cannot be undone.
            </div>
            <div style={{ fontSize: 13, color: '#dc2626', lineHeight: 1.6 }}>
              This will permanently delete <strong>{user.full_name || user.email}</strong>'s account.
              All records they owned will show as <em>Deleted User</em>.
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
              Type <strong>{user.email}</strong> to confirm
            </label>
            <input
              type="text"
              autoFocus
              value={confirmation}
              onChange={e => { setConfirmation(e.target.value); setError(''); }}
              placeholder={user.email}
              className="form-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={!confirmed || deletePermanently.isPending}
            style={{
              background: confirmed ? 'var(--red)' : 'var(--bg-tertiary)',
              color: confirmed ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: confirmed ? 'pointer' : 'not-allowed',
            }}
          >
            {deletePermanently.isPending ? 'Deleting…' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
