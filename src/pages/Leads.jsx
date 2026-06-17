import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import LeadForm from '../components/LeadForm';
import { useLeads, useOrphanedConversions } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useDashboard';
import { useAuth } from '../hooks/useAuth.jsx';
import { AssetPills, TierBadge, OwnerName, fmtDate, fmtRelTime, TableSkeleton, ErrorBanner } from './shared';

const INDIVIDUAL_STAGES = [
  { value: 'visitor',     label: 'Visitor' },
  { value: 'lead',        label: 'Lead' },
  { value: 'nurture',     label: 'Nurture' },
  { value: 'activated',   label: 'Activated' },
  { value: 'funded',      label: 'Funded' },
  { value: 'first_trade', label: 'First Trade' },
  { value: 'active',      label: 'Active Trader' },
  { value: 'dormant',     label: 'Dormant' },
  { value: 'churned',     label: 'Churned' },
];

const STATUS_OPTS = [
  { value: '',          label: 'All Statuses' },
  { value: 'active',    label: 'Active' },
  { value: 'converted', label: 'Converted' },
  { value: 'churned',   label: 'Churned' },
  { value: 'dormant',   label: 'Dormant' },
];

const SOURCE_OPTS = [
  { value: '',               label: 'All Sources' },
  { value: 'web_signup',     label: 'Web Sign-up' },
  { value: 'referral',       label: 'Referral' },
  { value: 'paid_social',    label: 'Paid Social' },
  { value: 'google_ads',     label: 'Google Ads' },
  { value: 'conference',     label: 'Conference' },
  { value: 'organic_search', label: 'Organic Search' },
  { value: 'partner',        label: 'Partner' },
  { value: 'other',          label: 'Other' },
];

const STAGE_LABELS = {
  visitor: 'Visitor', lead: 'Lead', nurture: 'Nurture',
  activated: 'Activated', funded: 'Funded', first_trade: 'First Trade',
  active: 'Active Trader', dormant: 'Dormant', churned: 'Churned',
};

const STATUS_COLOR = {
  active:    'var(--green)',
  converted: 'var(--accent)',
  churned:   'var(--red)',
  dormant:   'var(--text-tertiary)',
};

function ScorePill({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 72 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 22, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

export default function Leads() {
  const navigate = useNavigate();
  const [leadForm, setLeadForm]   = useState(false);
  const [statusFilter, setStatus] = useState('active');
  const [stageFilter, setStage]   = useState('');
  const [ownerFilter, setOwner]   = useState('');
  const [sourceFilter, setSource] = useState('');
  const [myOwner, setMyOwner]     = useState(false);

  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  const filters = {};
  if (statusFilter) filters.status  = statusFilter;
  if (stageFilter)  filters.stage   = stageFilter;
  if (ownerFilter)  filters.owner   = ownerFilter;
  if (sourceFilter) filters.source  = sourceFilter;
  if (myOwner && currentUserId) filters.myOwner = currentUserId;

  const { data, isLoading, error, refetch } = useLeads(filters);
  const orphaned = useOrphanedConversions();
  const profiles  = useProfiles();

  return (
    <Layout title="Leads">
      {/* Orphaned conversion warning */}
      {(orphaned.data?.length ?? 0) > 0 && (
        <div
          style={{
            marginBottom: 16, padding: '10px 14px', background: '#fffbeb',
            border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <span style={{ color: '#92400e' }}>
            ⚠ {orphaned.data.length} lead{orphaned.data.length > 1 ? 's' : ''} marked converted with no linked deal.
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/reports/lead-hygiene')}>
            Review →
          </button>
        </div>
      )}

      {/* Filters bar */}
      <div className="filters-bar">
        <select className="filter-select" value={statusFilter} onChange={e => setStatus(e.target.value)}>
          {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-select" value={stageFilter} onChange={e => setStage(e.target.value)}>
          <option value="">All Stages</option>
          {INDIVIDUAL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="filter-select" value={sourceFilter} onChange={e => setSource(e.target.value)}>
          {SOURCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-select" value={ownerFilter} onChange={e => { setOwner(e.target.value); setMyOwner(false); }}>
          <option value="">All Sales Owners</option>
          {(profiles.data ?? []).map(p => (
            <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
          ))}
        </select>
        <button
          className={`btn btn-sm${myOwner ? ' btn-primary' : ' btn-secondary'}`}
          onClick={() => { setMyOwner(v => !v); setOwner(''); }}
        >
          My Leads {myOwner && data ? `(${data.length})` : ''}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" disabled title="Coming soon">Export</button>
        <RoleGate allow={['admin', 'sales', 'operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setLeadForm(true)}>+ New Lead</button>
        </RoleGate>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? (
        <TableSkeleton cols={7} rows={8} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Source</th>
                <th>Lead Score</th>
                <th>Asset Classes</th>
                <th>Sales Owner</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map(lead => {
                const name = lead.contact
                  ? `${lead.contact.first_name} ${lead.contact.last_name}`
                  : '—';
                return (
                  <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}>
                    <td>
                      <div className="table-name">{name}</div>
                      <div className="table-sub">{lead.contact?.email}</div>
                    </td>
                    <td>
                      <span className={`badge badge-${lead.stage}`}>
                        {STAGE_LABELS[lead.stage] ?? lead.stage}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: STATUS_COLOR[lead.status] }}>
                        {lead.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {lead.source?.replace(/_/g, ' ') ?? '—'}
                    </td>
                    <td><ScorePill score={lead.lead_score} /></td>
                    <td><AssetPills classes={lead.asset_classes} /></td>
                    <td><span style={{ fontSize: 13 }}><OwnerName profile={lead.sales_owner} /></span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtRelTime(lead.created_at)}</td>
                  </tr>
                );
              })}
              {!isLoading && (data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No leads found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {leadForm && (
        <LeadForm onClose={() => setLeadForm(false)} onSuccess={() => setLeadForm(false)} />
      )}
    </Layout>
  );
}
