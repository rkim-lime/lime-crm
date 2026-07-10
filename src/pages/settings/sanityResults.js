// Pure helpers for the sanity-check results UI (Part C).
//
// No React / no DOM / no Supabase — every function here is a pure transform so it
// can be unit-tested directly (see sanityResults.test.js). The React components in
// DataPipelines.jsx and the data hook in useJobs.js are thin wrappers over these.
//
// Shapes come from ingestion/src/engine/sanityChecks.js:
//   stats.sanity = { checked, pass, warn, fail, rows_changed, git_sha }
//   check_results row = { check_key, status: pass|warn|fail, observed, expected, row_count }
//   drift observed    = { drift: [{prospect_id, signal_key, stored, derived}|{...error}], drift_count, undescribed:[keys] }
//   id-sample observed= { <count_key>, samples: [prospect_id …] }   (aum_nonnegative, drift_readback, …)
//   object-sample     = { <count_key>, samples: [{id, mismatches:[…]}] }   (layer3_mirrors_layer2)
//   dedup observed    = { resolved_without_reason, samples: [dedup_queue.id …] }
//   name-sample       = { missing_source_row, samples: [firm_name …] }   (source_implies_source_row)
//   count-only        = { out_of_range }   (completeness_range, served_fraction_range) → JSON fallback

const DRIFT_KEY = 'drift_stored_matches_derived';
const DEDUP_KEY = 'dedup_resolved_has_match_reason';

// ── Run status badge meta (adds completed_with_warnings — the point of the build) ──
export const RUN_STATUS_META = {
  queued:                  { bg: '#f1f5f9', color: '#64748b', label: 'Queued' },
  running:                 { bg: '#eff6ff', color: '#2563eb', label: 'Running', pulse: true },
  completed:               { bg: '#f0fdf4', color: '#16a34a', label: 'Completed' },
  completed_with_warnings: { bg: '#fefce8', color: '#ca8a04', label: 'Completed (warnings)' },
  failed:                  { bg: '#fef2f2', color: '#dc2626', label: 'Failed' },
  cancelled:               { bg: '#f8fafc', color: '#94a3b8', label: 'Cancelled' },
};

export function runStatusMeta(status) {
  return RUN_STATUS_META[status] ?? RUN_STATUS_META.queued;
}

// ── Check-result pill (colour by outcome status) ──
export const CHECK_STATUS_PILL = {
  pass: { bg: '#f0fdf4', color: '#16a34a', label: 'pass' },
  warn: { bg: '#fefce8', color: '#ca8a04', label: 'warn' },
  fail: { bg: '#fef2f2', color: '#dc2626', label: 'fail' },
};

const STATUS_RANK = { fail: 0, warn: 1, pass: 2 };
export function sortResults(results) {
  return [...(results ?? [])].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3),
  );
}

// ── Runs-table dot: red if any fail, else yellow if any warn, else none ──
export function sanityDotColor(sanity) {
  if (!sanity) return null;
  if ((sanity.fail ?? 0) > 0) return '#dc2626';
  if ((sanity.warn ?? 0) > 0) return '#ca8a04';
  return null;
}

// The flat "Results" tiles must NOT render the nested sanity object → [object Object].
// Exclude it (and any other non-primitive) — sanity gets its own dedicated section.
export function flatStatEntries(stats) {
  return Object.entries(stats ?? {}).filter(
    ([k, v]) => k !== 'sanity' && v != null && typeof v !== 'object',
  );
}

// Header tallies for the sanity section — primitives only, never [object Object].
export function sanitySummaryParts(sanity) {
  if (!sanity) return [];
  const parts = [
    { key: 'checked', label: 'checked', value: sanity.checked ?? 0 },
    { key: 'pass',    label: 'pass',    value: sanity.pass ?? 0 },
    { key: 'warn',    label: 'warn',    value: sanity.warn ?? 0 },
    { key: 'fail',    label: 'fail',    value: sanity.fail ?? 0 },
  ];
  if (sanity.rows_changed != null) {
    parts.push({ key: 'rows_changed', label: 'rows changed', value: sanity.rows_changed });
  }
  return parts;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function looksLikeUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function fmtVal(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function prettyJson(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

// First renderable array in an observed payload, in priority order.
function firstArray(observed) {
  if (!observed || typeof observed !== 'object') return null;
  for (const k of ['samples', 'bad_patterns', 'drift']) {
    if (Array.isArray(observed[k])) return { key: k, arr: observed[k] };
  }
  return null;
}

// 'drift' → dedicated table; 'table' → clean sample table; 'json' → pretty-print fallback.
export function classifyObserved(checkKey, observed) {
  if (checkKey === DRIFT_KEY && Array.isArray(observed?.drift)) return 'drift';
  if (firstArray(observed)) return 'table';
  return 'json';
}

// Ids needing resolution — returned as flat de-dup-able lists so the hook does ONE
// batch query per entity type (never N+1). Dedup ids resolve via dedup_queue.
export function collectResolution(results) {
  const prospectIds = new Set();
  const dedupIds = new Set();
  for (const r of results ?? []) {
    const obs = r.observed;
    if (r.check_key === DRIFT_KEY && Array.isArray(obs?.drift)) {
      for (const d of obs.drift) if (looksLikeUuid(d.prospect_id)) prospectIds.add(d.prospect_id);
      continue;
    }
    const fa = firstArray(obs);
    if (!fa) continue;
    if (r.check_key === DEDUP_KEY) {
      for (const s of fa.arr) if (looksLikeUuid(s)) dedupIds.add(s);
      continue;
    }
    for (const s of fa.arr) {
      if (looksLikeUuid(s)) prospectIds.add(s);
      else if (s && typeof s === 'object' && looksLikeUuid(s.id)) prospectIds.add(s.id);
    }
  }
  return { prospectIds: [...prospectIds], dedupIds: [...dedupIds] };
}

const firmName = (id, firmById) =>
  firmById?.[id] ?? (id ? `${String(id).slice(0, 8)}…` : '—');

// Build a clean [{columns, rows, note?, more?}] table for a known shape.
// Returns null to signal "unknown shape — caller should JSON-fallback" (never crash).
export function buildObservedTable(checkKey, observed, maps = {}) {
  const { firmById = {}, dedupById = {} } = maps;

  // drift: [Firm | Signal | Stored → Derived]
  if (checkKey === DRIFT_KEY && Array.isArray(observed?.drift)) {
    const rows = observed.drift.map((d) => [
      firmName(d.prospect_id, firmById),
      d.signal_key ?? '—',
      d.error ? `error: ${d.error}` : `${fmtVal(d.stored)} → ${fmtVal(d.derived)}`,
    ]);
    const note = observed.undescribed?.length
      ? `${observed.undescribed.length} signal(s) lack a derivation descriptor: ${observed.undescribed.join(', ')}`
      : null;
    const more = Math.max(0, (observed.drift_count ?? rows.length) - rows.length);
    return { columns: ['Firm', 'Signal', 'Stored → Derived'], rows, note, more };
  }

  const fa = firstArray(observed);
  if (!fa || !fa.arr.length) return null;
  const arr = fa.arr;

  // dedup: [Firm(s) | dedup queue row]
  if (checkKey === DEDUP_KEY) {
    return {
      columns: ['Firm(s)', 'Dedup queue row'],
      rows: arr.map((id) => {
        const dq = dedupById[id];
        const firms = dq
          ? [firmName(dq.prospect_id, firmById), dq.matched_name].filter(Boolean).join('  ×  ')
          : '—';
        return [firms, typeof id === 'string' ? `${id.slice(0, 8)}…` : String(id)];
      }),
    };
  }

  // array of objects (e.g. layer3 {id, mismatches})
  if (arr.every((x) => x && typeof x === 'object')) {
    const hasId = arr.some((x) => looksLikeUuid(x.id));
    const otherKeys = [...new Set(arr.flatMap((x) => Object.keys(x)))].filter((k) => k !== 'id');
    const columns = [...(hasId ? ['Firm'] : []), ...otherKeys];
    const rows = arr.map((x) => [
      ...(hasId ? [firmName(x.id, firmById)] : []),
      ...otherKeys.map((k) => fmtVal(x[k])),
    ]);
    return { columns, rows };
  }

  // array of scalars: prospect-id uuids → firm names; otherwise raw values
  if (arr.every(looksLikeUuid)) {
    return { columns: ['Firm'], rows: arr.map((id) => [firmName(id, firmById)]) };
  }
  const label = fa.key === 'bad_patterns' ? 'Bad pattern' : 'Value';
  return { columns: [label], rows: arr.map((v) => [fmtVal(v)]) };
}
