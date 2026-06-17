import { useState } from 'react';
import { useIsAdmin } from './RoleGate';
import { useAuth } from '../hooks/useAuth.jsx';
import { useDealTeam, useRemoveDealTeamMember } from '../hooks/useDealTeam';
import AddDealTeamModal from './AddDealTeamModal';
import { OwnerName } from '../pages/shared';

const ROLE_STYLE = {
  'Team Member':                 { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  'Senior Relationship Manager': { background: '#f3e8ff', color: '#7c3aed' },
  'Technical Sales':             { background: '#dbeafe', color: '#2563eb' },
  'Compliance Liaison':          { background: '#fef3c7', color: '#d97706' },
  'Operations Lead':             { background: '#ccfbf1', color: '#0d9488' },
  'Management Sponsor':          { background: '#e0e7ff', color: '#4338ca' },
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function DealTeamPanel({ dealId }) {
  const [addOpen, setAddOpen] = useState(false);
  const isAdmin = useIsAdmin();
  const { role } = useAuth();
  const canManage = isAdmin || role === 'sales';

  const team   = useDealTeam(dealId);
  const remove = useRemoveDealTeamMember();

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Deal Team</span>
        {canManage && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}>
            + Add Member
          </button>
        )}
      </div>
      <div style={{ padding: '0 18px 12px' }}>
        {team.isLoading && <div className="skeleton skeleton-text" style={{ margin: '12px 0' }} />}
        {!team.isLoading && (team.data ?? []).length === 0 && (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>
            No team members added yet
          </div>
        )}
        {(team.data ?? []).map(member => {
          const roleStyle = ROLE_STYLE[member.role] ?? ROLE_STYLE['Team Member'];
          const nameStr = member.profile?.full_name || member.profile?.email || '';
          return (
            <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--bg-tertiary)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
              }}>
                {initials(nameStr)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}><OwnerName profile={member.profile} /></div>
                {member.profile?.role && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{member.profile.role}</div>
                )}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                background: roleStyle.background, color: roleStyle.color, whiteSpace: 'nowrap',
              }}>
                {member.role}
              </span>
              {canManage && (
                <button
                  onClick={() => remove.mutate({ id: member.id, deal_id: dealId })}
                  disabled={remove.isPending}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}
                  aria-label="Remove member"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      {addOpen && (
        <AddDealTeamModal
          dealId={dealId}
          existingMemberIds={(team.data ?? []).map(m => m.profile_id)}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
