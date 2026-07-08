// Shared display helpers used across pages

// ── Prospect source labels ────────────────────────────────────────────────────
// Labels come from the source_registry table (loaded via useSourceRegistry).
// Pass the registry array from that hook; falls back to title-casing the raw
// key so anything not yet in the registry still renders cleanly.
export function fmtProspectSource(source, registry = []) {
  if (!source) return '—';
  const entry = registry.find(r => r.source_key === source);
  if (entry) return entry.display_label;
  return source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Prospect segment labels ───────────────────────────────────────────────────
// Labels are the single source of truth in taxonomy_values.label (loaded via
// useSegmentTaxonomy). Pass that array; falls back to title-casing the raw
// value_key so any unlabeled/legacy key still renders cleanly.
export function fmtSegment(key, segmentValues = []) {
  if (!key) return '—';
  const hit = segmentValues.find(s => s.value_key === key);
  if (hit?.label) return hit.label;
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Asset-class relevance ─────────────────────────────────────────────────────
const RELEVANCE_META = {
  relevant:        { label: 'Relevant',        color: 'var(--green)',          bg: 'rgba(34,197,94,0.12)' },
  likely_relevant: { label: 'Likely Relevant', color: 'var(--accent)',         bg: 'rgba(59,130,246,0.12)' },
  suspect:         { label: 'Suspect',         color: '#d97706',               bg: '#fffbeb' },
  irrelevant:      { label: 'Irrelevant',      color: 'var(--red)',            bg: 'rgba(239,68,68,0.12)' },
  unknown:         { label: 'Unknown',         color: 'var(--text-tertiary)',  bg: 'var(--bg-tertiary)' },
};

export function RelevanceBadge({ verdict, overridden = false }) {
  if (!verdict) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const m = RELEVANCE_META[verdict] ?? { label: verdict, color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
  return (
    <span
      title={overridden ? 'Human override' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 20,
        fontSize: 11.5, fontWeight: 600, color: m.color, background: m.bg, whiteSpace: 'nowrap',
      }}
    >
      {m.label}{overridden ? ' ✎' : ''}
    </span>
  );
}

export function RelevanceFlags({ flags }) {
  if (!flags) return null;
  const pills = [];
  if (flags.possible_hft) pills.push(['🎯 possible HFT', '#7c3aed', 'Large AUM but tiny/empty 13F — prioritize enrichment']);
  if (flags.review)       pills.push(['⚠ review', '#d97706', flags.adv_name_flag ? `name flag: ${flags.adv_name_flag}` : 'review']);
  if (!pills.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {pills.map(([txt, color, title]) => (
        <span key={txt} title={title} style={{ fontSize: 10.5, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{txt}</span>
      ))}
    </span>
  );
}

export function fmtServedFraction(f) {
  if (f == null) return '—';
  return `${(f * 100).toFixed(1)}%`;
}

// Is this prospect gated? effective verdict's action === 'gate' (config-driven).
export function isGated(prospect, verdictActions = []) {
  const eff = prospect?.asset_class_relevance_override ?? prospect?.asset_class_relevance;
  if (!eff) return false;
  const row = verdictActions.find(v => v.verdict === eff);
  return row?.action === 'gate';
}

export function TierBadge({ tier }) {
  if (!tier) return null;
  return <span className={`badge badge-tier-${tier}`}>{tier}</span>;
}

export function SegmentBadge({ segment }) {
  if (!segment) return null;
  const labels = {
    hft_firm:        'HFT Firm',
    hedge_fund:      'Hedge Fund',
    quant_fund:      'Quant Fund',
    broker_dealer:   'Broker-Dealer',
    family_office:   'Family Office',
    prime_broker:    'Prime Broker',
    prop_trader:     'Prop Trader',
    quant_developer: 'Quant Dev',
    algo_trader:     'Algo Trader',
    retail_trader:   'Retail',
  };
  return <span className={`badge badge-${segment}`}>{labels[segment] ?? segment}</span>;
}

export function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge badge-${status}`}>{status.replace(/_/g, ' ')}</span>;
}

export function StageBadge({ stage }) {
  if (!stage) return null;
  const labels = {
    // Institutional pipeline
    prospecting:       'Prospecting',
    qualified:         'Qualified',
    proposal:          'Proposal',
    legal_compliance:  'Legal & Compliance',
    negotiating:       'Negotiating',
    onboarding:        'Onboarding',
    live:              'Live',
    lost:              'Lost',
    // Individual lifecycle (legacy deal stage names)
    lead_in:      'Lead In',
    engaged:      'Engaged',
    api_demo:     'API Demo',
    kyc_submitted:'KYC Submitted',
    kyc_approved: 'KYC Approved',
    funded:       'Funded',
    first_trade:  'First Trade',
    active_trader:'Active Trader',
    dormant:      'Dormant',
    // Individual lead stages (leads table)
    visitor:      'Visitor',
    lead:         'Lead',
    nurture:      'Nurture',
    activated:    'Activated',
    active:       'Active Trader',
    churned:      'Churned',
  };
  return <span className={`badge badge-${stage}`}>{labels[stage] ?? stage}</span>;
}

export function KycBadge({ status }) {
  if (!status) return null;
  return <span className={`badge badge-${status}`}>{status.replace(/_/g, ' ')}</span>;
}

export function AssetPills({ classes }) {
  if (!classes?.length) return null;
  const map = { equities: 'EQ', options: 'OPT', futures: 'FUT' };
  return (
    <div className="asset-pills">
      {classes.map(c => <span key={c} className={`asset-pill asset-${c}`}>{map[c] ?? c}</span>)}
    </div>
  );
}

export function ActivityIcon({ type }) {
  const icons = {
    email: '✉', call: '📞', meeting: '🤝', note: '📝',
    deal_stage_change: '⬆', document_uploaded: '📄',
    task_completed: '✓', onboarding_step: '🚀',
  };
  return <span style={{ fontSize: 13 }}>{icons[type] ?? '•'}</span>;
}

export function fmtCurrency(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function fmtRelTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)    return 'just now';
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LeadScore({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>;
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

export function TableSkeleton({ cols = 5, rows = 6 }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{Array.from({ length: cols }, (_, i) => <th key={i}><div className="skeleton skeleton-text" style={{ width: 60 }} /></th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }, (_, j) => (
                <td key={j}><div className="skeleton skeleton-text" style={{ width: j === 0 ? 160 : 80 }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-state">
      <span style={{ flex: 1 }}>Error: {message}</span>
      {onRetry && <button className="btn btn-sm btn-secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function EmptyState({ icon = '○', text }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-text">{text}</div>
    </div>
  );
}

export function OwnerName({ profile }) {
  if (!profile || !profile.full_name) {
    return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Deleted User</span>;
  }
  return <span>{profile.full_name}</span>;
}

const RELEVANT_ASSET_LABELS = {
  equities:     'Equities',
  options:      'Options',
  futures:      'Futures',
  crypto:       'Crypto',
  fixed_income: 'Fixed Income',
  fx:           'FX',
  other:        'Other',
};

const RELEVANT_ASSET_STYLES = {
  equities:     { background: '#E6F1FB', color: '#185FA5' },
  options:      { background: '#EAF3DE', color: '#3B6D11' },
  futures:      { background: '#FAEEDA', color: '#854F0B' },
  crypto:       { background: '#F3E8FF', color: '#6B21A8' },
  fixed_income: { background: '#E0F2FE', color: '#0369A1' },
  fx:           { background: '#FFF7ED', color: '#C2410C' },
  other:        { background: '#F1F5F9', color: '#475569' },
};

export function RelevantAssetPill({ value }) {
  const style = RELEVANT_ASSET_STYLES[value] || RELEVANT_ASSET_STYLES.other;
  const label = RELEVANT_ASSET_LABELS[value] || value;
  return (
    <span style={{
      ...style,
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: '500',
      display: 'inline-block',
      marginRight: '4px',
      marginBottom: '2px',
    }}>
      {label}
    </span>
  );
}

export function RelevantAssetPills({ classes = [] }) {
  if (!classes || classes.length === 0)
    return <span style={{ color: '#888', fontSize: '12px' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
      {classes.map(c => <RelevantAssetPill key={c} value={c} />)}
    </div>
  );
}

const UPSELL_SUPPORTED = ['equities', 'options', 'futures'];

export function UpsellGapPills({ relevantClasses = [], soldClasses = [] }) {
  const gap = (relevantClasses || []).filter(c =>
    UPSELL_SUPPORTED.includes(c) && !(soldClasses || []).includes(c)
  );
  if (gap.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
      {gap.map(c => (
        <span key={c} style={{
          background: '#FAEEDA',
          color: '#854F0B',
          border: '1px dashed #EF9F27',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: '500',
          display: 'inline-block',
        }}>
          ↑ {RELEVANT_ASSET_LABELS[c] || c}
        </span>
      ))}
    </div>
  );
}
