import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import LogActivityModal from '../components/LogActivityModal';
import TaskForm from '../components/TaskForm';
import LeadForm from '../components/LeadForm';
import ConvertLeadModal from '../components/ConvertLeadModal';
import { useIsAdmin } from '../components/RoleGate';
import { useLead, useUpdateLead, useDeleteLead } from '../hooks/useLeads';
import { useActivities } from '../hooks/useActivities';
import { ScoreCard, ScoreHistoryMini } from '../components/ScoreCard';
import {
  TierBadge, AssetPills, ActivityIcon,
  fmtDate, fmtRelTime, fmtCurrency, ErrorBanner,
} from './shared';

const STAGE_LABELS = {
  visitor: 'Visitor', lead: 'Lead', nurture: 'Nurture',
  activated: 'Activated', funded: 'Funded', first_trade: 'First Trade',
  active: 'Active Trader', dormant: 'Dormant', churned: 'Churned',
};

const STATUS_LABELS = {
  active: 'Active', converted: 'Converted', churned: 'Churned', dormant: 'Dormant',
};

const STATUS_COLOR = {
  active:    'var(--green)',
  converted: 'var(--accent)',
  churned:   'var(--red)',
  dormant:   'var(--text-tertiary)',
};

function StageBadgeInd({ stage }) {
  if (!stage) return null;
  return <span className={`badge badge-${stage}`}>{STAGE_LABELS[stage] ?? stage}</span>;
}

function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600,
      color: STATUS_COLOR[status], background: 'transparent', gap: 4,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ScoreBar({ score }) {
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--text-tertiary)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score ?? 0}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 28 }}>{score ?? 0}</span>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' }}>{children ?? '—'}</span>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [editOpen, setEditOpen]       = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [taskOpen, setTaskOpen]       = useState(false);
  const [activityOpen, setActivity]   = useState(false);
  const [showUtm, setShowUtm]         = useState(false);
  const [confirm, setConfirm]         = useState(null);
  const isAdmin = useIsAdmin();

  const lead       = useLead(id);
  const activities = useActivities({ contact: lead.data?.contact_id });
  const update     = useUpdateLead();
  const del        = useDeleteLead();

  if (lead.isLoading) {
    return (
      <Layout title="Lead">
        <div style={{ padding: 24 }}>
          <div className="skeleton skeleton-text" style={{ width: 220, height: 24 }} />
        </div>
      </Layout>
    );
  }
  if (lead.error) {
    return (
      <Layout title="Lead">
        <div style={{ padding: 24 }}>
          <ErrorBanner message={lead.error.message} onRetry={lead.refetch} />
        </div>
      </Layout>
    );
  }

  const l = lead.data;
  const contactName = l.contact
    ? `${l.contact.first_name} ${l.contact.last_name}`
    : 'Unknown contact';

  const handleDelete = async () => {
    await del.mutateAsync(l.id);
    navigate('/leads');
  };

  const handleArchive = async () => {
    await update.mutateAsync({ id: l.id, _prevStatus: l.status, status: 'dormant' });
    setConfirm(null);
  };

  return (
    <Layout title={contactName}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')}>← Leads</button>
        <StageBadgeInd stage={l.stage} />
        <StatusBadge status={l.status} />
        <TierBadge tier="individual" />
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setActivity(true)}>Log Activity</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setTaskOpen(true)}>Add Task</button>
        <RoleGate allow={['admin', 'sales', 'operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>Edit</button>
          {l.status !== 'converted' && (
            <button
              className="btn btn-primary btn-sm"
              style={{ background: 'var(--tier-pro)' }}
              onClick={() => setConvertOpen(true)}
            >
              Convert →
            </button>
          )}
        </RoleGate>
        {isAdmin && (
          <ActionMenu items={[
            { label: 'Archive (Dormant)', onClick: () => setConfirm({ type: 'archive' }) },
            { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'delete' }) },
          ]} />
        )}
      </div>

      <div className="detail-grid">
        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Details */}
          <div className="card card-body">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Lead Details</span>
            </div>
            <DetailRow label="Contact">
              <Link to={`/contacts/${l.contact_id}`} style={{ color: 'var(--accent)' }}>{contactName}</Link>
            </DetailRow>
            <DetailRow label="Email">{l.contact?.email}</DetailRow>
            <DetailRow label="Stage"><StageBadgeInd stage={l.stage} /></DetailRow>
            <DetailRow label="Status"><StatusBadge status={l.status} /></DetailRow>
            <DetailRow label="Source">{l.source?.replace(/_/g, ' ')}</DetailRow>
            <DetailRow label="Sales Owner">{l.sales_owner?.full_name ?? 'Unassigned'}</DetailRow>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Asset Classes</div>
              <AssetPills classes={l.asset_classes} />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 12.5, color: l.uses_rest_api ? 'var(--green)' : 'var(--text-tertiary)' }}>
                {l.uses_rest_api ? '✓' : '✗'} REST API
              </span>
              <span style={{ fontSize: 12.5, color: l.uses_fix ? 'var(--green)' : 'var(--text-tertiary)' }}>
                {l.uses_fix ? '✓' : '✗'} FIX
              </span>
            </div>
            {l.programming_languages?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Languages</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {l.programming_languages.map(lang => (
                    <span key={lang} style={{ fontSize: 12, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-tertiary)', padding: '8px 0 0', textAlign: 'left' }}
              onClick={() => setShowUtm(v => !v)}
            >
              {showUtm ? '▾' : '▸'} UTM fields
            </button>
            {showUtm && (
              <div style={{ marginTop: 4 }}>
                {[
                  ['UTM Source', l.utm_source],
                  ['UTM Medium', l.utm_medium],
                  ['UTM Campaign', l.utm_campaign],
                  ['UTM Content', l.utm_content],
                  ['UTM Term', l.utm_term],
                ].map(([label, val]) => val ? <DetailRow key={label} label={label}>{val}</DetailRow> : null)}
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className="card card-body">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Milestones</span>
            </div>
            <DetailRow label="Activated">{fmtDate(l.activated_at)}</DetailRow>
            <DetailRow label="First Funded">{fmtDate(l.first_funded_at)}</DetailRow>
            <DetailRow label="First Trade">{fmtDate(l.first_trade_at)}</DetailRow>
            {l.churned_at && <DetailRow label="Churned">{fmtDate(l.churned_at)}</DetailRow>}
            <DetailRow label="Funded Amount">{fmtCurrency(l.funded_amount)}</DetailRow>
          </div>

          {/* Conversion card — only when converted */}
          {l.status === 'converted' && (
            <div className="card card-body" style={{ borderLeft: '3px solid var(--accent)' }}>
              <div className="card-header" style={{ marginBottom: 8 }}>
                <span className="card-title">Conversion</span>
              </div>
              <DetailRow label="Converted At">{fmtDate(l.converted_at)}</DetailRow>
              <DetailRow label="Converted To">
                {l.converted_to_tier ? <TierBadge tier={l.converted_to_tier} /> : '—'}
              </DetailRow>
              <DetailRow label="Linked Deal">
                {l.converted_to_deal_id ? (
                  <Link to={`/deals/${l.converted_to_deal_id}`} style={{ color: 'var(--accent)' }}>
                    View Deal →
                  </Link>
                ) : (
                  <span style={{ color: 'var(--yellow)', fontSize: 12.5 }}>
                    ⚠ No deal linked
                  </span>
                )}
              </DetailRow>
              {!l.converted_to_deal_id && (
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConvertOpen(true)}
                  >
                    Create Deal
                  </button>
                </div>
              )}
              {l.conversion_notes && (
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {l.conversion_notes}
                </div>
              )}
            </div>
          )}

          {/* Score breakdown */}
          <ScoreCard scoreType="lead" record={l} />
          <ScoreHistoryMini recordType="lead" recordId={l.id} />

          {/* Notes */}
          {l.notes && (
            <div className="card card-body">
              <div className="card-title" style={{ marginBottom: 8 }}>Notes</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{l.notes}</p>
            </div>
          )}
        </div>

        {/* ── Right column: Activity ── */}
        <div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Activity</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setActivity(true)}>Log Activity</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setTaskOpen(true)}>Add Task</button>
              </div>
            </div>
            {activities.isLoading ? (
              <div style={{ padding: '6px 0' }}>
                {[1,2,3].map(i => <div key={i} className="skeleton skeleton-row" style={{ margin: '1px 0' }} />)}
              </div>
            ) : !activities.data?.length ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No activity yet
              </div>
            ) : (
              <div className="activity-feed">
                {activities.data.map(a => (
                  <div key={a.id} className="activity-item">
                    <div className={`activity-icon activity-icon-${a.type}`}><ActivityIcon type={a.type} /></div>
                    <div className="activity-body">
                      <div className="activity-title">{a.title}</div>
                      {a.body && <div className="activity-text">{a.body}</div>}
                      <div className="activity-time">{fmtRelTime(a.occurred_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editOpen && (
        <LeadForm lead={l} onClose={() => setEditOpen(false)} onSuccess={() => setEditOpen(false)} />
      )}
      {convertOpen && (
        <ConvertLeadModal lead={l} onClose={() => setConvertOpen(false)} />
      )}
      {taskOpen && (
        <TaskForm defaultContactId={l.contact_id} onClose={() => setTaskOpen(false)} onSuccess={() => setTaskOpen(false)} />
      )}
      {activityOpen && (
        <LogActivityModal defaultContactId={l.contact_id} onClose={() => setActivity(false)} />
      )}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete this lead?` : 'Archive lead?'}
        message={confirm?.type === 'delete'
          ? 'This cannot be undone.'
          : 'This will mark the lead as dormant.'}
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : 'Archive'}
        confirmVariant="danger"
        loading={del.isPending || update.isPending}
        onConfirm={confirm?.type === 'delete' ? handleDelete : handleArchive}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}
