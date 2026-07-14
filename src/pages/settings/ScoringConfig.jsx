import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import Layout from '../../components/Layout';
import { useScoringConfig, useUpdateScoringConfig, useRecalculateScores } from '../../hooks/useScoringConfig';
import { computeScore } from '../../lib/scoring';
import { useLeads } from '../../hooks/useLeads';
import { useAccounts } from '../../hooks/useAccounts';
import { useContacts } from '../../hooks/useContacts';
import { useDeals } from '../../hooks/useDeals';
import { useProspects, useProspect } from '../../hooks/useProspects';
import { fmtRelTime, ErrorBanner } from '../shared';
import { useICPConfig, useUpdateICPConfig } from '../../hooks/useDedup';
import { useIsAdmin } from '../../components/RoleGate';
import { RelevanceConfigPanel, SegmentsConfigPanel, MatcherConfigPanel, ChangeLogPanel } from './ConfigSurfaces';

const TAB_GROUPS = [
  { label: 'Enterprise & Pro', types: ['deal', 'account_health'] },
  { label: 'Individual',       types: ['lead', 'contact_health'] },
  { label: 'Prospecting',      types: ['prospect_fit', 'icp_criteria'] },
  { label: 'Prospecting Config', types: ['cfg_relevance', 'cfg_segments', 'cfg_matcher', 'cfg_changelog'] },
];
// Scoring-criteria tabs only (config tabs render their own panels, not the weights UI).
const CONFIG_TABS = ['cfg_relevance', 'cfg_segments', 'cfg_matcher', 'cfg_changelog'];
const SCORE_TYPES = TAB_GROUPS.flatMap(g => g.types).filter(t => t !== 'icp_criteria' && !CONFIG_TABS.includes(t));
const SCORE_LABELS = {
  deal:           'Deal Score',
  account_health: 'Account Health',
  lead:           'Lead Score',
  contact_health: 'Contact Health',
  prospect_fit:   'Prospect Fit',
  icp_criteria:   'ICP Criteria',
  cfg_relevance:  'Asset-Class Relevance',
  cfg_segments:   'Segments & ICP',
  cfg_matcher:    'Matcher',
  cfg_changelog:  'Change Log',
};

const PROSPECT_CRITERION_LABELS = {
  aum_tier:             'AUM Tier',
  portfolio_turnover:   'Portfolio Turnover',
  equity_concentration: 'Equity Concentration',
  options_present:      'Options Activity',
  position_count:       'Position Count',
  filer_type:           'Filer Type',
};

// ── Weight total bar ──────────────────────────────────────────────────────────

function WeightTotalBar({ criteria }) {
  const available   = criteria.filter(c => c.is_active && !c.requires_integration).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const integration = criteria.filter(c => c.is_active && c.requires_integration).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const activeTotal = available + integration;
  const isExact     = activeTotal === 100;
  const barColor    = isExact ? 'var(--green)' : 'var(--red)';
  const pct         = Math.min((activeTotal / 100) * 100, 100);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Total weight: <strong style={{ color: isExact ? 'var(--green)' : 'var(--red)' }}>{activeTotal}</strong> / 100
          {integration > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginLeft: 8 }}>
              ({available} available + {integration} integration)
            </span>
          )}
        </span>
        {!isExact && (
          <span style={{ fontSize: 12, color: 'var(--red)' }}>
            {activeTotal > 100 ? `${activeTotal - 100} over limit` : `${100 - activeTotal} remaining`}
          </span>
        )}
      </div>
      <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 3, background: barColor, width: `${pct}%`, transition: 'width .2s, background .2s' }} />
      </div>
    </div>
  );
}

// ── Recalculation modal ───────────────────────────────────────────────────────

function RecalculationModal({ scoreType, recordCount, weights, onClose }) {
  const recalc = useRecalculateScores();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const estimate = Math.max(1, Math.round((recordCount * 10) / 1000));
  const label = SCORE_LABELS[scoreType];

  const handleMode = async (mode) => {
    await recalc.run({ scoreType, mode, weights });
    if (mode === 'all') { setDone(true); return; }
    onClose();
  };

  const pct = recalc.total > 0 ? Math.round((recalc.progress / recalc.total) * 100) : 0;

  return createPortal(
    <div className="modal-overlay" onClick={!recalc.isRunning ? onClose : undefined}>
      <div className="modal-dialog" style={{ width: 580, maxWidth: 'calc(100vw - 32px)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {recalc.isRunning ? `Recalculating ${label} scores…` : done ? 'Recalculation complete' : 'Weights saved. Apply new scoring?'}
          </span>
          {!recalc.isRunning && (
            <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          )}
        </div>
        <div className="modal-body">
          {recalc.error && (
            <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
              {recalc.error}
            </div>
          )}

          {(recalc.isRunning || done) && (
            <div style={{ padding: '8px 0 12px' }}>
              {!done ? (
                <>
                  <div style={{ fontSize: 13.5, marginBottom: 12 }}>
                    {recalc.progress} / {recalc.total} records processed
                  </div>
                  <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 4, width: `${pct}%`, transition: 'width .2s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{pct}% complete</span>
                    <span style={{ color: 'var(--yellow)', fontSize: 12 }}>Do not close this tab</span>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Done. {recalc.total} records updated.</div>
                  <div className="modal-footer" style={{ marginTop: 12 }}>
                    <button className="btn btn-secondary" onClick={() => navigate('/reports/lead-hygiene')}>View score changes →</button>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!recalc.isRunning && !done && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <OptionCard
                  icon="↺"
                  title="Recalculate All"
                  description={`Update scores for all ${recordCount} existing records now`}
                  sub={`~${estimate}s estimated`}
                  primary
                  onClick={() => handleMode('all')}
                />
                <OptionCard
                  icon="→"
                  title="New Records Only"
                  description="Keep existing scores. New records will use updated weights."
                  sub="Existing scores may not reflect current weights"
                  onClick={() => handleMode('new_only')}
                />
                <OptionCard
                  icon="◷"
                  title="Schedule for Later"
                  description="Recalculate all scores on next app load"
                  sub="Recommended for large datasets"
                  onClick={() => handleMode('scheduled')}
                />
              </div>
              <div style={{ textAlign: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={onClose}>Skip for now</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function OptionCard({ icon, title, description, sub, primary, onClick }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 14px', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 22, color: primary ? 'var(--accent)' : 'var(--text-secondary)' }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>{description}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 8 }}>{sub}</div>
      <button className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={onClick}>{title}</button>
    </div>
  );
}

// ── Live preview panel ────────────────────────────────────────────────────────

function LivePreview({ scoreType, localCriteria }) {
  const leadsQ    = useLeads({});
  const dealsQ    = useDeals({});
  const accountsQ = useAccounts({ tier: 'enterprise' });
  const contactsQ = useContacts({ tier: 'individual' });

  const record = useMemo(() => {
    if (scoreType === 'lead')           return (leadsQ.data ?? [])[0] ?? null;
    if (scoreType === 'deal')           return (dealsQ.data ?? [])[0] ?? null;
    if (scoreType === 'account_health') return (accountsQ.data ?? [])[0] ?? null;
    if (scoreType === 'contact_health') return (contactsQ.data ?? [])[0] ?? null;
    return null;
  }, [scoreType, leadsQ.data, dealsQ.data, accountsQ.data, contactsQ.data]);

  const { score, availableScore, breakdown } = useMemo(() => {
    if (!record) return { score: 0, availableScore: 0, breakdown: [] };
    const weights = {};
    localCriteria.forEach(c => { if (c.is_active) weights[c.criterion_key] = Number(c.weight) || 0; });
    return computeScore(scoreType, record, weights);
  }, [scoreType, record, localCriteria]);

  const name = record
    ? (record.name ?? (record.contact ? `${record.contact.first_name} ${record.contact.last_name}` : `${record.first_name} ${record.last_name}`))
    : null;

  const ratio      = availableScore > 0 ? score / availableScore : 0;
  const scoreColor = ratio >= 0.75 ? 'var(--green)' : ratio >= 0.5 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Live Preview</div>
      {!record ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No sample record found for this score type.</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor }}>{score}</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>/ {availableScore} available</div>
          </div>
          <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ height: '100%', background: scoreColor, width: `${availableScore > 0 ? (score / availableScore) * 100 : 0}%`, borderRadius: 3, transition: 'width .2s' }} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--text-tertiary)', fontWeight: 500 }}>Criterion</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Met</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--text-tertiary)', fontWeight: 500 }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map(b => (
                <tr key={b.criterion_key} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: b.weight === 0 ? .4 : 1 }}>
                  <td style={{ padding: '5px 0', color: 'var(--text-primary)' }}>{b.label}</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                    {b.requires_integration ? (
                      <span style={{ color: 'var(--text-tertiary)' }}>⊘</span>
                    ) : (
                      <span style={{ color: b.earned ? 'var(--green)' : 'var(--text-tertiary)' }}>{b.earned ? '✓' : '✗'}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 0', fontWeight: 600, color: b.points > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    {b.requires_integration ? <span style={{ fontSize: 11 }}>~{b.weight}</span> : b.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Prospect Fit saved modal ─────────────────────────────────────────────────

function ProspectFitSavedModal({ onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">✓ Weights saved</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Prospect fit weights saved. New scores will apply on the next ingestion run.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Prospect Fit preview panel ────────────────────────────────────────────────

function ProspectFitPreview() {
  const prospectsQ  = useProspects({});
  const topProspect = (prospectsQ.data ?? [])[0] ?? null;
  const detailQ     = useProspect(topProspect?.id);

  if (prospectsQ.isLoading) {
    return (
      <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Sample Prospect</div>
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (!topProspect) {
    return (
      <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Sample Prospect</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          No prospects ingested yet — run the ingestion service to see scoring in action.
        </div>
      </div>
    );
  }

  const latestScore = (detailQ.data?.scores ?? [])[0];
  const breakdown   = latestScore?.breakdown;
  const score       = topProspect.fit_score;
  const scoreColor  = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Sample Prospect (highest fit score)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{topProspect.firm_name}</div>
        {score != null && (
          <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor }}>{score}</div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          stored — computed by ingestion service
        </div>
      </div>

      {score != null && (
        <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ height: '100%', background: scoreColor, width: `${score}%`, borderRadius: 3 }} />
        </div>
      )}

      {detailQ.isLoading && (
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
      )}

      {!detailQ.isLoading && breakdown && typeof breakdown === 'object' && Object.keys(breakdown).length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--text-tertiary)', fontWeight: 500 }}>Criterion</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Points</th>
              <th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--text-tertiary)', fontWeight: 500 }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(breakdown).map(([key, val]) => {
              if (!val || typeof val !== 'object') return null;
              const { points = 0, weight = 0 } = val;
              const label = PROSPECT_CRITERION_LABELS[key] ?? key.replace(/_/g, ' ');
              return (
                <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '5px 0', color: 'var(--text-primary)' }}>{label}</td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 600, color: points > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    {points}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 0', color: 'var(--text-tertiary)' }}>
                    {weight}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        !detailQ.isLoading && (
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            No score breakdown available for this prospect.
          </div>
        )
      )}
    </div>
  );
}

// ── Criteria table ────────────────────────────────────────────────────────────

function CriteriaTable({ criteria, onChange }) {
  const update = (idx, field, value) => {
    onChange(criteria.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 44 }}>Active</th>
            <th>Criterion</th>
            <th>Description</th>
            <th style={{ width: 110 }}>Integration</th>
            <th style={{ width: 90, textAlign: 'right' }}>Weight</th>
            <th style={{ width: 70, textAlign: 'right' }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map((c, idx) => (
            <tr key={c.criterion_key} style={{ opacity: c.is_active ? 1 : .45 }}>
              <td style={{ textAlign: 'center' }}>
                <label className="form-toggle" style={{ justifyContent: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!c.is_active}
                    onChange={e => update(idx, 'is_active', e.target.checked)}
                  />
                  <span className="form-toggle-track"><span className="form-toggle-thumb" /></span>
                </label>
              </td>
              <td>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontFamily: 'var(--mono)' }}>{c.criterion_key}</div>
              </td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.description}</td>
              <td>
                {c.requires_integration ? (
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                    ⊘ {c.integration_label}
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>—</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <input
                  type="number"
                  min={0} max={100} step={1}
                  disabled={!c.is_active}
                  value={c.weight}
                  onChange={e => update(idx, 'weight', Number(e.target.value))}
                  style={{
                    width: 60, textAlign: 'right', padding: '4px 6px',
                    border: `1px solid ${Number(c.weight) > 50 ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 4, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  }}
                />
              </td>
              <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: c.is_active && c.weight > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {c.is_active ? c.weight : 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ICP Criteria tab ──────────────────────────────────────────────────────────

const ALL_SEGMENTS = [
  { value: 'hedge_fund',    label: 'Hedge Fund'    },
  { value: 'quant_fund',    label: 'Quant Fund'    },
  { value: 'prop_trader',   label: 'Prop Trader'   },
  { value: 'broker_dealer', label: 'Broker-Dealer' },
  { value: 'pension',       label: 'Pension'       },
  { value: 'insurance',     label: 'Insurance'     },
  { value: 'family_office', label: 'Family Office' },
  { value: 'retail_trader', label: 'Retail Trader' },
];

const ICP_LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const ICP_HINT  = { fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 };

function ICPCriteriaTab() {
  const config = useICPConfig();
  const update = useUpdateICPConfig();
  const [minAum,       setMinAum]       = useState('');
  const [minTurnover,  setMinTurnover]  = useState('');
  const [minPositions, setMinPositions] = useState('');
  const [excluded,     setExcluded]     = useState([]);
  const [saved,        setSaved]        = useState(false);
  const [err,          setErr]          = useState(null);

  useEffect(() => {
    if (!config.data) return;
    const c = config.data;
    setMinAum(c.min_aum_usd        != null ? String(c.min_aum_usd)        : '');
    setMinTurnover(c.min_turnover_pct   != null ? String(c.min_turnover_pct)   : '');
    setMinPositions(c.min_position_count != null ? String(c.min_position_count) : '');
    setExcluded(c.excluded_segments ?? []);
  }, [config.data]);

  const toggleSeg = seg => setExcluded(p => p.includes(seg) ? p.filter(s => s !== seg) : [...p, seg]);

  const fmtAUM = n => {
    const v = Number(n);
    if (!n || isNaN(v)) return null;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  };

  const handleSave = async () => {
    setErr(null);
    try {
      await update.mutateAsync({
        min_aum_usd:        minAum       ? Number(minAum)       : null,
        min_turnover_pct:   minTurnover  ? Number(minTurnover)  : null,
        min_position_count: minPositions ? Number(minPositions) : null,
        excluded_segments:  excluded,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) { setErr(e.message); }
  };

  if (config.isLoading) return (
    <div>
      {[240, 180, 180, 220].map((w, i) => (
        <div key={i} className="skeleton skeleton-text" style={{ width: w, marginBottom: 14 }} />
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 540 }}>
      <div style={{
        padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: 6, fontSize: 13, color: '#1e40af', lineHeight: 1.5, marginBottom: 20,
      }}>
        <strong>ICP Criteria</strong> are hard filters that determine which prospects qualify to be shown.
        Separate from <strong>Prospect Fit</strong> scoring, which ranks the prospects that qualify.
      </div>

      {config.error && <ErrorBanner message={config.error.message} onRetry={config.refetch} />}
      {err && <div className="error-state" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ marginBottom: 20 }}>
        <label style={ICP_LABEL}>Minimum AUM (USD)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            className="form-input" type="number" min={0} step={1_000_000}
            value={minAum} onChange={e => setMinAum(e.target.value)}
            placeholder="e.g. 100000000" style={{ flex: 1 }}
          />
          {fmtAUM(minAum) && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              = {fmtAUM(minAum)}
            </span>
          )}
        </div>
        <div style={ICP_HINT}>Prospects below this AUM will have passes_icp = false</div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={ICP_LABEL}>Minimum Portfolio Turnover (%)</label>
        <input
          className="form-input" type="number" min={0} max={100} step={1}
          value={minTurnover} onChange={e => setMinTurnover(e.target.value)}
          placeholder="e.g. 10 for 10%"
        />
        <div style={ICP_HINT}>Prospects with lower turnover will have passes_icp = false</div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={ICP_LABEL}>Minimum Position Count</label>
        <input
          className="form-input" type="number" min={0} step={1}
          value={minPositions} onChange={e => setMinPositions(e.target.value)}
          placeholder="e.g. 5"
        />
        <div style={ICP_HINT}>Prospects with fewer positions will have passes_icp = false</div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={ICP_LABEL}>Excluded Segments</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_SEGMENTS.map(seg => {
            const active = excluded.includes(seg.value);
            return (
              <button
                key={seg.value} type="button" onClick={() => toggleSeg(seg.value)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12.5, cursor: 'pointer',
                  border: active ? '1px solid var(--red)' : '1px solid var(--border)',
                  background: active ? '#fef2f2' : 'var(--bg-secondary)',
                  color:      active ? 'var(--red)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {active ? '✕ ' : ''}{seg.label}
              </button>
            );
          })}
        </div>
        <div style={ICP_HINT}>Prospects in these segments will have passes_icp = false</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save Criteria'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✓ Saved</span>}
      </div>

      <div style={{
        padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a',
        borderRadius: 6, fontSize: 13, color: '#92400e', lineHeight: 1.5,
      }}>
        <strong>Note:</strong> Changes apply to prospects ingested <em>after</em> saving.
        Existing prospects keep their current ICP status until re-ingested.
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScoringConfig() {
  const [activeTab, setActiveTab]   = useState('deal');
  const [localCriteria, setLocalCriteria] = useState({});
  const [showModal, setShowModal]   = useState(false);
  const [savedWeights, setSavedWeights] = useState({});

  const isAdmin    = useIsAdmin();
  const config     = useScoringConfig();
  const saveConfig = useUpdateScoringConfig();

  useEffect(() => {
    if (!config.data) return;
    const initial = {};
    for (const st of SCORE_TYPES) {
      const raw = config.data.raw.filter(r => r.score_type === st);
      if (raw.length && !localCriteria[st]) {
        initial[st] = raw.map(r => ({ ...r }));
      }
    }
    if (Object.keys(initial).length) {
      setLocalCriteria(prev => ({ ...prev, ...initial }));
    }
  }, [config.data]);

  const typeCriteria = localCriteria[activeTab] ?? [];
  const activeTotal  = typeCriteria.filter(c => c.is_active).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const canSave      = activeTotal === 100;

  const lastUpdated = config.data?.raw.find(r => r.score_type === activeTab && r.updated_at);

  const leadsQ    = useLeads({});
  const dealsQ    = useDeals({});
  const accountsQ = useAccounts({ tier: 'enterprise' });
  const contactsQ = useContacts({ tier: 'individual' });

  const recordCount = {
    lead:           leadsQ.data?.length ?? 0,
    deal:           dealsQ.data?.length ?? 0,
    account_health: accountsQ.data?.length ?? 0,
    contact_health: contactsQ.data?.length ?? 0,
  }[activeTab] ?? 0;

  const handleSave = async () => {
    const criteria = typeCriteria.map(c => ({
      ...c,
      weight: Number(c.weight) || 0,
    }));
    try {
      await saveConfig.mutateAsync({ scoreType: activeTab, criteria });
      const weights = {};
      criteria.forEach(c => { if (c.is_active) weights[c.criterion_key] = c.weight; });
      setSavedWeights(weights);
      setShowModal(true);
    } catch { /* error surfaced via saveConfig.error */ }
  };

  return (
    <Layout title="Scoring Configuration">
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 20, maxWidth: 560 }}>
        Adjust criterion weights per score type. Active weights must sum to 100 before saving.
      </p>

      {config.error    && <ErrorBanner message={config.error.message} onRetry={config.refetch} />}
      {saveConfig.error && <ErrorBanner message={saveConfig.error.message} />}

      {/* Score type tabs — grouped */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border-subtle)' }}>
          {TAB_GROUPS.map((group, gi) => (
            <div key={group.label} style={{ display: 'flex', alignItems: 'flex-end' }}>
              {gi > 0 && (
                <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px 0', alignSelf: 'center' }} />
              )}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: .8, textTransform: 'uppercase', padding: '0 20px 4px', userSelect: 'none' }}>
                  {group.label}
                </div>
                <div style={{ display: 'flex' }}>
                  {group.types.map(st => (
                    <button
                      key={st}
                      onClick={() => setActiveTab(st)}
                      style={{
                        padding: '6px 20px 10px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 13.5, fontWeight: activeTab === st ? 600 : 450,
                        color: activeTab === st ? 'var(--accent)' : 'var(--text-secondary)',
                        borderBottom: `2px solid ${activeTab === st ? 'var(--accent)' : 'transparent'}`,
                      }}
                    >{SCORE_LABELS[st]}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeTab === 'icp_criteria' ? (
        <ICPCriteriaTab />
      ) : activeTab === 'cfg_relevance' ? (
        <RelevanceConfigPanel canEdit={isAdmin} />
      ) : activeTab === 'cfg_segments' ? (
        <SegmentsConfigPanel canEdit={isAdmin} />
      ) : activeTab === 'cfg_matcher' ? (
        <MatcherConfigPanel canEdit={isAdmin} />
      ) : activeTab === 'cfg_changelog' ? (
        <ChangeLogPanel canEdit={isAdmin} />
      ) : config.isLoading ? (
        <div className="skeleton skeleton-text" style={{ width: '60%', margin: '20px 0' }} />
      ) : (
        <>
          {/* Prospect Fit tab info note + subtitle */}
          {activeTab === 'prospect_fit' && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Firmographic ICP fit scoring for ingested SEC prospects (applied during ingestion)
              </p>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '10px 14px', background: '#eff6ff',
                border: '1px solid #bfdbfe', borderRadius: 6,
                fontSize: 13, color: '#1e40af', lineHeight: 1.5,
              }}>
                <span style={{ flexShrink: 0 }}>ℹ</span>
                <span>
                  These weights are applied by the ingestion service when prospects are imported from
                  SEC filings. Changes take effect on the next ingestion run, not retroactively.
                </span>
              </div>
            </div>
          )}

          <CriteriaTable
            criteria={typeCriteria}
            onChange={rows => setLocalCriteria(p => ({ ...p, [activeTab]: rows }))}
          />
          <WeightTotalBar criteria={typeCriteria} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {lastUpdated ? `Last updated ${fmtRelTime(lastUpdated.updated_at)}` : 'Not yet saved'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!canSave && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Weights must sum to 100
                </span>
              )}
              <button
                className="btn btn-primary btn-sm"
                disabled={!canSave || saveConfig.isPending}
                onClick={handleSave}
                title={!canSave ? 'Weights must sum to 100' : undefined}
              >
                {saveConfig.isPending ? 'Saving…' : 'Save Weights'}
              </button>
            </div>
          </div>

          {activeTab === 'prospect_fit'
            ? <ProspectFitPreview />
            : <LivePreview scoreType={activeTab} localCriteria={typeCriteria} />
          }
        </>
      )}

      {showModal && activeTab === 'prospect_fit' && (
        <ProspectFitSavedModal onClose={() => setShowModal(false)} />
      )}
      {showModal && activeTab !== 'prospect_fit' && (
        <RecalculationModal
          scoreType={activeTab}
          recordCount={recordCount}
          weights={savedWeights}
          onClose={() => setShowModal(false)}
        />
      )}
    </Layout>
  );
}
