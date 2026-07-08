import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import ConfirmModal from '../components/ConfirmModal';
import { useProspect, useUpdateProspect, useConvertProspectToAccount, useSourceRegistry, useSegmentTaxonomy, useSetRelevanceOverride, effectiveRelevance } from '../hooks/useProspects';
import { useProfiles } from '../hooks/useDashboard';
import { ErrorBanner, fmtDate, fmtRelTime, fmtProspectSource, fmtSegment, RelevanceBadge, RelevanceFlags, fmtServedFraction } from './shared';

const STATUS_OPTS = [
  { value: 'uncontacted',  label: 'Uncontacted' },
  { value: 'contacted',    label: 'Contacted' },
  { value: 'qualified',    label: 'Qualified' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'converted',    label: 'Converted' },
  { value: 'promoted',     label: 'Promoted' },
];

const STATUS_COLOR = {
  uncontacted:  'var(--text-tertiary)',
  contacted:    'var(--accent)',
  qualified:    'var(--green)',
  disqualified: 'var(--red)',
  converted:    '#7c3aed',
  promoted:     '#7c3aed',
};

function fmtAUM(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function StatusDot({ status }) {
  const color = STATUS_COLOR[status] ?? 'var(--text-tertiary)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {status?.replace(/_/g, ' ') ?? '—'}
    </span>
  );
}

function FitBar({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, color, minWidth: 28 }}>{score}</span>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' }}>{children ?? '—'}</span>
    </div>
  );
}

const CRITERION_LABELS = {
  aum_tier:             'AUM Tier',
  portfolio_turnover:   'Portfolio Turnover',
  equity_concentration: 'Equity Concentration',
  options_present:      'Options Activity',
  position_count:       'Position Count',
  filer_type:           'Filer Type',
};

function ScoreBreakdown({ breakdown }) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
        Score Breakdown
      </div>
      {entries.map(([key, val]) => {
        if (!val || typeof val !== 'object') return null;
        const { points = 0, weight = 0, ratio = 0 } = val;
        const label = CRITERION_LABELS[key] ?? key.replace(/_/g, ' ');
        const barColor = ratio >= 1 ? 'var(--green)' : ratio >= 0.5 ? 'var(--yellow)' : 'var(--red)';
        return (
          <div key={key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {points}/{weight} pts
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(ratio * 100)}%`, background: barColor, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, children, style }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
      borderRadius: 10, padding: '16px 18px', ...style,
    }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

const RELEVANCE_OVERRIDE_OPTS = [
  { value: '', label: 'Auto (no override)' },
  { value: 'relevant', label: 'Relevant' },
  { value: 'likely_relevant', label: 'Likely Relevant' },
  { value: 'suspect', label: 'Suspect' },
  { value: 'irrelevant', label: 'Irrelevant' },
  { value: 'unknown', label: 'Unknown' },
];

// Asset-class relevance explainability + reversible override control.
function RelevancePanel({ p }) {
  const setOverride = useSetRelevanceOverride();
  const eff = effectiveRelevance(p);
  const breakdown = p.asset_class_breakdown ?? null;
  const buckets = breakdown
    ? Object.entries(breakdown).sort((a, b) => (b[1]?.value ?? 0) - (a[1]?.value ?? 0))
    : [];

  return (
    <Panel title="Asset-Class Relevance">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <RelevanceBadge verdict={eff} overridden={!!p.asset_class_relevance_override} />
        <RelevanceFlags flags={p.asset_class_flags} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          served <strong>{fmtServedFraction(p.asset_class_served_fraction)}</strong>
        </span>
      </div>

      {buckets.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {buckets.map(([bucket, v]) => (
            <div key={bucket} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 3 }}>
              <span style={{ width: 74, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                {bucket.replace('_', ' ')}
              </span>
              <div style={{ flex: 1, height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((v?.fraction ?? 0) * 100)}%`, background: 'var(--accent)' }} />
              </div>
              <span style={{ width: 46, textAlign: 'right', color: 'var(--text-tertiary)' }}>
                {v?.fraction != null ? `${(v.fraction * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>Override</label>
        <select
          className="filter-select"
          value={p.asset_class_relevance_override ?? ''}
          disabled={setOverride.isPending}
          onChange={e => setOverride.mutate({ id: p.id, override: e.target.value || null })}
          style={{ fontSize: 12 }}
        >
          {RELEVANCE_OVERRIDE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {p.asset_class_relevance_override && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            auto: {p.asset_class_relevance ?? '—'}
          </span>
        )}
      </div>
    </Panel>
  );
}

export default function ProspectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft]       = useState('');
  const [convertConfirm, setConvertConfirm] = useState(false);

  const prospect         = useProspect(id);
  const profiles         = useProfiles();
  const update           = useUpdateProspect();
  const convert          = useConvertProspectToAccount();
  const { data: registry = [] } = useSourceRegistry();
  const { data: segmentValues = [] } = useSegmentTaxonomy();

  if (prospect.isLoading) {
    return (
      <Layout title="Prospect">
        <div style={{ padding: 24 }}>
          <div className="skeleton skeleton-text" style={{ width: 240, height: 24 }} />
        </div>
      </Layout>
    );
  }
  if (prospect.error) {
    console.error('ProspectDetail error:', prospect.error);
    return (
      <Layout title="Prospect">
        <div style={{ padding: 24 }}>
          <ErrorBanner message={prospect.error.message} onRetry={prospect.refetch} />
        </div>
      </Layout>
    );
  }

  const p = prospect.data;

  // Guard against undefined data — can occur in React 18 Concurrent Mode
  // between state transitions where isLoading flips before data is committed.
  if (!p) {
    return (
      <Layout title="Prospect">
        <div style={{ padding: 24 }}>
          <div className="skeleton skeleton-text" style={{ width: 240, height: 24 }} />
        </div>
      </Layout>
    );
  }

  const filings = [...(p.filings ?? [])].sort(
    (a, b) => (b.period_of_report ?? '').localeCompare(a.period_of_report ?? '')
  );
  const latestScore = (p.scores ?? [])[0];

  const handleStatusChange = (e) => {
    update.mutate({ id: p.id, status: e.target.value });
  };

  const handleAssigneeChange = (e) => {
    update.mutate({ id: p.id, assigned_to: e.target.value || null });
  };

  const handleSaveNotes = () => {
    update.mutate({ id: p.id, notes: noteDraft }, {
      onSuccess: () => setEditingNotes(false),
    });
  };

  const handleConvert = async () => {
    const account = await convert.mutateAsync({ prospect: p });
    setConvertConfirm(false);
    navigate(`/accounts/${account.id}`);
  };

  return (
    <Layout title={p.firm_name}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/prospects')}>
          ← Prospects
        </button>
        <StatusDot status={p.status} />
        {p.source && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>
            {fmtProspectSource(p.source, registry)}
          </span>
        )}
        <span style={{ flex: 1 }} />

        {p.status !== 'promoted' && p.status !== 'converted' && (
          <RoleGate allow={['admin', 'sales', 'operations']}>
            <button
              className="btn btn-primary btn-sm"
              style={{ background: '#7c3aed' }}
              onClick={() => setConvertConfirm(true)}
            >
              Convert to Account →
            </button>
          </RoleGate>
        )}
        {(p.status === 'promoted' || p.status === 'converted') && (
          <span style={{ fontSize: 12.5, color: '#7c3aed', fontWeight: 600 }}>✓ Promoted to Account</span>
        )}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Signals panel */}
          <Panel title="Portfolio Signals">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <DetailRow label="AUM (est.)">{fmtAUM(p.estimated_aum_usd)}</DetailRow>
              <DetailRow label="Positions">{p.position_count ?? '—'}</DetailRow>
              <DetailRow label="Equities %">{fmtPct(p.equities_pct)}</DetailRow>
              <DetailRow label="Turnover">{fmtPct(p.portfolio_turnover_pct)}</DetailRow>
              <DetailRow label="Options">
                {p.options_present
                  ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Yes</span>
                  : <span style={{ color: 'var(--text-tertiary)' }}>No</span>}
              </DetailRow>
              <DetailRow label="Segment">
                {fmtSegment(p.segment_canonical, segmentValues)}
              </DetailRow>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6 }}>Fit Score</div>
              <FitBar score={p.fit_score} />
              {p.fit_score_computed_at && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  computed {fmtRelTime(p.fit_score_computed_at)}
                </div>
              )}
            </div>

            {/* Score breakdown from latest run */}
            <ScoreBreakdown breakdown={latestScore?.breakdown} />
          </Panel>

          {/* Asset-class relevance (eligibility) */}
          <RelevancePanel p={p} />

          {/* Filings */}
          <Panel title={`13F Filings (${filings.length})`}>
            {filings.length === 0 ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '8px 0' }}>No filings ingested yet</div>
            ) : (
              <div className="table-wrap" style={{ margin: '0 -18px', marginTop: -4, borderRadius: '0 0 10px 10px', border: 'none', boxShadow: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Filed</th>
                      <th>AUM</th>
                      <th>Holdings</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filings.map(f => (
                      <tr key={f.id}>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{f.period_of_report ?? '—'}</td>
                        <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{f.filed_at ?? '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{fmtAUM(f.total_value_usd)}</td>
                        <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{f.holding_count ?? '—'}</td>
                        <td>
                          {f.source_url && (
                            <a
                              href={f.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 12, color: 'var(--accent)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              EDGAR ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status & assignment */}
          <Panel title="Management">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Status</label>
                <select
                  className="filter-select"
                  style={{ width: '100%' }}
                  value={p.status}
                  onChange={handleStatusChange}
                  disabled={update.isPending}
                >
                  {STATUS_OPTS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Assigned To</label>
                <select
                  className="filter-select"
                  style={{ width: '100%' }}
                  value={p.assigned_to ?? ''}
                  onChange={handleAssigneeChange}
                  disabled={update.isPending}
                >
                  <option value="">Unassigned</option>
                  {(profiles.data ?? []).map(pr => (
                    <option key={pr.id} value={pr.id}>{pr.full_name || pr.email}</option>
                  ))}
                </select>
              </div>
            </div>
          </Panel>

          {/* Metadata */}
          <Panel title="Details">
            <DetailRow label="Firm">{p.firm_name}</DetailRow>
            {p.cik && (
              <DetailRow label="CIK">
                <a
                  href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${p.cik}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  {p.cik} ↗
                </a>
              </DetailRow>
            )}
            <DetailRow label="Source">
              {fmtProspectSource(p.source, registry)}
            </DetailRow>
            <DetailRow label="Jurisdiction">
              {p.jurisdiction?.toUpperCase() ?? '—'}
            </DetailRow>
            <DetailRow label="Added">{fmtDate(p.created_at)}</DetailRow>
            <DetailRow label="Last updated">{fmtRelTime(p.updated_at)}</DetailRow>
          </Panel>

          {/* Notes */}
          <Panel title="Notes">
            {editingNotes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  rows={5}
                  style={{
                    width: '100%', resize: 'vertical', fontSize: 13,
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 10px', color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveNotes} disabled={update.isPending}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingNotes(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                {p.notes ? (
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {p.notes}
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0, fontStyle: 'italic' }}>No notes</p>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 10, paddingLeft: 0 }}
                  onClick={() => { setNoteDraft(p.notes ?? ''); setEditingNotes(true); }}
                >
                  {p.notes ? 'Edit notes' : '+ Add notes'}
                </button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Convert confirm modal */}
      <ConfirmModal
        isOpen={convertConfirm}
        title="Convert to Account"
        message={`Create an Account record for "${p.firm_name}" and mark this prospect as converted?`}
        confirmLabel="Convert"
        confirmVariant="warning"
        onConfirm={handleConvert}
        onCancel={() => setConvertConfirm(false)}
        loading={convert.isPending}
      />
    </Layout>
  );
}
