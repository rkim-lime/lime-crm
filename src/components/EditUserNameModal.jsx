import { useState } from 'react';
import Modal from './Modal';
import { useUpdateUserName } from '../hooks/useUsers';

export default function EditUserNameModal({ user, onClose }) {
  const [name, setName] = useState(user.full_name ?? '');
  const [error, setError] = useState('');
  const update = useUpdateUserName();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await update.mutateAsync({ id: user.id, full_name: name.trim() || null });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title={`Edit Name — ${user.email}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="edit-name-form" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="edit-name-form" onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
            Full Name
          </label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Jane Smith"
            className="form-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
        </div>
      </form>
    </Modal>
  );
}
