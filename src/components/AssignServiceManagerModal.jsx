import { useState } from 'react';
import Modal from './Modal';
import { FormSearchSelect } from './Form';
import { useProfiles } from '../hooks/useDashboard';
import { useUpdateAccount } from '../hooks/useAccounts';

export default function AssignServiceManagerModal({ account, onClose }) {
  const [serviceManagerId, setServiceManagerId] = useState(account.service_manager_id ?? '');
  const [error, setError] = useState('');

  const profiles = useProfiles();
  const update   = useUpdateAccount();

  const profileOpts = (profiles.data ?? []).map(p => ({
    value: p.id,
    label: p.full_name || p.email || 'Unknown',
  }));

  const handleSave = async () => {
    if (!serviceManagerId) { setError('Please select a service manager'); return; }
    try {
      await update.mutateAsync({ id: account.id, service_manager_id: serviceManagerId });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title="Assign Service Manager"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={update.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Assign'}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}
      <FormSearchSelect
        label="Service Manager"
        options={profileOpts}
        value={serviceManagerId}
        onChange={setServiceManagerId}
        placeholder="Select service manager…"
      />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 8 }}>
        The Service Manager takes over primary relationship once the account goes Live.
      </div>
    </Modal>
  );
}
