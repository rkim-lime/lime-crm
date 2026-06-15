import { useState } from 'react';
import Modal from './Modal';
import { FormSearchSelect } from './Form';
import { useProfiles } from '../hooks/useDashboard';
import { useUpdateAccount } from '../hooks/useAccounts';
import { useUpdateDeal } from '../hooks/useDeals';
import { useUpdateContact } from '../hooks/useContacts';
import { useUpdateLead } from '../hooks/useLeads';
import { useQueryClient } from '@tanstack/react-query';

export default function AssignOwnerModal({
  recordType,
  recordId,
  fieldName,
  title,
  currentOwnerId,
  onClose,
}) {
  const [selectedId, setSelectedId] = useState(currentOwnerId ?? '');
  const [error, setError] = useState('');

  const profiles = useProfiles();
  const qc       = useQueryClient();

  // All four hooks are always called (rules of hooks); we pick the right one by recordType
  const updateAccount = useUpdateAccount();
  const updateDeal    = useUpdateDeal();
  const updateContact = useUpdateContact();
  const updateLead    = useUpdateLead();

  const updateMap = { account: updateAccount, deal: updateDeal, contact: updateContact, lead: updateLead };
  const update    = updateMap[recordType] ?? updateAccount;

  const profileOpts = (profiles.data ?? []).map(p => ({
    value: p.id,
    label: p.full_name || p.email || 'Unknown',
  }));

  const handleSave = async () => {
    if (!selectedId) { setError('Please select a person'); return; }
    try {
      await update.mutateAsync({ id: recordId, [fieldName]: selectedId });
      qc.invalidateQueries({ queryKey: ['ownership-hygiene'] });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title={title}
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
        label={fieldName === 'service_manager_id' ? 'Service Manager' : 'Sales Owner'}
        options={profileOpts}
        value={selectedId}
        onChange={setSelectedId}
        placeholder="Search team members…"
      />
    </Modal>
  );
}
