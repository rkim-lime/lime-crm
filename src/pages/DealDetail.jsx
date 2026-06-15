import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import DealForm from '../components/DealForm';
import LogActivityModal from '../components/LogActivityModal';
import TaskForm from '../components/TaskForm';
import { useIsAdmin } from '../components/RoleGate';
import { useDeal, useUpdateDeal, useDeleteDeal, useCloseDeal } from '../hooks/useDeals';
import { useTasks } from '../hooks/useTasks';
import { useActivities } from '../hooks/useActivities';
import { ScoreCard, ScoreHistoryMini } from '../components/ScoreCard';
import DealTeamPanel from '../components/DealTeamPanel';
import {
  TierBadge, StageBadge, AssetPills, KycBadge, ActivityIcon,
  fmtCurrency, fmtDate, fmtRelTime, ErrorBanner,
} from './shared';

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' }}>{children ?? '—'}</span>
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

const PROB_COLOR = p => p >= 70 ? 'var(--green)' : p >= 40 ? 'var(--yellow)' : 'var(--text-secondary)';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin  = useIsAdmin();

  const [editOpen, setEditOpen]     = useState(false);
  const [activityOpen, setActivity] = useState(false);
  const [taskOpen, setTaskOpen]     = useState(false);
  const [confirm, setConfirm]       = useState(null);

  const deal       = useDeal(id);
  const tasks      = useTasks({ account: deal.data?.account_id });
  const activities = useActivities({ account: deal.data?.account_id });
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();
  const closeDeal  = useCloseDeal();

  if (deal.isLoading) {
    return (
      <Layout title="Deal">
        <div style={{ padding: 24 }}>
          <div className="skeleton skeleton-text" style={{ width: 220, height: 24 }} />
        </div>
      </Layout>
    );
  }
  if (deal.error) {
    return (
      <Layout title="Deal">
        <div style={{ padding: 24 }}>
          <ErrorBanner message={deal.error.message} onRetry={deal.refetch} />
        </div>
      </Layout>
    );
  }

  const d = deal.data;
  const acc = d.account ?? {};
  const con = d.contact ?? {};

  const handleConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === 'delete') {
      await deleteDeal.mutateAsync(d.id);
      navigate('/deals');
    } else if (confirm.type === 'won') {
      await closeDeal.mutateAsync({ id: d.id, outcome: 'live' });
    } else if (confirm.type === 'lost') {
      await closeDeal.mutateAsync({ id: d.id, outcome: 'lost' });
    }
    setConfirm(null);
  };

  const openTasks = tasks.data?.filter(t => t.status !== 'completed') ?? [];

  const needsServiceManager = ['onboarding', 'live'].includes(d.stage) && d.account?.id && !d.account?.service_manager_id;

  return (
    <Layout title={d.name}>
      {needsServiceManager && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ color: '#d97706', fontWeight: 600 }}>⚠ This account needs a Service Manager before going Live</span>
          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
          <a href={`/accounts/${d.account.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>Go to Account →</a>
        </div>
      )}
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/deals')}>← Deals</button>
        <TierBadge tier={d.tier} />
        <StageBadge stage={d.stage} />
        {d.probability != null && (
          <span style={{ fontSize: 13, fontWeight: 600, color: PROB_COLOR(d.probability) }}>
            {d.probability}%
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setActivity(true)}>Log Activity</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setTaskOpen(true)}>New Task</button>
        <RoleGate allow={['admin','sales','operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>Edit</button>
        </RoleGate>
        {isAdmin && (
          <ActionMenu items={[
            { label: 'Close Won',  onClick: () => setConfirm({ type: 'won' }) },
            { label: 'Close Lost', onClick: () => setConfirm({ type: 'lost' }) },
            { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'delete' }) },
          ]} />
        )}
      </div>

      <div className="detail-grid">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card card-body">
            <DetailRow label="Stage"><StageBadge stage={d.stage} /></DetailRow>
            <DetailRow label="Tier"><TierBadge tier={d.tier} /></DetailRow>
            <DetailRow label="Probability">
              <span style={{ fontWeight: 600, color: PROB_COLOR(d.probability) }}>
                {d.probability != null ? `${d.probability}%` : null}
              </span>
            </DetailRow>
            <DetailRow label="Est. Commission">{fmtCurrency(d.estimated_commission)}</DetailRow>
            <DetailRow label="Est. ADV">{d.estimated_adv_usd ? fmtCurrency(d.estimated_adv_usd) : null}</DetailRow>
            <DetailRow label="Close Date">{fmtDate(d.close_date)}</DetailRow>
            <DetailRow label="Asset Classes">
              <AssetPills classes={d.asset_classes} />
            </DetailRow>
            <DetailRow label="Sales Owner">
              {d.sales_owner ? (d.sales_owner.full_name || d.sales_owner.email) : null}
            </DetailRow>
          </div>

          <div className="card card-body">
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>
              Infrastructure
            </div>
            <DetailRow label="Order Routing">
              {(d.order_routing ?? []).join(', ') || null}
            </DetailRow>
            <DetailRow label="Colocation">{d.colo ? 'Yes' : 'No'}</DetailRow>
            <DetailRow label="Market Data">{d.market_data ? 'Yes' : 'No'}</DetailRow>
            <DetailRow label="Hosting">{d.hosting ? 'Yes' : 'No'}</DetailRow>
            <DetailRow label="Cross-Connect">{d.cross_connect ? 'Yes' : 'No'}</DetailRow>
          </div>

          {acc.id && (
            <div className="card card-body">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>
                Account Signals
              </div>
              <DetailRow label="AUM">
                {acc.aum_usd ? `$${(acc.aum_usd / 1e9).toFixed(2)}B` : null}
              </DetailRow>
              <DetailRow label="ADV">
                {acc.avg_daily_volume_usd ? `$${(acc.avg_daily_volume_usd / 1e6).toFixed(0)}M` : null}
              </DetailRow>
              <DetailRow label="KYC"><KycBadge status={acc.kyc_status} /></DetailRow>
            </div>
          )}

          {/* Deal Score */}
          <ScoreCard scoreType="deal" record={d} />
          <ScoreHistoryMini recordType="deal" recordId={d.id} />

          {d.notes && (
            <div className="card card-body">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>Notes</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{d.notes}</p>
            </div>
          )}
          {d.lost_reason && (
            <div className="card card-body" style={{ borderLeft: '3px solid var(--red)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>Lost Reason</div>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{d.lost_reason}</p>
              {d.competitor && (
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 6 }}>Competitor: {d.competitor}</div>
              )}
            </div>
          )}
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {acc.id && (
            <Section title="Account">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}
                onClick={() => navigate(`/accounts/${acc.id}`)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>{acc.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{acc.segment}</div>
                </div>
                <TierBadge tier={acc.tier} />
              </div>
            </Section>
          )}

          {con.id && (
            <Section title="Contact">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}
                onClick={() => navigate(`/contacts/${con.id}`)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>
                    {con.first_name} {con.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{con.title ?? con.email}</div>
                </div>
                <TierBadge tier={con.tier} />
              </div>
            </Section>
          )}

          <DealTeamPanel dealId={d.id} />

          <Section title="Open Tasks" count={openTasks.length}>
            {tasks.isLoading ? <Skel /> : openTasks.length === 0 ? <Empty text="No open tasks" /> : openTasks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ flex: 1, fontSize: 13.5 }}>{t.title}</div>
                <span className={`badge badge-${t.priority}`}>{t.priority}</span>
              </div>
            ))}
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

      {editOpen     && <DealForm deal={d} onClose={() => setEditOpen(false)} onSuccess={() => setEditOpen(false)} />}
      {taskOpen     && <TaskForm defaults={{ account_id: d.account_id }} onClose={() => setTaskOpen(false)} />}
      {activityOpen && <LogActivityModal defaults={{ account_id: d.account_id }} onClose={() => setActivity(false)} onSuccess={() => setActivity(false)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete ${d.name}?` : confirm?.type === 'won' ? 'Mark as Closed Won?' : 'Mark as Closed Lost?'}
        message={
          confirm?.type === 'delete'
            ? 'This will permanently remove the deal. This cannot be undone.'
            : confirm?.type === 'won'
            ? `"${d.name}" will be moved to the live stage.`
            : `"${d.name}" will be marked as closed lost.`
        }
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : confirm?.type === 'won' ? 'Close Won' : 'Close Lost'}
        confirmVariant={confirm?.type === 'delete' || confirm?.type === 'lost' ? 'danger' : 'warning'}
        loading={deleteDeal.isPending || closeDeal.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}
