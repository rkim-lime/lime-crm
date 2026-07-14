import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner } from '../shared';
import ConfirmModal from '../../components/ConfirmModal';
import {
  useRelevanceConfig, useUpdateRelevanceConfig,
  useMatcherConfig, useUpdateMatcherConfig,
  useServedAssetClasses, useUpdateServedAssetClass,
  useVerdictActions, useUpdateVerdictAction,
  useSegmentNameSignals, useUpsertSegmentNameSignal,
  useAdvNameFlags, useUpsertAdvNameFlag,
  useSegmentOptions,
} from '../../hooks/useConfigTables';
import { useRelevancePreviewFirms, useSegmentPreviewFirms, useFirmNames } from '../../hooks/usePreviewData';
import { useICPConfig, useUpdateICPConfig } from '../../hooks/useDedup';
import { useStaleness, useRecomputeNow, useChangeLog } from '../../hooks/useConfigGovernance';
import { recomputeGroup, stalenessMessage } from './recompute';
import { filterChangeLog, distinctValues, describeChange, formatRowKey } from './changeLog';
import {
  RELEVANCE_FIELDS, coerceValue, isMatcherEditable,
  ADV_VERDICTS, VERDICT_ACTIONS, CONFIDENCES,
} from './configSpecs';
import {
  previewRelevanceReband, previewSegmentReband,
  matchNames, patternDiff, compileRegex,
  validateThresholdOrder, turningOnGateAbsence,
} from '../../../shared/engine/preview.js';

// ── Shared bits ───────────────────────────────────────────────────────────────

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' };
const HINT  = { fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.45 };
const MONO  = { fontFamily: 'var(--mono, monospace)', fontSize: 12 };

const GATE_ON_ABSENCE_WARNING =
  'May exclude firms with empty/tiny 13F books — often the highest-value ' +
  'intraday/HFT prospects. They\'ll be gated from ICP. Continue?';

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

function SaveRow({ dirty, pending, canEdit, onSave, savedAt, disabled }) {
  if (!canEdit) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
      <button className="btn btn-primary btn-sm" disabled={!dirty || pending || disabled} onClick={onSave}>
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

// Dashed "unsaved preview" container — used by both relevance + segment previews.
function PreviewBox({ children }) {
  return (
    <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px dashed var(--border)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Preview — unsaved
      </div>
      {children}
      <div style={{ ...HINT, marginTop: 8 }}>Preview only — nothing is written until you Save (then recompute).</div>
    </div>
  );
}

// ── 1a. asset_class_relevance_config (knob form + guardrails + preview) ─────────

function RelevancePreview({ preview }) {
  if (!preview) return null;
  const transitions = Object.entries(preview.transitions);
  const g = preview.gated;
  return (
    <PreviewBox>
      {preview.moved === 0 ? (
        <div style={{ fontSize: 13 }}>No firms change verdict ({preview.total} evaluated).</div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <strong>{preview.moved}</strong> of {preview.total} firms change verdict:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {transitions.map(([k, n]) => <li key={k}>{n} × {k.replace('→', ' → ')}</li>)}
          </ul>
        </div>
      )}
      <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--text-secondary)' }}>
        Gated: {g.before} → {g.after} {g.delta !== 0 && <strong>({g.delta > 0 ? '+' : ''}{g.delta})</strong>}
      </div>
    </PreviewBox>
  );
}

function RelevanceConfigForm({ canEdit }) {
  const q = useRelevanceConfig();
  const save = useUpdateRelevanceConfig();
  const firmsQ = useRelevancePreviewFirms();
  const servedQ = useServedAssetClasses();
  const actionsQ = useVerdictActions();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => { if (q.data) setForm(Object.fromEntries(RELEVANCE_FIELDS.map((f) => [f.key, q.data[f.key]]))); }, [q.data]);

  const candidate = useMemo(
    () => (form ? Object.fromEntries(RELEVANCE_FIELDS.map((f) => [f.key, coerceValue(f.type, form[f.key])])) : null),
    [form],
  );
  const dirty = !!(q.data && candidate && RELEVANCE_FIELDS.some((f) => candidate[f.key] !== q.data[f.key]));
  const orderCheck = candidate ? validateThresholdOrder(candidate) : { ok: true };
  const servedSet = useMemo(
    () => new Set((servedQ.data ?? []).filter((b) => b.served).map((b) => b.bucket_key)),
    [servedQ.data],
  );
  const preview = useMemo(() => {
    if (!dirty || !orderCheck.ok || !firmsQ.data || !q.data) return null;
    return previewRelevanceReband({
      firms: firmsQ.data, currentConfig: q.data, candidateConfig: candidate,
      servedSet, verdictActions: actionsQ.data,
    });
  }, [dirty, orderCheck.ok, firmsQ.data, q.data, candidate, servedSet, actionsQ.data]);

  if (q.isLoading || !form) return <div className="skeleton skeleton-text" style={{ width: '60%' }} />;

  const set = (key, val) => { setForm((p) => ({ ...p, [key]: val })); setSaved(false); };
  const doSave = async () => { await save.mutateAsync(candidate); setSaved(true); setConfirmOpen(false); };
  const onSaveClick = () => {
    if (!orderCheck.ok) return;
    if (turningOnGateAbsence(q.data, candidate)) { setConfirmOpen(true); return; }
    doSave();
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
        {!orderCheck.ok && dirty && (
          <div style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 500, marginBottom: 8 }}>⚠ {orderCheck.error}</div>
        )}
        <RelevancePreview preview={preview} />
        {save.error && <ErrorBanner message={save.error.message} />}
        <SaveRow dirty={dirty} pending={save.isPending} canEdit={canEdit} onSave={onSaveClick} savedAt={saved} disabled={!orderCheck.ok} />
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title="Enable gate-on-absence?"
        message={GATE_ON_ABSENCE_WARNING}
        confirmLabel="Enable & save"
        confirmVariant="danger"
        loading={save.isPending}
        onConfirm={doSave}
        onCancel={() => setConfirmOpen(false)}
      />
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
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
        Matcher preview (re-scoring stored dedup candidates) needs the matcher scorer extracted to the shared engine — deferred with the matcher internals.
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

// ── 3. Pattern list editor with live regex test panel ─────────────────────────

// Live regex blast-radius: match count + samples against real firm names, plus a
// diff vs the saved pattern when editing. Never crashes on a bad regex.
function RegexTestPanel({ pattern, savedPattern, names, loading }) {
  if (loading) return <div style={{ ...HINT, marginTop: 6 }}>Loading firm names…</div>;
  const res = matchNames(pattern ?? '', names ?? []);
  const changed = savedPattern != null && pattern !== savedPattern;
  const diff = changed ? patternDiff(savedPattern, pattern ?? '', names ?? []) : null;
  return (
    <div style={{ padding: '9px 12px', background: 'var(--bg-secondary)', borderRadius: 6, marginTop: 8, fontSize: 12.5, lineHeight: 1.55 }}>
      {!res.ok ? (
        <span style={{ color: 'var(--red)' }}>⚠ Invalid regex: {res.error}</span>
      ) : (
        <>
          <div>
            <strong>matches {res.count}</strong> of {res.total}{res.count ? ': ' : ''}
            <span style={{ color: 'var(--text-secondary)' }}>
              {res.samples.join(' · ')}{res.count > res.samples.length ? ' …' : ''}
            </span>
          </div>
          {diff?.ok && changed && (
            <div style={{ marginTop: 5, color: 'var(--text-secondary)' }}>
              was {diff.beforeCount ?? '—'} → now {diff.afterCount}
              {diff.added.length > 0 && (
                <span style={{ color: 'var(--green)' }}> (+{diff.added.length}: {diff.added.slice(0, 4).join(', ')}{diff.added.length > 4 ? '…' : ''})</span>
              )}
              {diff.removed.length > 0 && (
                <span style={{ color: 'var(--red)' }}> (−{diff.removed.length}: {diff.removed.slice(0, 4).join(', ')}{diff.removed.length > 4 ? '…' : ''})</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TH = { textAlign: 'left', padding: '6px 14px 6px 0', whiteSpace: 'nowrap', ...LABEL };
const TD = { padding: '8px 14px 8px 0', verticalAlign: 'middle' };

// One editable rule row. Pattern is editable + testable; regex must compile to
// save. Reports its draft up (onDraftChange) so the panel can preview the whole
// candidate rule-set without writing.
function PatternRow({ row, columns, canEdit, names, namesLoading, onSave, onDraftChange, isNew }) {
  const [draft, setDraft] = useState(row);
  const [rowSnapshot, setRowSnapshot] = useState(row);
  const [saved, setSaved] = useState(false);
  const [showTest, setShowTest] = useState(!!isNew);
  // Re-sync the draft when the underlying row changes (e.g. after a save +
  // refetch) — the React-sanctioned "adjust state during render" pattern, no effect.
  if (rowSnapshot !== row) { setRowSnapshot(row); setDraft(row); setSaved(false); }

  const dirty = columns.some((c) => c.editable && draft[c.key] !== row[c.key]) || isNew;
  const compile = compileRegex(draft.pattern ?? '');
  const patternInvalid = !compile.ok;

  const set = (k, v) => {
    const d = { ...draft, [k]: v };
    setDraft(d); setSaved(false);
    onDraftChange?.(d, columns.some((c) => c.editable && d[c.key] !== row[c.key]) || isNew);
  };

  return (
    <>
      <tr style={{ borderBottom: showTest ? 'none' : '1px solid var(--border-subtle)', opacity: draft.is_active === false ? 0.5 : 1 }}>
        {columns.map((c) => (
          <td key={c.key} style={{ ...TD, width: c.width }}>
            {!c.editable || !canEdit ? (
              <span style={c.mono ? MONO : { fontSize: 12.5 }}>{String(draft[c.key] ?? '—')}</span>
            ) : c.type === 'bool' ? (
              <Toggle checked={draft[c.key]} onChange={(v) => set(c.key, v)} />
            ) : c.type === 'select' ? (
              <select className="form-input" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} style={{ minWidth: 120 }}>
                {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : c.type === 'number' ? (
              <input className="form-input" type="number" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, Number(e.target.value))} style={{ width: 68 }} />
            ) : c.key === 'pattern' ? (
              <input className="form-input" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)}
                style={{ minWidth: 180, ...MONO, borderColor: patternInvalid ? 'var(--red)' : undefined }} />
            ) : (
              <input className="form-input" value={draft[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} style={{ minWidth: 120 }} />
            )}
          </td>
        ))}
        {canEdit && (
          <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowTest((s) => !s)} style={{ marginRight: 6 }}>
              {showTest ? 'Hide' : 'Test'}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={!dirty || patternInvalid}
              title={patternInvalid ? 'Fix the regex before saving' : undefined}
              onClick={async () => { await onSave(draft); setSaved(true); }}
            >Save</button>
            {saved && !dirty && <span style={{ fontSize: 12, color: 'var(--green)', marginLeft: 8 }}>✓</span>}
          </td>
        )}
      </tr>
      {showTest && (
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <td colSpan={columns.length + (canEdit ? 1 : 0)} style={{ padding: '0 14px 10px 0' }}>
            <RegexTestPanel pattern={draft.pattern} savedPattern={isNew ? null : row.pattern} names={names} loading={namesLoading} />
          </td>
        </tr>
      )}
    </>
  );
}

// Manages per-row drafts so a panel-level preview can run over the full candidate
// rule-set (saved rows with in-progress edits substituted) without writing.
function PatternList({ rows, columns, canEdit, onSave, addTemplate, names, namesLoading, renderPreview }) {
  const [drafts, setDrafts] = useState({});     // id -> { draft, dirty }
  const [adding, setAdding] = useState(null);

  const setRowDraft = (id, draft, dirty) => setDrafts((p) => ({ ...p, [id]: dirty ? draft : undefined }));
  const candidateRows = (rows ?? []).map((r) => (drafts[r.id] ? { ...r, ...drafts[r.id] } : r));
  const preview = renderPreview ? renderPreview(candidateRows) : null;

  return (
    <div>
      {preview}
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {columns.map((c) => <th key={c.key} style={{ ...TH, width: c.width }}>{c.label}</th>)}
              {canEdit && <th style={{ ...TH, width: 130 }} />}
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <PatternRow
                key={r.id} row={r} columns={columns} canEdit={canEdit}
                names={names} namesLoading={namesLoading} onSave={onSave}
                onDraftChange={(d, dirty) => setRowDraft(r.id, d, dirty)}
              />
            ))}
            {adding && (
              <PatternRow
                key="__new" row={adding} columns={columns} canEdit={canEdit} isNew
                names={names} namesLoading={namesLoading}
                onSave={async (d) => { await onSave(d); setAdding(null); }}
              />
            )}
          </tbody>
        </table>
      </div>
      {canEdit && !adding && (
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} onClick={() => setAdding({ ...addTemplate })}>+ Add rule</button>
      )}
    </div>
  );
}

function SegmentPreview({ preview }) {
  if (!preview || preview.changed === 0) return null;
  return (
    <PreviewBox>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <strong>{preview.changed}</strong> of {preview.total} ADV firms change segment:
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {preview.changes.slice(0, 8).map((c) => (
            <li key={c.id}>{c.firm_name}: {c.from} → {c.to}</li>
          ))}
          {preview.changes.length > 8 && <li>…and {preview.changes.length - 8} more</li>}
        </ul>
      </div>
      <div style={{ ...HINT, marginTop: 6 }}>ADV firms only — 13F segments use fixed composition rules the name-signal list does not govern.</div>
    </PreviewBox>
  );
}

function SegmentSignalsList({ canEdit }) {
  const q = useSegmentNameSignals();
  const segs = useSegmentOptions();
  const upsert = useUpsertSegmentNameSignal();
  const firmsQ = useSegmentPreviewFirms();
  const namesQ = useFirmNames();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '70%' }} />;
  const segOptions = (segs.data ?? []).map((s) => s.value_key);
  const columns = [
    { key: 'pattern', label: 'Pattern', mono: true, editable: true, width: 220 },
    { key: 'target_segment', label: 'Target', type: 'select', options: segOptions, editable: true, width: 150 },
    { key: 'signal_kind', label: 'Kind', mono: true, editable: false, width: 100 },
    { key: 'vetoes_hedge_fund', label: 'Vetoes HF', type: 'bool', editable: true, width: 90 },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCES, editable: true, width: 120 },
    { key: 'sort_order', label: 'Order', type: 'number', editable: true, width: 70 },
    { key: 'is_active', label: 'Active', type: 'bool', editable: true, width: 70 },
  ];
  const addTemplate = { pattern: '', target_segment: segOptions[0] ?? 'unknown', signal_kind: 'name_signal', vetoes_hedge_fund: false, confidence: 'low', sort_order: 99, is_active: true, promote_from: null };

  const renderPreview = (candidateRows) => {
    if (!firmsQ.data || !q.data) return null;
    const preview = previewSegmentReband({ firms: firmsQ.data, currentSignals: q.data, candidateSignals: candidateRows });
    return <SegmentPreview preview={preview} />;
  };

  return (
    <PatternList
      rows={q.data} columns={columns} canEdit={canEdit}
      onSave={(d) => upsert.mutateAsync(d)} addTemplate={addTemplate}
      names={namesQ.data} namesLoading={namesQ.isLoading}
      renderPreview={renderPreview}
    />
  );
}

function AdvFlagsList({ canEdit }) {
  const q = useAdvNameFlags();
  const upsert = useUpsertAdvNameFlag();
  const namesQ = useFirmNames();
  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '70%' }} />;
  const columns = [
    { key: 'pattern', label: 'Pattern', mono: true, editable: true, width: 220 },
    { key: 'implied_class', label: 'Implied class', type: 'text', editable: true, width: 150 },
    { key: 'verdict', label: 'Verdict', type: 'select', options: ADV_VERDICTS, editable: true, width: 130 },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCES, editable: true, width: 120 },
    { key: 'sort_order', label: 'Order', type: 'number', editable: true, width: 70 },
    { key: 'is_active', label: 'Active', type: 'bool', editable: true, width: 70 },
  ];
  const addTemplate = { pattern: '', implied_class: '', verdict: 'suspect', confidence: 'low', sort_order: 99, is_active: true };
  return (
    <PatternList
      rows={q.data} columns={columns} canEdit={canEdit}
      onSave={(d) => upsert.mutateAsync(d)} addTemplate={addTemplate}
      names={namesQ.data} namesLoading={namesQ.isLoading}
    />
  );
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

// ── Staleness banner + recompute (C4) ─────────────────────────────────────────

// After a config save the derived data reflects the OLD settings until a
// recompute runs. This banner surfaces that and enqueues the right backfill
// (relevance/segment → normalize; fit → fit-scores). It polls while the run is
// in flight and clears itself once the recompute completes (staleness re-derives).
function RecomputeBanner({ surface, canEdit }) {
  const group = recomputeGroup(surface);
  const staleQ = useStaleness(group);
  const recompute = useRecomputeNow(group);
  if (!group) return null;
  const s = staleQ.data;
  if (!s || (!s.stale && !s.active)) return null;

  const wrap = {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6,
    padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#92400e',
  };

  if (s.active) {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 14 }}>⟳</span>
        <span style={{ flex: 1 }}><strong>Recompute running…</strong> re-deriving {group.label}.</span>
        <Link to="/settings/pipelines" style={{ color: '#b45309', fontWeight: 600 }}>Watch in Data Pipelines →</Link>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <span style={{ fontSize: 14 }}>⚠</span>
      <span style={{ flex: 1 }}>{stalenessMessage(s.affected)} Recompute re-derives {group.label}.</span>
      {canEdit && (
        <button className="btn btn-sm btn-warning" disabled={recompute.pending || !recompute.ready} onClick={() => recompute.run()}>
          {recompute.pending ? 'Queuing…' : 'Recompute now'}
        </button>
      )}
      <Link to="/settings/pipelines" style={{ color: '#b45309', fontWeight: 600 }}>Data Pipelines →</Link>
      {recompute.error && <div style={{ flexBasis: '100%', color: 'var(--red)', fontSize: 12 }}>{recompute.error.message}</div>}
    </div>
  );
}

// ── Change-log viewer (C4) ────────────────────────────────────────────────────

const ACTION_COLOR = {
  insert: 'var(--green)', update: 'var(--text-secondary)', delete: 'var(--red)',
  activate: 'var(--green)', deactivate: 'var(--amber, #b45309)',
};

export function ChangeLogPanel({ canEdit }) {
  const q = useChangeLog({ limit: 500 });
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  if (q.isLoading) return <div className="skeleton skeleton-text" style={{ width: '70%' }} />;
  if (q.error) return <ErrorBanner message={q.error.message} />;

  const rows = q.data ?? [];
  const tables = distinctValues(rows, 'table_name');
  const actors = distinctValues(rows, 'actor_label');
  // `until` is an inclusive calendar day → extend the bound to end-of-day.
  const untilBound = until ? new Date(new Date(`${until}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined;
  const filtered = filterChangeLog(rows, {
    table: table || undefined, actor: actor || undefined,
    since: since ? `${since}T00:00:00` : undefined, until: untilBound,
  });

  const selStyle = { padding: '5px 8px', fontSize: 12.5 };

  return (
    <SectionCard
      title="Configuration change log"
      subtitle="config_change_log — append-only, trigger-written. Captures UI edits (attributed to the admin) and direct-SQL edits (actor 'postgres') alike. Admin-only."
    >
      {!canEdit && <ReadOnlyNotice />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <label style={{ ...LABEL }}>Table<br />
          <select className="form-input" style={selStyle} value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">All tables</option>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ ...LABEL }}>Actor<br />
          <select className="form-input" style={selStyle} value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">All actors</option>
            {actors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label style={{ ...LABEL }}>From<br />
          <input className="form-input" style={selStyle} type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label style={{ ...LABEL }}>To<br />
          <input className="form-input" style={selStyle} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        {(table || actor || since || until) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setTable(''); setActor(''); setSince(''); setUntil(''); }}>Clear</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        {filtered.length} of {rows.length} entries{rows.length >= 500 ? ' (most recent 500)' : ''}
      </div>

      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={TH}>When</th>
              <th style={TH}>Actor</th>
              <th style={TH}>Table</th>
              <th style={TH}>Row</th>
              <th style={TH}>Change</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ ...TD, color: 'var(--text-tertiary)', padding: '16px 0' }}>No matching entries.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>{r.actor_label ?? '—'}</td>
                <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{r.table_name}</td>
                <td style={{ ...TD, ...MONO, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatRowKey(r.row_key)}</td>
                <td style={{ ...TD }}>
                  <span style={{ color: ACTION_COLOR[r.action] ?? 'var(--text-secondary)', fontWeight: 600, marginRight: 6, textTransform: 'uppercase', fontSize: 10.5 }}>{r.action}</span>
                  <span style={MONO}>{describeChange(r)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Panels (one per tab) ──────────────────────────────────────────────────────

export function RelevanceConfigPanel({ canEdit }) {
  return (
    <div>
      {!canEdit && <ReadOnlyNotice />}
      <RecomputeBanner surface="relevance" canEdit={canEdit} />
      <SectionCard title="Relevance thresholds & knobs" subtitle="asset_class_relevance_config — the gate-then-score eligibility layer. Edit a threshold to preview the firm-level re-band before saving.">
        <RelevanceConfigForm canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="Served asset classes" subtitle="Which buckets count as served when computing served_fraction.">
        <ServedGrid canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="Verdict → action" subtitle="What each relevance verdict does (gate / penalize / pass).">
        <VerdictActionsGrid canEdit={canEdit} />
      </SectionCard>
      <SectionCard title="ADV name flags" subtitle="Negative name-flags for ADV firms with no 13F book. Edit a pattern and press Test to see which firms it matches.">
        <AdvFlagsList canEdit={canEdit} />
      </SectionCard>
    </div>
  );
}

export function SegmentsConfigPanel({ canEdit }) {
  return (
    <div>
      {!canEdit && <ReadOnlyNotice />}
      <RecomputeBanner surface="segment" canEdit={canEdit} />
      <SectionCard title="Segment name-signals" subtitle="Name → segment rules for ADV derivation. Edit a pattern and press Test for the blast radius; the preview shows how many firms change segment.">
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
