import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import AccountForm from '../components/AccountForm';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import TaskForm from '../components/TaskForm';
import LogActivityModal from '../components/LogActivityModal';
import DocumentUpload from '../components/DocumentUpload';
import AssignServiceManagerModal from '../components/AssignServiceManagerModal';
import AssignOwnerModal from '../components/AssignOwnerModal';
import { useIsAdmin } from '../components/RoleGate';
import { useAccount, useAccountContacts, useDeleteAccount, useArchiveAccount } from '../hooks/useAccounts';
import { useDeals } from '../hooks/useDeals';
import { useTasks } from '../hooks/useTasks';
import { useActivities } from '../hooks/useActivities';
import { TierBadge, SegmentBadge, StatusBadge, KycBadge, AssetPills, StageBadge, ActivityIcon, fmtCurrency, fmtRelTime, fmtDate, ErrorBanner } from './shared';
import { ScoreCard, ScoreHistoryMini } from '../components/ScoreCard';

const TABS = ['Overview', 'Documents'];

const ORDER_ROUTING_LABELS = { sor: 'Smart Order Routing', dma: 'Direct Market Access', commission_free: 'Commission-Free' };
function fmtOrderRouting(arr) {
  if (!arr?.length) return null;
  const label = ORDER_ROUTING_LABELS[arr[0]];
  return label ?? null;
}

export default function AccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tab, setTab]               = useState('Overview');
  const [editOpen, setEditOpen]     = useState(false);
  const [taskOpen, setTaskOpen]     = useState(false);
  const [activityOpen, setActivity] = useState(false);
  const [confirm, setConfirm]       = useState(null); // { type: 'delete'|'archive' }
  const [assignSmOpen, setAssignSmOpen]   = useState(false);
  const [assignSoOpen, setAssignSoOpen]   = useState(false);
  const isAdmin = useIsAdmin();

  const account    = useAccount(id);
  const contacts   = useAccountContacts(id);
  const deleteAccount  = useDeleteAccount();
  const archiveAccount = useArchiveAccount();
  const deals      = useDeals({ account: id });
  const tasks      = useTasks({ account: id });
  const activities = useActivities({ account: id });

  // All hooks must be called before any conditional return
  const hasOverdueTasks = useMemo(() =>
    (tasks.data ?? []).some(
      t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()
    ),
  [tasks.data]);
  const daysSinceActivity = useMemo(() => {
    const latest = (activities.data ?? [])[0];
    if (!latest) return null;
    return Math.floor((Date.now() - new Date(latest.occurred_at)) / 86_400_000);
  }, [activities.data]);
  const scoreExtraParams = useMemo(
    () => ({ hasOverdueTasks, daysSinceActivity }),
    [hasOverdueTasks, daysSinceActivity],
  );

  if (account.isLoading) return <Layout title="Account"><div style={{ padding: 24 }}><div className="skeleton skeleton-text" style={{ width: 200, height: 24 }} /></div></Layout>;
  if (account.error) return <Layout title="Account"><div style={{ padding: 24 }}><ErrorBanner message={account.error.message} onRetry={account.refetch} /></div></Layout>;

  const a = account.data;

  const handleConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === 'delete') {
      await deleteAccount.mutateAsync(a.id);
      navigate('/accounts');
    } else {
      await archiveAccount.mutateAsync(a.id);
    }
    setConfirm(null);
  };

  return (
    <Layout title={a?.name ?? 'Account'}>
      {/* Header row */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/accounts')}>← Accounts</button>
        <TierBadge tier={a.tier} />
        <SegmentBadge segment={a.segment} />
        <StatusBadge status={a.status} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setActivity(true)}>Log Activity</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setTaskOpen(true)}>New Task</button>
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

      {/* Ownership warnings */}
      {!a.sales_owner_id && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ color: '#d97706', fontWeight: 600 }}>⚠ No Sales Owner assigned</span>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAssignSoOpen(true)}>Assign Now</button>
        </div>
      )}
      {!a.service_manager_id && ['active', 'onboarding'].includes(a.status) && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ color: '#d97706', fontWeight: 600 }}>⚠ This account needs a Service Manager assigned — required for active and onboarding accounts</span>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }} onClick={() => setAssignSmOpen(true)}>Assign Now</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button
            key={t}
            className="btn btn-ghost btn-sm"
            style={{ borderRadius: '4px 4px 0 0', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--text-secondary)' }}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="detail-grid">
          {/* Left: account fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card card-body">
              <Field label="Legal entity"   value={a.legal_entity_name} />
              <Field label="LEI"            value={a.lei} mono />
              <Field label="MPID"           value={a.mpid} mono />
              <Field label="CRD number"     value={a.crd_number} mono />
              <Field label="Jurisdiction"   value={a.jurisdiction?.toUpperCase()} />
              <Field label="Tier"><TierBadge tier={a.tier} /></Field>
              <Field label="Order routing"  value={fmtOrderRouting(a.order_routing)} />
              <Field label="ADV (USD)"      value={a.avg_daily_volume_usd ? `$${(a.avg_daily_volume_usd/1e6).toFixed(0)}M` : null} />
              <Field label="AUM (USD)"      value={a.aum_usd ? `$${(a.aum_usd/1e9).toFixed(2)}B` : null} />
              <Field label="Website"        value={a.website} link />
              <Field label="Asset classes"><AssetPills classes={a.asset_classes} /></Field>
              <Field label="Sales Owner">
                {a.sales_owner
                  ? <span style={{ fontWeight: 500 }}>{a.sales_owner.full_name || a.sales_owner.email}</span>
                  : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
              </Field>
              <Field label="Service Manager">
                {a.service_manager ? (
                  <span style={{ fontWeight: 500 }}>{a.service_manager.full_name || a.service_manager.email}</span>
                ) : ['active', 'onboarding'].includes(a.status) ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#d97706', fontWeight: 500, fontSize: 12.5 }}>⚠ Service Manager required</span>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setAssignSmOpen(true)}>Assign</button>
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>Not yet assigned</span>
                )}
              </Field>
            </div>

            <div className="card card-body">
              <div className="detail-label" style={{ marginBottom: 8 }}>Infrastructure</div>
              <Field label="Colocation"     value={a.colo          ? 'Yes' : 'No'} />
              <Field label="Market Data"    value={a.market_data   ? 'Yes' : 'No'} />
              <Field label="Hosting"        value={a.hosting       ? 'Yes' : 'No'} />
              <Field label="Cross-Connect"  value={a.cross_connect ? 'Yes' : 'No'} />
            </div>

            <div className="card card-body">
              <div className="detail-label" style={{ marginBottom: 8 }}>Compliance</div>
              <Field label="KYC status"          value={<KycBadge status={a.kyc_status} />} />
              <Field label="AML status"          value={<KycBadge status={a.aml_status} />} />
              <Field label="KYC approved"        value={fmtDate(a.kyc_approved_at)} />
              <Field label="Accredited investor" value={a.accredited_investor == null ? '—' : a.accredited_investor ? 'Yes' : 'No'} />
              <Field label="FINRA member"        value={a.finra_member ? 'Yes' : 'No'} />
            </div>

            {/* Account health score — enterprise only */}
            {a.tier === 'enterprise' && (
              <>
                <ScoreCard scoreType="account_health" record={a} extraParams={scoreExtraParams} />
                <ScoreHistoryMini recordType="account" recordId={a.id} />
              </>
            )}

            {a.notes && (
              <div className="card card-body">
                <div className="detail-label">Notes</div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>{a.notes}</p>
              </div>
            )}
          </div>

          {/* Right: related data */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Section title="Contacts" count={contacts.data?.length}>
              {contacts.isLoading ? <Skel /> : contacts.data?.map(({ contact, role, is_primary }) => (
                <div key={contact.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                  onClick={() => navigate(`/contacts/${contact.id}`)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{contact.first_name} {contact.last_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{contact.title ?? role}</div>
                  </div>
                  <StatusBadge status={contact.status} />
                  {is_primary && <span className="badge" style={{ fontSize: 10.5 }}>Primary</span>}
                </div>
              ))}
              {!contacts.isLoading && !contacts.data?.length && <Empty text="No contacts linked" />}
            </Section>

            <Section title="Deals" count={deals.data?.length}>
              {deals.isLoading ? <Skel /> : deals.data?.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                  onClick={() => navigate(`/deals/${d.id}`)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{d.name}</div>
                  </div>
                  <StageBadge stage={d.stage} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtCurrency(d.estimated_commission)}</span>
                </div>
              ))}
              {!deals.isLoading && !deals.data?.length && <Empty text="No deals" />}
            </Section>

            <Section title="Open Tasks" count={tasks.data?.filter(t => t.status !== 'completed').length}>
              {tasks.isLoading ? <Skel /> : tasks.data?.filter(t => t.status !== 'completed').map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1, fontSize: 13.5 }}>{t.title}</div>
                  <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                </div>
              ))}
              {!tasks.isLoading && !tasks.data?.filter(t => t.status !== 'completed').length && <Empty text="No open tasks" />}
            </Section>

            <Section title="Activity">
              {activities.isLoading ? <Skel /> : (
                <div className="activity-feed">
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
                  {!activities.data?.length && <Empty text="No activity yet" />}
                </div>
              )}
            </Section>
          </div>
        </div>
      )}

      {tab === 'Documents' && (
        <div style={{ maxWidth: 720 }}>
          <DocumentUpload accountId={id} />
        </div>
      )}

      {editOpen     && <AccountForm account={a} onClose={() => setEditOpen(false)} onSuccess={() => setEditOpen(false)} />}
      {assignSmOpen && <AssignServiceManagerModal account={a} onClose={() => setAssignSmOpen(false)} />}
      {assignSoOpen && (
        <AssignOwnerModal
          recordType="account"
          recordId={a.id}
          fieldName="sales_owner_id"
          title={`Assign Sales Owner — ${a.name}`}
          currentOwnerId={a.sales_owner_id}
          onClose={() => setAssignSoOpen(false)}
        />
      )}
      {taskOpen     && <TaskForm defaults={{ account_id: id }} onClose={() => setTaskOpen(false)} />}
      {activityOpen && <LogActivityModal defaults={{ account_id: id }} onClose={() => setActivity(false)} onSuccess={() => setActivity(false)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete ${a.name}?` : `Archive ${a.name}?`}
        message={
          confirm?.type === 'delete'
            ? `This will permanently remove the account and all linked data. This cannot be undone.`
            : `This will set the account status to inactive.`
        }
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : 'Archive'}
        confirmVariant={confirm?.type === 'delete' ? 'danger' : 'warning'}
        loading={deleteAccount.isPending || archiveAccount.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}

function Field({ label, value, children, mono, link }) {
  const display = children ?? (value != null && value !== '' ? value : <span style={{ color: 'var(--text-tertiary)' }}>—</span>);
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value" style={mono ? { fontFamily: 'var(--mono)', fontSize: 12.5 } : {}}>
        {link && typeof value === 'string' ? <a href={value} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{value}</a> : display}
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        {count != null && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '1px 8px', borderRadius: 99 }}>{count}</span>}
      </div>
      <div style={{ padding: '0 18px 8px' }}>{children}</div>
    </div>
  );
}

function Skel() { return <div className="skeleton skeleton-text" style={{ margin: '12px 0', width: '70%' }} />; }
function Empty({ text }) { return <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>{text}</div>; }
