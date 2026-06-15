import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAccounts } from '../hooks/useAccounts';
import { useDeals } from '../hooks/useDeals';
import { useContacts } from '../hooks/useContacts';
import { useActivities } from '../hooks/useActivities';
import { useLeads, useLeadMetrics, useOrphanedConversions } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useDashboard';
import { SegmentBadge, StageBadge, AssetPills, LeadScore, StatusBadge, fmtCurrency, fmtRelTime, ActivityIcon } from './shared';

// ── Stage definitions ─────────────────────────────────────────────────────────
const B2B_STAGES = [
  { key: 'prospecting',      label: 'Prospecting' },
  { key: 'qualified',        label: 'Qualified' },
  { key: 'proposal',         label: 'Proposal' },
  { key: 'legal_compliance', label: 'Legal & Comp.' },
  { key: 'negotiating',      label: 'Negotiating' },
  { key: 'onboarding',       label: 'Onboarding' },
  { key: 'live',             label: 'Live' },
  { key: 'lost',             label: 'Lost' },
];

const IND_STAGES = [
  { key: 'visitor',     label: 'Visitor' },
  { key: 'lead',        label: 'Lead' },
  { key: 'nurture',     label: 'Nurture' },
  { key: 'activated',   label: 'Activated' },
  { key: 'funded',      label: 'Funded' },
  { key: 'first_trade', label: '1st Trade' },
  { key: 'active',      label: 'Active' },
  { key: 'dormant',     label: 'Dormant' },
  { key: 'churned',     label: 'Churned' },
];

const B2B_CLOSED = ['live', 'lost'];

// ── Tier accent colors ────────────────────────────────────────────────────────
const TIER_COLOR = {
  enterprise: 'var(--tier-enterprise)',
  pro:        'var(--tier-pro)',
  individual: 'var(--tier-individual)',
};

const AMBER = [
  '#fef3c7','#fde68a','#fcd34d','#fbbf24',
  '#f59e0b','#d97706','#b45309','#92400e','#78350f',
];

// ── Root component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab]               = useState('enterprise');
  const [ownerFilter, setOwnerFilter] = useState('');
  const navigate  = useNavigate();
  const profiles  = useProfiles();
  const owner     = ownerFilter || null;

  return (
    <Layout title="Dashboard">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
        <div style={{ display: 'flex' }}>
          {[['enterprise','Enterprise'],['pro','Pro'],['individual','Individual']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 18px 10px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13.5, fontWeight: tab === key ? 600 : 450,
                color: tab === key ? TIER_COLOR[key] : 'var(--text-secondary)',
                borderBottom: `2px solid ${tab === key ? TIER_COLOR[key] : 'transparent'}`,
                transition: 'color .12s',
              }}
            >{label}</button>
          ))}
        </div>
        <div style={{ marginBottom: 8 }}>
          <select className="filter-select" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="">All Sales Owners</option>
            {(profiles.data ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.full_name || p.email || 'Unnamed'}</option>
            ))}
          </select>
        </div>
      </div>

      {tab === 'enterprise' && <EnterpriseTab owner={owner} navigate={navigate} />}
      {tab === 'pro'        && <ProTab        owner={owner} navigate={navigate} />}
      {tab === 'individual' && <IndividualTab owner={owner} navigate={navigate} />}
    </Layout>
  );
}

// ── Enterprise Tab ────────────────────────────────────────────────────────────
function EnterpriseTab({ owner, navigate }) {
  const deals      = useDeals({ tier: 'enterprise', owner });
  const accounts   = useAccounts({ tier: 'enterprise', owner });
  const activities = useActivities({ limit: 8 });
  const color      = TIER_COLOR.enterprise;

  const allDeals      = deals.data ?? [];
  const openDeals     = allDeals.filter(d => !B2B_CLOSED.includes(d.stage));
  const totalPipeline = openDeals.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);
  const inProgress    = allDeals.filter(d => !['prospecting', ...B2B_CLOSED].includes(d.stage)).length;
  const avgProb       = openDeals.length
    ? Math.round(openDeals.reduce((s, d) => s + (d.probability ?? 0), 0) / openDeals.length)
    : 0;
  const activeAccounts = (accounts.data ?? []).filter(a => a.status === 'active').length;

  const byAcct = {};
  allDeals.forEach(d => {
    if (!d.account_id) return;
    if (!byAcct[d.account_id]) byAcct[d.account_id] = { commission: 0, stage: d.stage, touch: d.created_at };
    byAcct[d.account_id].commission += d.estimated_commission ?? 0;
    if ((d.created_at ?? '') > (byAcct[d.account_id].touch ?? '')) {
      byAcct[d.account_id].stage = d.stage;
      byAcct[d.account_id].touch = d.created_at;
    }
  });
  const topAccounts = [...(accounts.data ?? [])]
    .sort((a, b) => (byAcct[b.id]?.commission ?? 0) - (byAcct[a.id]?.commission ?? 0))
    .slice(0, 10)
    .map(a => ({ ...a, _stage: byAcct[a.id]?.stage ?? null, _touch: byAcct[a.id]?.touch ?? a.created_at }));

  return (
    <>
      <div className="metrics-grid">
        <MetricCard label="Total Pipeline Value" value={fmtCurrency(totalPipeline)} loading={deals.isLoading} color={color} />
        <MetricCard label="Active Accounts"      value={activeAccounts}             loading={accounts.isLoading} color={color} />
        <MetricCard label="Deals in Progress"    value={inProgress}                 loading={deals.isLoading} color={color} />
        <MetricCard label="Avg Deal Probability" value={`${avgProb}%`}              loading={deals.isLoading} color={color} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 284px', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
        <MiniKanban stages={B2B_STAGES} deals={allDeals} isLoading={deals.isLoading} color={color} onNavigate={() => navigate('/pipeline/enterprise')} />
        <div className="card">
          <div className="card-header"><span className="card-title">Recent Activity</span></div>
          <ActivityFeed activities={activities} />
        </div>
      </div>

      <SectionLabel>Top Enterprise Accounts</SectionLabel>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Account</th><th>Segment</th><th>AUM</th><th>Current Stage</th><th>Assets</th><th>Last Touch</th></tr>
          </thead>
          <tbody>
            {accounts.isLoading ? <SkeletonTR cols={6} /> : topAccounts.map(a => (
              <tr key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                <td><div className="table-name">{a.name}</div><div className="table-sub">{a.jurisdiction?.toUpperCase()}</div></td>
                <td><SegmentBadge segment={a.segment} /></td>
                <td style={{ fontSize: 13 }}>{a.aum_usd ? `$${(a.aum_usd / 1e9).toFixed(2)}B` : <Dash />}</td>
                <td>{a._stage ? <StageBadge stage={a._stage} /> : <Dash />}</td>
                <td><AssetPills classes={a.asset_classes} /></td>
                <td style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtRelTime(a._touch)}</td>
              </tr>
            ))}
            {!accounts.isLoading && topAccounts.length === 0 && <EmptyTR cols={6} text="No enterprise accounts" />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Pro Tab ───────────────────────────────────────────────────────────────────
function ProTab({ owner, navigate }) {
  const deals      = useDeals({ tier: 'pro', owner });
  const accounts   = useAccounts({ tier: 'pro', owner });
  const contacts   = useContacts({ tier: 'pro' });
  const activities = useActivities({ limit: 8 });
  const color      = TIER_COLOR.pro;

  const allDeals      = deals.data ?? [];
  const openDeals     = allDeals.filter(d => !B2B_CLOSED.includes(d.stage));
  const totalPipeline = openDeals.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);
  const inProgress    = allDeals.filter(d => !['prospecting', ...B2B_CLOSED].includes(d.stage)).length;
  const activeAccounts = (accounts.data ?? []).filter(a => a.status === 'active').length;

  const allContacts = contacts.data ?? [];
  const scored      = allContacts.filter(c => c.lead_score != null);
  const avgLeadScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + c.lead_score, 0) / scored.length)
    : 0;

  const topContacts = [...allContacts]
    .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
    .slice(0, 10);

  return (
    <>
      <div className="metrics-grid">
        <MetricCard label="Total Pipeline Value"  value={fmtCurrency(totalPipeline)} loading={deals.isLoading} color={color} />
        <MetricCard label="Active Pro Accounts"   value={activeAccounts}             loading={accounts.isLoading} color={color} />
        <MetricCard label="Deals in Progress"     value={inProgress}                 loading={deals.isLoading} color={color} />
        <MetricCard label="Avg Lead Score"        value={avgLeadScore}               loading={contacts.isLoading} color={color} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 284px', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
        <MiniKanban stages={B2B_STAGES} deals={allDeals} isLoading={deals.isLoading} color={color} onNavigate={() => navigate('/pipeline/pro')} />
        <div className="card">
          <div className="card-header"><span className="card-title">Recent Activity</span></div>
          <ActivityFeed activities={activities} />
        </div>
      </div>

      <SectionLabel>Top Pro Contacts</SectionLabel>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Segment</th><th>Assets</th><th>Order Routing</th><th>Lead Score</th><th>Status</th></tr>
          </thead>
          <tbody>
            {contacts.isLoading ? <SkeletonTR cols={6} /> : topContacts.map(c => (
              <tr key={c.id} onClick={() => navigate(`/contacts/${c.id}`)}>
                <td><div className="table-name">{c.first_name} {c.last_name}</div><div className="table-sub">{c.title}</div></td>
                <td><SegmentBadge segment={c.segment} /></td>
                <td><AssetPills classes={c.asset_classes} /></td>
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.order_routing?.length ? c.order_routing.join(', ') : <Dash />}</td>
                <td><LeadScore score={c.lead_score} /></td>
                <td><StatusBadge status={c.status} /></td>
              </tr>
            ))}
            {!contacts.isLoading && topContacts.length === 0 && <EmptyTR cols={6} text="No pro contacts" />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Individual Tab ────────────────────────────────────────────────────────────
function IndividualTab({ owner, navigate }) {
  const metrics    = useLeadMetrics();
  const leads      = useLeads(owner ? { owner } : {});
  const orphaned   = useOrphanedConversions();
  const activities = useActivities({ limit: 8 });
  const color      = TIER_COLOR.individual;

  const m           = metrics.data;
  const byStage     = m?.byStage ?? {};
  const orphanCount = orphaned.data?.length ?? 0;

  // Top leads sorted by lead_score desc
  const topLeads = [...(leads.data ?? [])]
    .filter(l => l.status === 'active')
    .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
    .slice(0, 10);

  return (
    <>
      {/* Orphaned conversions warning */}
      {orphanCount > 0 && (
        <div
          onClick={() => navigate('/reports/lead-hygiene')}
          style={{
            marginBottom: 16, padding: '10px 16px',
            background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
            fontSize: 13, color: '#92400e', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span>⚠</span>
          <span>
            <strong>{orphanCount}</strong> lead{orphanCount > 1 ? 's' : ''} marked converted with no linked deal.
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 500 }}>Review →</span>
        </div>
      )}

      <div className="metrics-grid">
        <MetricCard label="Active Leads"   value={m?.totalLeads ?? '—'}    loading={metrics.isLoading} color={color} />
        <MetricCard label="Activated"      value={m?.activated ?? '—'}     loading={metrics.isLoading} color={color} />
        <MetricCard label="Funded"         value={m?.funded ?? '—'}        loading={metrics.isLoading} color={color} />
        <MetricCard label="Active Traders" value={m?.activeTraders ?? '—'} loading={metrics.isLoading} color={color} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 284px', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Individual Funnel</div>
          {metrics.isLoading
            ? IND_STAGES.map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="skeleton skeleton-text" style={{ width: 80 }} />
                  <div className="skeleton skeleton-text" style={{ flex: 1 }} />
                  <div className="skeleton skeleton-text" style={{ width: 24 }} />
                </div>
              ))
            : IND_STAGES.map(({ key, label }, i) => {
                const count    = byStage[key] ?? 0;
                const maxCount = Math.max(...IND_STAGES.map(s => byStage[s.key] ?? 0), 1);
                const prevCount = i > 0 ? (byStage[IND_STAGES[i - 1].key] ?? 0) : null;
                const conv      = prevCount != null && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 74, fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 500, textAlign: 'right', flexShrink: 0 }}>{label}</div>
                    <div style={{ width: 38, fontSize: 10.5, color: 'var(--text-tertiary)', textAlign: 'center', flexShrink: 0 }}>
                      {conv != null ? `${conv}%↓` : ''}
                    </div>
                    <div style={{ flex: 1, height: 22, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                        background: AMBER[i],
                        borderRadius: 4,
                        minWidth: count > 0 ? 4 : 0,
                        transition: 'width .3s',
                      }} />
                    </div>
                    <div style={{ width: 28, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0 }}>{count}</div>
                  </div>
                );
              })
          }
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Recent Activity</span></div>
          <ActivityFeed activities={activities} />
        </div>
      </div>

      <SectionLabel>Top Individual Leads</SectionLabel>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Stage</th><th>Assets</th><th>Lead Score</th><th>Source</th></tr>
          </thead>
          <tbody>
            {leads.isLoading ? <SkeletonTR cols={5} /> : topLeads.map(lead => (
              <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}>
                <td>
                  <div className="table-name">
                    {lead.contact ? `${lead.contact.first_name} ${lead.contact.last_name}` : '—'}
                  </div>
                  <div className="table-sub">{lead.contact?.email}</div>
                </td>
                <td><span className={`badge badge-${lead.stage}`}>{lead.stage?.replace(/_/g, ' ')}</span></td>
                <td><AssetPills classes={lead.asset_classes} /></td>
                <td><LeadScore score={lead.lead_score} /></td>
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {lead.source?.replace(/_/g, ' ') ?? '—'}
                </td>
              </tr>
            ))}
            {!leads.isLoading && topLeads.length === 0 && <EmptyTR cols={5} text="No individual leads" />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function MetricCard({ label, value, loading, color }) {
  return (
    <div className="metric-card" style={{ borderTop: `2px solid ${color}` }}>
      <div className="metric-label">{label}</div>
      {loading
        ? <div className="skeleton skeleton-text" style={{ width: 80, height: 28, marginTop: 4 }} />
        : <div className="metric-value">{value ?? '—'}</div>
      }
    </div>
  );
}

function MiniKanban({ stages, deals, isLoading, color, onNavigate }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Pipeline</span>
        <button className="btn btn-ghost btn-sm" onClick={onNavigate}>Full view →</button>
      </div>
      <div className="kanban-board" style={{ paddingBottom: 4 }}>
        {stages.map(({ key, label }) => {
          const col = deals.filter(d => d.stage === key);
          return (
            <div key={key} style={{ minWidth: 172, width: 172, flexShrink: 0 }}>
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color, fontSize: 10.5 }}>{label}</span>
                <span className="kanban-col-count">{col.length}</span>
              </div>
              {isLoading
                ? <div className="skeleton skeleton-card" style={{ height: 70 }} />
                : col.length === 0
                  ? <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'center', padding: '10px 4px' }}>—</div>
                  : col.map(d => <MiniDealCard key={d.id} deal={d} color={color} onClick={onNavigate} />)
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniDealCard({ deal, color, onClick }) {
  return (
    <div
      className="kanban-card"
      style={{ padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }}
      onClick={e => { e.stopPropagation(); onClick(); }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
        {deal.account?.name ?? deal.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
          {deal.close_date ? new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{fmtCurrency(deal.estimated_commission)}</span>
      </div>
      <div style={{ height: 3, background: 'var(--bg-tertiary)', borderRadius: 2 }}>
        <div style={{ height: 3, background: color, width: `${deal.probability ?? 0}%`, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function ActivityFeed({ activities }) {
  if (activities.isLoading) {
    return (
      <div style={{ padding: '6px 0' }}>
        {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-row" style={{ margin: '1px 0' }} />)}
      </div>
    );
  }
  if (!activities.data?.length) {
    return <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No recent activity</div>;
  }
  return (
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
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>{children}</div>;
}

function SkeletonTR({ cols, rows = 4 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }, (_, j) => (
        <td key={j}><div className="skeleton skeleton-text" style={{ width: j === 0 ? 140 : 70 }} /></td>
      ))}
    </tr>
  ));
}

function EmptyTR({ cols, text }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-tertiary)', fontSize: 13 }}>
        {text}
      </td>
    </tr>
  );
}

function Dash() {
  return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
}
