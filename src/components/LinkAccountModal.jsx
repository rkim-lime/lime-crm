import { useState } from 'react';
import Modal, { ModalFooter } from './Modal';
import { useAccounts } from '../hooks/useAccounts';
import { useLinkContactToAccount } from '../hooks/useContacts';
import { TierBadge, SegmentBadge } from '../pages/shared';

export default function LinkAccountModal({ contactId, onClose }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');

  const accounts = useAccounts({});
  const link = useLinkContactToAccount();

  const filtered = (accounts.data ?? []).filter(a =>
    a.name.toLowerCase().includes(q.toLowerCase())
  );

  const confirm = async () => {
    if (!selected) { setError('Select an account first'); return; }
    try {
      await link.mutateAsync({ contactId, accountId: selected.id, role, isPrimary });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="Link to Account" onClose={onClose} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <input
          className="form-input"
          placeholder="Search accounts…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />

        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7 }}>
          {accounts.isLoading && <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>}
          {filtered.map(a => (
            <div
              key={a.id}
              onClick={() => { setSelected(a); setError(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                background: selected?.id === a.id ? 'var(--accent-subtle)' : 'transparent',
                transition: 'background .1s',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{a.name}</div>
              </div>
              <TierBadge tier={a.tier} />
              <SegmentBadge segment={a.segment} />
            </div>
          ))}
          {!accounts.isLoading && filtered.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>No accounts found</div>
          )}
        </div>

        {selected && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Role at account</label>
              <input className="form-input" placeholder="e.g. Head of Trading" value={role} onChange={e => setRole(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 8, fontSize: 13.5 }}>
              <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
              Primary contact
            </label>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </div>

      <ModalFooter>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={confirm} disabled={!selected || link.isPending}>
          {link.isPending ? 'Linking…' : 'Link account'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
