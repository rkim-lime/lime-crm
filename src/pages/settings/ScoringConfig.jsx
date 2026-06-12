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
import { fmtRelTime, ErrorBanner } from '../shared';

const SCORE_TYPES = ['deal', 'account_health', 'lead', 'contact_health'];
const SCORE_LABELS = {
  deal:           'Deal Score',
  account_health: 'Account Health',
  lead:           'Lead Score',
  contact_health: 'Contact Health',
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScoringConfig() {
  const [activeTab, setActiveTab]   = useState('deal');
  const [localCriteria, setLocalCriteria] = useState({});
  const [showModal, setShowModal]   = useState(false);
  const [savedWeights, setSavedWeights] = useState({});

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
      criterion_key:     c.criterion_key,
      weight:            Number(c.weight) || 0,
      is_active:         c.is_active,
      tier:              c.tier,
      requires_integration: c.requires_integration,
      integration_label: c.integration_label,
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

      {/* Score type tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
        {SCORE_TYPES.map(st => (
          <button
            key={st}
            onClick={() => setActiveTab(st)}
            style={{
              padding: '8px 20px 10px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13.5, fontWeight: activeTab === st ? 600 : 450,
              color: activeTab === st ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === st ? 'var(--accent)' : 'transparent'}`,
            }}
          >{SCORE_LABELS[st]}</button>
        ))}
      </div>

      {config.isLoading ? (
        <div className="skeleton skeleton-text" style={{ width: '60%', margin: '20px 0' }} />
      ) : (
        <>
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

          <LivePreview scoreType={activeTab} localCriteria={typeCriteria} />
        </>
      )}

      {showModal && (
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
