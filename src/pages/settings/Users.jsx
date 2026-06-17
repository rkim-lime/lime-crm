import { useState } from 'react';
import Layout from '../../components/Layout';
import ActionMenu from '../../components/ActionMenu';
import ConfirmModal from '../../components/ConfirmModal';
import InviteUserModal from '../../components/InviteUserModal';
import EditUserNameModal from '../../components/EditUserNameModal';
import DeleteUserModal from '../../components/DeleteUserModal';
import { useAuth } from '../../hooks/useAuth';
import {
  useAllProfiles, useUpdateUserRole, useDeactivateUser,
  useReactivateUser, useRemoveUser,
} from '../../hooks/useUsers';
import { SUPERUSER_EMAIL } from '../../lib/supabase';
import { fmtDate, fmtRelTime, ErrorBanner } from '../shared';

const ROLES = ['admin', 'partner', 'sales', 'operations', 'compliance', 'analyst'];
const ROLE_LABELS = {
  admin: 'Admin', partner: 'Partner', sales: 'Sales',
  operations: 'Operations', compliance: 'Compliance', analyst: 'Analyst',
};

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function isSuper(email) {
  return !!(email && SUPERUSER_EMAIL && email.toLowerCase() === SUPERUSER_EMAIL.toLowerCase());
}

function UserAvatar({ name, email }) {
  const text  = (name || email || '?').trim();
  const letter = text[0].toUpperCase();
  const color  = AVATAR_COLORS[text.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>{letter}</div>
  );
}

function RoleBadge({ role }) {
  const colors = {
    admin:      'var(--accent)',
    partner:    '#7c3aed',
    sales:      'var(--green)',
    operations: '#d97706',
    compliance: '#0891b2',
    analyst:    'var(--text-tertiary)',
    pending:    'var(--red)',
  };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 600,
      color: colors[role] ?? 'var(--text-secondary)',
      background: `${colors[role]}18` ?? 'var(--bg-tertiary)',
      border: `1px solid ${colors[role]}40`,
      borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ── Pending section ───────────────────────────────────────────

function PendingSection({ profiles, onError }) {
  const [selectedRoles, setSelectedRoles] = useState({});
  const updateRole  = useUpdateUserRole();
  const deactivate  = useDeactivateUser();

  const setRole = (id, role) => setSelectedRoles(p => ({ ...p, [id]: role }));

  const handleActivate = async (user) => {
    const role = selectedRoles[user.id] || 'analyst';
    try {
      await updateRole.mutateAsync({ userId: user.id, role });
    } catch (e) { onError(e.message); }
  };

  const handleRemove = async (user) => {
    try {
      await deactivate.mutateAsync(user.id);
    } catch (e) { onError(e.message); }
  };

  if (!profiles.length) return null;

  return (
    <div style={{
      background: '#fffbeb', border: '1px solid #f59e0b',
      borderRadius: 8, marginBottom: 24, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>⏳</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#92400e' }}>
          Pending Approval ({profiles.length})
        </span>
        <span style={{ fontSize: 12.5, color: '#b45309', marginLeft: 4 }}>
          These users have signed up but cannot access the CRM.
        </span>
      </div>
      <div className="table-wrap" style={{ margin: 0, borderRadius: 0, border: 'none' }}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Signed Up</th>
              <th>Assign Role</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserAvatar name={u.full_name} email={u.email} />
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {u.full_name || '—'}
                    </span>
                  </div>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{u.email}</td>
                <td style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtRelTime(u.created_at)}</td>
                <td>
                  <select
                    value={selectedRoles[u.id] || 'analyst'}
                    onChange={e => setRole(u.id, e.target.value)}
                    className="form-input"
                    style={{ fontSize: 12.5, padding: '3px 8px', height: 'auto' }}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleActivate(u)}
                      disabled={updateRole.isPending}
                    >
                      Activate
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ color: 'var(--red)' }}
                      onClick={() => handleRemove(u)}
                      disabled={deactivate.isPending}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Active / Inactive user table ──────────────────────────────

function UserTable({ profiles, showSuperstar, onDeactivate, onReactivate, onRemove, onRoleChange, onEditName, onDeletePermanently, allowActions }) {
  const { session, isSuperuser } = useAuth();
  const selfId = session?.user?.id;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Last Sign In</th>
            <th>Status</th>
            {allowActions && <th style={{ textAlign: 'right' }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {profiles.map(u => {
            const superuser  = isSuper(u.email);
            const isSelf     = u.id === selfId;
            const isInactive = !u.is_active;

            return (
              <tr key={u.id} style={{ opacity: isInactive ? .55 : 1 }}>
                {/* User */}
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserAvatar name={u.full_name} email={u.email} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {u.full_name || '—'}
                        {isSelf && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6 }}>(you)</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>

                {/* Role */}
                <td>
                  {superuser ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <RoleBadge role="admin" />
                      <span style={{ fontSize: 12, color: 'var(--yellow)' }} title="Superuser">★</span>
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={e => onRoleChange(u.id, e.target.value)}
                      disabled={isInactive || !allowActions}
                      className="form-input"
                      style={{ fontSize: 12.5, padding: '3px 8px', height: 'auto', minWidth: 110 }}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  )}
                </td>

                {/* Last sign in */}
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {u.last_sign_in ? fmtRelTime(u.last_sign_in) : 'Never'}
                </td>

                {/* Status */}
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                    color: u.is_active ? 'var(--green)' : 'var(--text-tertiary)',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: u.is_active ? 'var(--green)' : 'var(--text-tertiary)', flexShrink: 0,
                    }} />
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>

                {/* Actions */}
                {allowActions && (
                  <td style={{ textAlign: 'right' }}>
                    {isInactive ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => onReactivate(u)}>
                        Reactivate
                      </button>
                    ) : superuser || isSelf ? null : (
                      <ActionMenu items={[
                        { label: 'Edit Name', onClick: () => onEditName(u) },
                        { label: 'Deactivate', onClick: () => onDeactivate(u) },
                        { label: 'Remove from System', danger: true, onClick: () => onRemove(u) },
                        ...(isSuperuser ? [
                          { label: 'Delete Permanently', danger: true, onClick: () => onDeletePermanently(u) },
                        ] : []),
                      ]} />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function Users() {
  const [showInvite,      setShowInvite]      = useState(false);
  const [showInactive,    setShowInactive]    = useState(false);
  const [confirm,         setConfirm]         = useState(null); // { type, user }
  const [editNameTarget,  setEditNameTarget]  = useState(null);
  const [deleteTarget,    setDeleteTarget]    = useState(null);
  const [errorMsg,        setErrorMsg]        = useState('');

  const profiles     = useAllProfiles();
  const updateRole   = useUpdateUserRole();
  const deactivate   = useDeactivateUser();
  const reactivate   = useReactivateUser();
  const removeUser   = useRemoveUser();

  const allProfiles = profiles.data ?? [];
  const pendingProfiles  = allProfiles.filter(p => p.role === 'pending' && p.is_active);
  const activeProfiles   = allProfiles.filter(p => p.role !== 'pending' && p.is_active);
  const inactiveProfiles = allProfiles.filter(p => !p.is_active);

  const handleRoleChange = async (userId, role) => {
    try {
      await updateRole.mutateAsync({ userId, role });
    } catch (e) { setErrorMsg(e.message); }
  };

  const handleDeactivateConfirm = async () => {
    try {
      await deactivate.mutateAsync(confirm.user.id);
      setConfirm(null);
    } catch (e) { setErrorMsg(e.message); }
  };

  const handleRemoveConfirm = async () => {
    try {
      await removeUser.mutateAsync(confirm.user.id);
      setConfirm(null);
    } catch (e) { setErrorMsg(e.message); }
  };

  const handleReactivate = async (user) => {
    try {
      await reactivate.mutateAsync(user.id);
    } catch (e) { setErrorMsg(e.message); }
  };

  return (
    <Layout title="User Management">
      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, maxWidth: 500 }}>
          Manage team access and roles. Invite new users and approve pending sign-ups.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>
          + Invite User
        </button>
      </div>

      {errorMsg && <ErrorBanner message={errorMsg} onRetry={() => setErrorMsg('')} />}
      {profiles.error && <ErrorBanner message={profiles.error.message} onRetry={profiles.refetch} />}

      {profiles.isLoading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
          Loading users…
        </div>
      ) : (
        <>
          {/* Pending approvals */}
          <PendingSection
            profiles={pendingProfiles}
            onError={setErrorMsg}
          />

          {/* Active users */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
              Active Users ({activeProfiles.length})
            </div>
            {activeProfiles.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No active users.
              </div>
            ) : (
              <UserTable
                profiles={activeProfiles}
                allowActions
                onRoleChange={handleRoleChange}
                onDeactivate={u => setConfirm({ type: 'deactivate', user: u })}
                onReactivate={handleReactivate}
                onRemove={u => setConfirm({ type: 'remove', user: u })}
                onEditName={u => setEditNameTarget(u)}
                onDeletePermanently={u => setDeleteTarget(u)}
              />
            )}
          </div>

          {/* Inactive users (collapsed) */}
          {inactiveProfiles.length > 0 && (
            <div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowInactive(v => !v)}
                style={{ marginBottom: 10 }}
              >
                {showInactive
                  ? `▾ Hide inactive (${inactiveProfiles.length})`
                  : `▸ Show inactive (${inactiveProfiles.length})`}
              </button>
              {showInactive && (
                <UserTable
                  profiles={inactiveProfiles}
                  allowActions
                  onRoleChange={handleRoleChange}
                  onDeactivate={u => setConfirm({ type: 'deactivate', user: u })}
                  onReactivate={handleReactivate}
                  onRemove={u => setConfirm({ type: 'remove', user: u })}
                  onEditName={u => setEditNameTarget(u)}
                  onDeletePermanently={u => setDeleteTarget(u)}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Invite modal */}
      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}

      {/* Edit name modal */}
      {editNameTarget && (
        <EditUserNameModal user={editNameTarget} onClose={() => setEditNameTarget(null)} />
      )}

      {/* Permanent delete modal (superuser only) */}
      {deleteTarget && (
        <DeleteUserModal user={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}

      {/* Confirm modals */}
      <ConfirmModal
        isOpen={confirm?.type === 'deactivate'}
        title="Deactivate user?"
        message={`${confirm?.user?.full_name || confirm?.user?.email} will immediately lose access to the CRM. You can reactivate them later.`}
        confirmLabel="Deactivate"
        confirmVariant="danger"
        loading={deactivate.isPending}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmModal
        isOpen={confirm?.type === 'remove'}
        title="Remove from system?"
        message={`This will permanently delete ${confirm?.user?.full_name || confirm?.user?.email}'s profile. They will need a new invitation to rejoin. This cannot be undone.`}
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={removeUser.isPending}
        onConfirm={handleRemoveConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}
