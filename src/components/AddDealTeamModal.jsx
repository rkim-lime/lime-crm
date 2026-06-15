import { useState } from 'react';
import Modal from './Modal';
import { FormSearchSelect, FormSelect } from './Form';
import { useProfiles } from '../hooks/useDashboard';
import { useAddDealTeamMember } from '../hooks/useDealTeam';

const DEAL_ROLES = [
  { value: 'Team Member',                 label: 'Team Member' },
  { value: 'Senior Relationship Manager', label: 'Senior Relationship Manager' },
  { value: 'Technical Sales',             label: 'Technical Sales' },
  { value: 'Compliance Liaison',          label: 'Compliance Liaison' },
  { value: 'Operations Lead',             label: 'Operations Lead' },
  { value: 'Management Sponsor',          label: 'Management Sponsor' },
];

export default function AddDealTeamModal({ dealId, existingMemberIds = [], onClose }) {
  const [profileId, setProfileId] = useState('');
  const [role, setRole]           = useState('Team Member');
  const [error, setError]         = useState('');

  const profiles  = useProfiles();
  const addMember = useAddDealTeamMember();

  const availableProfiles = (profiles.data ?? [])
    .filter(p => !existingMemberIds.includes(p.id))
    .map(p => ({
      value: p.id,
      label: p.role ? `${p.full_name || p.email || 'Unknown'} · ${p.role}` : (p.full_name || p.email || 'Unknown'),
    }));

  const handleAdd = async () => {
    if (!profileId) { setError('Please select a team member'); return; }
    try {
      await addMember.mutateAsync({ deal_id: dealId, profile_id: profileId, role });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title="Add Team Member"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={addMember.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={addMember.isPending}>
            {addMember.isPending ? 'Adding…' : 'Add Member'}
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
        label="Team member"
        options={availableProfiles}
        value={profileId}
        onChange={setProfileId}
        placeholder="Search team members…"
      />
      <FormSelect
        label="Deal role"
        options={DEAL_ROLES}
        value={role}
        onChange={setRole}
      />
    </Modal>
  );
}
