import { useState, useEffect } from 'react';
import { ErrorBanner } from '../shared';
import {
  useRelevanceConfig, useUpdateRelevanceConfig,
  useMatcherConfig, useUpdateMatcherConfig,
  useServedAssetClasses, useUpdateServedAssetClass,
  useVerdictActions, useUpdateVerdictAction,
  useSegmentNameSignals, useUpsertSegmentNameSignal,
  useAdvNameFlags, useUpsertAdvNameFlag,
  useSegmentOptions,
} from '../../hooks/useConfigTables';
import { useICPConfig, useUpdateICPConfig } from '../../hooks/useDedup';
import {
  RELEVANCE_FIELDS, coerceValue, isMatcherEditable,
  ADV_VERDICTS, VERDICT_ACTIONS, CONFIDENCES,
} from './configSpecs';

// ── Shared bits ───────────────────────────────────────────────────────────────

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' };
const HINT  = { fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.45 };
const MONO  = { fontFamily: 'var(--mono, monospace)', fontSize: 12 };

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: subtitle ? 2 : 14 }}>{title}</div>
      {subtitle && <div style={{ ...HINT, marginTop: 0, marginBottom: 14 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function Toggle({ checked, disabled, onChange }) {
  return (
    <label className="form-toggle" style={{ opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="form-toggle-track"><span className="form-toggle-thumb" /></span>
    </label>
  );
}

function SaveRow({ dirty, pending, canEdit, onSave, savedAt }) {
  if (!canEdit) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
      <button className="btn btn-primary btn-sm" disabled={!dirty || pending} onClick={onSave}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {savedAt && !dirty && <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 500 }}>✓ Saved</span>}
    </div>
  );
}

function ReadOnlyNotice() {
  return (
    <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 16 }}>
      Read-only — configuration editing requires an admin role.
    </div>
  );
}

// ── 1a. asset_class_relevance_config (knob form) ──────────────────────────────

function RelevanceConfigForm({ canEdit }) {
  const q = useRelevanceConfig();
  const save = useUpdateRelevanceConfig();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (q.data) setForm(Object.fromEntries(RELEVANCE_FIELDS.map((f) => [f.key, q.data[f.key]]))); }, [q.data]);

  if (q.isLoading || !form) return <div className="skeleton skeleton-text" style={{ width: '60%' }} />;
  const dirty = q.data && RELEVANCE_FIELDS.some((f) => coerceValue(f.type, form[f.key]) !== q.data[f.key]);

  const set = (key, val) => { setForm((p) => ({ ...p, [key]: val })); setSaved(false); };
  const onSave = async () => {
    const payload = Object.fromEntries(RELEVANCE_FIELDS.map((f) => [f.key, coerceValue(f.type, form[f.key])]));
    await save.mutateAsync(payload);
    setSaved(true);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 28px', maxWidth: 720 }}>
      {RELEVANCE_FIELDS.map((f) => (
        <div key={f.key} style={{ gridColumn: f.type === 'bool' ? '1 / -1' : 'auto' }}>
          <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 10, justifyContent: f.type === 'bool' ? 'space-between' : 'flex-start' }}>
            <span>{f.label}</span>
            {f.type === 'bool' && <Toggle checked={form[f.key]} disabled={!canEdit} onChange={(v) => set(f.key, v)} />}
          </label>
          {f.type === 'enum' && (
            <select className="form-input" disabled={!canEdit} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} style={{ marginTop: 5, width: '100%' }}>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {(f.type === 'int' || f.type === 'num' || f.type === 'frac') && (
            <input
              className="form-input" type="number"
              step={f.type === 'frac' ? 0.01 : f.type === 'int' ? 1 : 'any'}
              min={f.type === 'frac' ? 0 : undefined} max={f.type === 'frac' ? 1 : undefined}
              disabled={!canEdit}
              value={form[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              style={{ marginTop: 5, width: '100%' }}
            />
          )}
          {f.help && <div style={HINT}>{f.help}</div>}
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1' }}>
        {save.error && <ErrorBanner message={save.error.message} />}
        <SaveRow dirty={dirty} pending={save.isPending} canEdit={canEdit} onSave={onSave} savedAt={saved} />
      </div>
    </div>
  );
}

// ── 1b. matcher_config (editable thresholds + read-only tier-2) ───────────────

function MatcherConfigForm({ canEdit }) {
  const q = useMatcherConfig();
  const save = useUpdateMatcherConfig();
  const [vals, setVals] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.filter((r) => isMatcherEditable(r.key)).map((r) => [r.key, r.value])));
  }, [q.data]);

  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '50%' }} />;
  const editable = (q.data ?? []).filter((r) => isMatcherEditable(r.key));
  const readonly = (q.data ?? []).filter((r) => !isMatcherEditable(r.key));
  const dirty = editable.some((r) => vals[r.key] !== r.value);

  const onSave = async () => {
    for (const r of editable) if (vals[r.key] !== r.value) await save.mutateAsync({ key: r.key, value: vals[r.key] });
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {editable.map((r) => (
        <div key={r.key} style={{ marginBottom: 14 }}>
          <label style={LABEL}>{r.key}</label>
          <input className="form-input" type="number" step="0.01" disabled={!canEdit}
            value={vals[r.key] ?? ''} onChange={(e) => { setVals((p) => ({ ...p, [r.key]: e.target.value })); setSaved(false); }}
            style={{ marginTop: 5, maxWidth: 200 }} />
          {r.description && <div style={HINT}>{r.description}</div>}
        </div>
      ))}
      {save.error && <ErrorBanner message={save.error.message} />}
      <SaveRow dirty={dirty} pending={save.isPending} canEdit={canEdit} onSave={onSave} savedAt={saved} />

      <div style={{ marginTop: 22, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Tier-2 internals (read-only)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <tbody>
          {readonly.map((r) => (
            <tr key={r.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '5px 0', color: 'var(--text-secondary)' }}>{r.key}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', ...MONO }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 2. Toggle grids ───────────────────────────────────────────────────────────

function ServedGrid({ canEdit }) {
  const q = useServedAssetClasses();
  const upd = useUpdateServedAssetClass();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '50%' }} />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, maxWidth: 520 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <th style={{ textAlign: 'left', padding: '4px 0', ...LABEL }}>Bucket</th>
          <th style={{ textAlign: 'center', padding: '4px 8px', ...LABEL }}>Served</th>
          <th style={{ textAlign: 'center', padding: '4px 8px', ...LABEL }}>Active</th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((b) => (
          <tr key={b.bucket_key} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: b.is_active ? 1 : 0.5 }}>
            <td style={{ padding: '7px 0' }}>{b.label} <span style={{ ...MONO, color: 'var(--text-tertiary)' }}>({b.bucket_key})</span></td>
            <td style={{ textAlign: 'center' }}>
              <Toggle checked={b.served} disabled={!canEdit} onChange={(v) => upd.mutate({ bucket_key: b.bucket_key, patch: { served: v } })} />
            </td>
            <td style={{ textAlign: 'center' }}>
              <Toggle checked={b.is_active} disabled={!canEdit} onChange={(v) => upd.mutate({ bucket_key: b.bucket_key, patch: { is_active: v } })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerdictActionsGrid({ canEdit }) {
  const q = useVerdictActions();
  const upd = useUpdateVerdictAction();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '50%' }} />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, maxWidth: 520 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <th style={{ textAlign: 'left', padding: '4px 0', ...LABEL }}>Verdict</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', ...LABEL }}>Action</th>
          <th style={{ textAlign: 'center', padding: '4px 8px', ...LABEL }}>Active</th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((v) => (
          <tr key={v.verdict} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: v.is_active ? 1 : 0.5 }}>
            <td style={{ padding: '7px 0', ...MONO }}>{v.verdict}</td>
            <td>
              <select className="form-input" disabled={!canEdit} value={v.action}
                onChange={(e) => upd.mutate({ verdict: v.verdict, patch: { action: e.target.value } })} style={{ maxWidth: 150 }}>
                {VERDICT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </td>
            <td style={{ textAlign: 'center' }}>
              <Toggle checked={v.is_active} disabled={!canEdit} onChange={(val) => upd.mutate({ verdict: v.verdict, patch: { is_active: val } })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 3. List editors (pattern read-only this stage) ────────────────────────────

// A single editable row: local draft, Save when dirty. is_active toggle immediate.
function EditableRow({ row, columns, canEdit, onSave }) {
  const [draft, setDraft] = useState(row);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(row); }, [row]);
  const dirty = columns.some((c) => c.editable && draft[c.key] !== row[c.key]);

  const set = (k, v) => { setDraft((p) => ({ ...p, [k]: v })); setSaved(false); };

  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)', opacity: draft.is_active === false ? 0.5 : 1 }}>
      {columns.map((c) => (
        <td key={c.key} style={{ padding: '6px 8px 6px 0' }}>
          {!c.editable || !canEdit ? (
            <span style={c.mono ? MONO : { fontSize: 12.5 }}>{String(draft[c.key] ?? '—')}</span>
          ) : c.type === 'bool' ? (
            <Toggle checked={draft[c.key]} onChange={(v) => set(c.key, v)} />
          ) : c.type === 'select' ? (
            <select className="form-input" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} style={{ minWidth: 110 }}>
              {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : c.type === 'number' ? (
            <input className="form-input" type="number" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, Number(e.target.value))} style={{ width: 70 }} />
          ) : (
            <input className="form-input" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} style={{ minWidth: 110 }} />
          )}
        </td>
      ))}
      {canEdit && (
        <td style={{ padding: '6px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn btn-sm btn-secondary" disabled={!dirty} onClick={async () => { await onSave(draft); setSaved(true); }}>Save</button>
          {saved && !dirty && <span style={{ fontSize: 12, color: 'var(--green)', marginLeft: 8 }}>✓</span>}
        </td>
      )}
    </tr>
  );
}

function ListEditor({ rows, columns, canEdit, onSave, addTemplate }) {
  const [adding, setAdding] = useState(null);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key}>{c.label}</th>)}
            {canEdit && <th style={{ width: 90 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <EditableRow key={r.id} row={r} columns={columns} canEdit={canEdit} onSave={onSave} />)}
          {adding && <EditableRow row={adding} columns={columns.map((c) => ({ ...c, editable: c.editable || c.key === 'pattern' }))} canEdit={canEdit} onSave={async (d) => { await onSave(d); setAdding(null); }} />}
        </tbody>
      </table>
      {canEdit && !adding && (
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} onClick={() => setAdding({ ...addTemplate })}>+ Add rule</button>
      )}
    </div>
  );
}

function SegmentSignalsList({ canEdit }) {
  const q = useSegmentNameSignals();
  const segs = useSegmentOptions();
  const upsert = useUpsertSegmentNameSignal();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '70%' }} />;
  const segOptions = (segs.data ?? []).map((s) => s.value_key);
  const columns = [
    { key: 'pattern', label: 'Pattern', mono: true, editable: false }, // read-only this stage (regex editing = C3)
    { key: 'target_segment', label: 'Target', type: 'select', options: segOptions, editable: true },
    { key: 'signal_kind', label: 'Kind', mono: true, editable: false },
    { key: 'vetoes_hedge_fund', label: 'Vetoes HF', type: 'bool', editable: true },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCES, editable: true },
    { key: 'sort_order', label: 'Order', type: 'number', editable: true },
    { key: 'is_active', label: 'Active', type: 'bool', editable: true },
  ];
  const addTemplate = { pattern: '', target_segment: segOptions[0] ?? 'unknown', signal_kind: 'name_signal', vetoes_hedge_fund: false, confidence: 'low', sort_order: 99, is_active: true };
  return <ListEditor rows={q.data} columns={columns} canEdit={canEdit} onSave={(d) => upsert.mutateAsync(d)} addTemplate={addTemplate} />;
}

function AdvFlagsList({ canEdit }) {
  const q = useAdvNameFlags();
  const upsert = useUpsertAdvNameFlag();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '70%' }} />;
  const columns = [
    { key: 'pattern', label: 'Pattern', mono: true, editable: false },
    { key: 'implied_class', label: 'Implied class', type: 'text', editable: true },
    { key: 'verdict', label: 'Verdict', type: 'select', options: ADV_VERDICTS, editable: true },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCES, editable: true },
    { key: 'sort_order', label: 'Order', type: 'number', editable: true },
    { key: 'is_active', label: 'Active', type: 'bool', editable: true },
  ];
  const addTemplate = { pattern: '', implied_class: '', verdict: 'suspect', confidence: 'low', sort_order: 99, is_active: true };
  return <ListEditor rows={q.data} columns={columns} canEdit={canEdit} onSave={(d) => upsert.mutateAsync(d)} addTemplate={addTemplate} />;
}

// ── icp_filter_config.excluded_segments ───────────────────────────────────────

function ExcludedSegmentsEditor({ canEdit }) {
  const q = useICPConfig();
  const segs = useSegmentOptions();
  const upd = useUpdateICPConfig();
  const [excluded, setExcluded] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setExcluded(q.data.excluded_segments ?? []); }, [q.data]);
  if (q.isLoading || excluded == null) return <div className="skeleton skeleton-text" style={{ width: '50%' }} />;

  const dirty = JSON.stringify([...excluded].sort()) !== JSON.stringify([...(q.data.excluded_segments ?? [])].sort());
  const toggle = (seg) => { setExcluded((p) => (p.includes(seg) ? p.filter((s) => s !== seg) : [...p, seg])); setSaved(false); };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(segs.data ?? []).map((s) => {
          const active = excluded.includes(s.value_key);
          return (
            <button key={s.value_key} type="button" disabled={!canEdit} onClick={() => toggle(s.value_key)} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12.5, cursor: canEdit ? 'pointer' : 'default',
              border: active ? '1px solid var(--red)' : '1px solid var(--border)',
              background: active ? '#fef2f2' : 'var(--bg-secondary)', color: active ? 'var(--red)' : 'var(--text-secondary)',
              fontWeight: active ? 600 : 400,
            }}>
              {active ? '✕ ' : ''}{s.value_key}
            </button>
          );
        })}
      </div>
      <div style={HINT}>Prospects in an excluded segment get passes_icp = false.</div>
      {upd.error && <ErrorBanner message={upd.error.message} />}
      <SaveRow dirty={dirty} pending={upd.isPending} canEdit={canEdit}
        onSave={async () => { await upd.mutateAsync({ excluded_segments: excluded }); setSaved(true); }} savedAt={saved} />
    </div>
  );
}

// ── Panels (one per tab) ──────────────────────────────────────────────────────

export function RelevanceConfigPanel({ canEdit }) {
  return (
    <div>
      {!canEdit && <ReadOnlyNotice />}
      <SectionCard title="Relevance thresholds & knobs" subtitle="asset_class_relevance_config — the gate-then-score eligibility layer.">
        <RelevanceConfigForm canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="Served asset classes" subtitle="Which buckets count as served when computing served_fraction.">
        <ServedGrid canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="Verdict → action" subtitle="What each relevance verdict does (gate / penalize / pass).">
        <VerdictActionsGrid canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="ADV name flags" subtitle="Negative name-flags for ADV firms with no 13F book. Pattern editing arrives with the test panel (C3).">
        <AdvFlagsList canEdit={canEdit} />
      </SectionCard>
    </div>
  );
}

export function SegmentsConfigPanel({ canEdit }) {
  return (
    <div>
      {!canEdit && <ReadOnlyNotice />}
      <SectionCard title="Segment name-signals" subtitle="Name → segment rules for ADV derivation. Pattern editing arrives with the test panel (C3).">
        <SegmentSignalsList canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="Excluded segments (ICP)" subtitle="icp_filter_config — segments that fail the ICP filter.">
        <ExcludedSegmentsEditor canEdit={canEdit} />
      </SectionCard>
    </div>
  );
}

export function MatcherConfigPanel({ canEdit }) {
  return (
    <div>
      {!canEdit && <ReadOnlyNotice />}
      <SectionCard title="Matcher thresholds" subtitle="matcher_config — stage-1 recall and stage-2 decision thresholds are tunable; the rest are shown read-only.">
        <MatcherConfigForm canEdit={canEdit} />
      </SectionCard>
    </div>
  );
}
