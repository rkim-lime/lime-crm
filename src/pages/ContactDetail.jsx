import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import ContactForm from '../components/ContactForm';
import LinkAccountModal from '../components/LinkAccountModal';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import TaskForm from '../components/TaskForm';
import LogActivityModal from '../components/LogActivityModal';
import { useIsAdmin } from '../components/RoleGate';
import { useContact, useContactAccounts, useUnlinkContactFromAccount, useDeleteContact, useArchiveContact } from '../hooks/useContacts';
import { useActivities } from '../hooks/useActivities';
import { useLeads } from '../hooks/useLeads';
import { TierBadge, SegmentBadge, StatusBadge, KycBadge, AssetPills, LeadScore, ActivityIcon, fmtRelTime, ErrorBanner } from './shared';
import { ScoreCard, ScoreHistoryMini } from '../components/ScoreCard';

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [editOpen, setEditOpen]     = useState(false);
  const [linkOpen, setLinkOpen]     = useState(false);
  const [taskOpen, setTaskOpen]     = useState(false);
  const [activityOpen, setActivity] = useState(false);
  const [confirm, setConfirm]       = useState(null);
  const isAdmin = useIsAdmin();

  const contact    = useContact(id);
  const accounts   = useContactAccounts(id);
  const activities = useActivities({ contact: id });
  const leads      = useLeads({ contact: id });
  const unlink     = useUnlinkContactFromAccount();
  const deleteContact  = useDeleteContact();
  const archiveContact = useArchiveContact();

  if (contact.isLoading) return <Layout title="Contact"><div style={{ padding: 24 }}><div className="skeleton skeleton-text" style={{ width: 200, height: 24 }} /></div></Layout>;
  if (contact.error)     return <Layout title="Contact"><div style={{ padding: 24 }}><ErrorBanner message={contact.error.message} onRetry={contact.refetch} /></div></Layout>;

  const c = contact.data;
  const name = `${c.first_name} ${c.last_name}`;
  const hasActiveLead = leads.data?.some(
    l => l.status === 'converted' ||
         ['activated', 'funded', 'first_trade', 'active'].includes(l.stage)
  ) ?? false;

  const handleConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === 'delete') {
      await deleteContact.mutateAsync(c.id);
      navigate('/contacts');
    } else {
      await archiveContact.mutateAsync(c.id);
    }
    setConfirm(null);
  };

  return (
    <Layout title={name}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/contacts')}>← Contacts</button>
        <TierBadge tier={c.tier} />
        <SegmentBadge segment={c.segment} />
        <StatusBadge status={c.status} />
        {c.tier === 'individual' && <LeadScore score={c.lead_score} />}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setActivity(true)}>Log Activity</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setTaskOpen(true)}>New Task</button>
        <RoleGate allow={['admin','sales']}>
          <button className="btn btn-secondary btn-sm" onClick={() => setLinkOpen(true)}>Link to Account</button>
        </RoleGate>
        <RoleGate allow={['admin','sales','operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>Edit</button>
        </RoleGate>
        {isAdmin && (
          <ActionMenu items={[
            { label: 'Archive', onClick: () => setConfirm({ type: 'archive' }) },
            { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'delete' }) },
          ]} />
        )}
      </div>

      <div className="detail-grid">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card card-body">
            <Field label="Title"       value={c.title} />
            <Field label="Email"       value={c.email} />
            <Field label="Phone"       value={c.phone} />
            <Field label="Mobile"      value={c.mobile} />
            <Field label="Tier"><TierBadge tier={c.tier} /></Field>
            <Field label="Jurisdiction" value={c.jurisdiction?.toUpperCase()} />
            <Field label="Country"     value={c.country} />
            <Field label="Timezone"    value={c.timezone} />
            <Field label="Source"      value={c.source} />
            <Field label="Asset classes"><AssetPills classes={c.asset_classes} /></Field>
            {c.programming_languages?.length > 0 && <Field label="Languages" value={c.programming_languages.join(', ')} />}
          </div>

          <div className="card card-body">
            <div className="detail-label" style={{ marginBottom: 8 }}>Compliance</div>
            <Field label="KYC status"          value={<KycBadge status={c.kyc_status} />} />
            <Field label="AML status"          value={<KycBadge status={c.aml_status} />} />
            <Field label="Accredited investor" value={c.accredited_investor == null ? '—' : c.accredited_investor ? 'Yes' : 'No'} />
            <Field label="FINRA registered"    value={c.finra_registered ? 'Yes' : 'No'} />
            <Field label="FINRA CRD"           value={c.finra_crd} mono />
          </div>

          {/* Contact health — individual with active/converted lead only */}
          {c.tier === 'individual' && hasActiveLead && (
            <>
              <ScoreCard scoreType="contact_health" record={c} />
              <ScoreHistoryMini recordType="contact" recordId={c.id} />
            </>
          )}

          {c.notes && (
            <div className="card card-body">
              <div className="detail-label">Notes</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>{c.notes}</p>
            </div>
          )}
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Linked accounts */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Linked Accounts</span>
              <RoleGate allow={['admin','sales']}>
                <button className="btn btn-ghost btn-sm" onClick={() => setLinkOpen(true)}>+ Link</button>
              </RoleGate>
            </div>
            <div style={{ padding: '0 18px 8px' }}>
              {accounts.isLoading && <div className="skeleton skeleton-text" style={{ margin: '12px 0' }} />}
              {accounts.data?.map(({ account, role, is_primary }) => (
                <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => navigate(`/accounts/${account.id}`)}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{account.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{role}</div>
                  </div>
                  <SegmentBadge segment={account.segment} />
                  {is_primary && <span className="badge" style={{ fontSize: 10.5 }}>Primary</span>}
                  <RoleGate allow={['admin','sales']}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--red)', fontSize: 11 }}
                      onClick={() => unlink.mutate({ contact_id: id, account_id: account.id })}
                    >Unlink</button>
                  </RoleGate>
                </div>
              ))}
              {!accounts.isLoading && !accounts.data?.length && <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>No linked accounts</div>}
            </div>
          </div>

          {/* Activity */}
          <div className="card">
            <div className="card-header"><span className="card-title">Activity</span></div>
            <div className="activity-feed">
              {activities.isLoading && <div className="skeleton skeleton-text" style={{ margin: 16 }} />}
              {activities.data?.map(act => (
                <div key={act.id} className="activity-item">
                  <div className={`activity-icon activity-icon-${act.type}`}><ActivityIcon type={act.type} /></div>
                  <div className="activity-body">
                    <div className="activity-title">{act.title}</div>
                    {act.body && <div className="activity-text">{act.body}</div>}
                    <div className="activity-time">{fmtRelTime(act.occurred_at)}</div>
                  </div>
                </div>
              ))}
              {!activities.isLoading && !activities.data?.length && <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 18px' }}>No activity yet</div>}
            </div>
          </div>
        </div>
      </div>

      {editOpen     && <ContactForm contact={c} onClose={() => setEditOpen(false)} onSuccess={() => setEditOpen(false)} />}
      {linkOpen     && <LinkAccountModal contactId={id} onClose={() => setLinkOpen(false)} onSuccess={() => setLinkOpen(false)} />}
      {taskOpen     && <TaskForm defaults={{ contact_id: id }} onClose={() => setTaskOpen(false)} />}
      {activityOpen && <LogActivityModal defaults={{ contact_id: id }} onClose={() => setActivity(false)} onSuccess={() => setActivity(false)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete ${name}?` : `Archive ${name}?`}
        message={
          confirm?.type === 'delete'
            ? `This will permanently remove the contact and all linked data. This cannot be undone.`
            : `This will set the contact status to unsubscribed.`
        }
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : 'Archive'}
        confirmVariant={confirm?.type === 'delete' ? 'danger' : 'warning'}
        loading={deleteContact.isPending || archiveContact.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}

function Field({ label, value, children, mono }) {
  const display = children ?? (value != null && value !== '' ? value : <span style={{ color: 'var(--text-tertiary)' }}>—</span>);
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value" style={mono ? { fontFamily: 'var(--mono)', fontSize: 12.5 } : {}}>{display}</div>
    </div>
  );
}
