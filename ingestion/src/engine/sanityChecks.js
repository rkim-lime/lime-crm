/**
 * Automated post-ingest sanity checks.
 *
 * Three families (check_definitions):
 *   invariant — always-true property (fail = corruption)
 *   drift     — RE-DERIVE a stored value from its own stored inputs via the pure
 *               engine fn and assert equality (catches the mergeSignal-freeze class)
 *   delta     — between-runs comparison (uses check_results as the history store)
 *
 * Pure check logic lives in exported functions over already-loaded data (unit-
 * tested with fixtures). The runner loads data (filtering is_audit_only=false
 * structurally), dispatches active checks, writes check_results, folds tallies
 * into job_runs.stats.sanity, and returns the overall run status.
 *
 * Config is INJECTED — nothing here fetches except the runner's explicit loads.
 */

import { inferSegment, deriveAdvSegment } from './computeSignals.js';
import { computeFitScore } from './fitScore.js';
import {
  computeBreakdown, deriveRelevanceVerdict, deriveAdvRelevance,
  computeActivityMetrics,
} from './assetClass.js';

// ── Derivation dispatch: fn-name → pure re-derivation adapter ──────────────────
// Each adapter takes a context and returns the re-derived value. Adding a signal
// whose descriptor names a fn not present here throws → drift FAILS (coverage hole).
export const DERIVE_FNS = {
  inferSegment:      ({ firmName }) => inferSegment(firmName),
  deriveAdvSegment:  ({ firmName, raw, cfg }) =>
    deriveAdvSegment(firmName, raw.clientTypes ?? [], raw.advFlags?.hasPrivateFundClients ?? false, cfg.nameSignals ?? []).value,

  computeFitScore:   ({ prospect, cfg }) => computeFitScore(fitInput(prospect), cfg.fitScoreConfig ?? {}).score,

  // asset_class_relevance: re-derive the verdict from the STORED breakdown (13F)
  // or the ADV name path — mirrors computeAssetClassForProspect, cheaply.
  deriveRelevanceVerdict: ({ prospect, cfg }) => reRelevance(prospect, cfg),

  // per-filing metrics from the STORED asset_breakdown (no raw-holdings re-scan)
  servedFractionFromBreakdown:  ({ filing, cfg }) => servedFromBreakdown(filing.asset_breakdown, cfg.servedBuckets),
  optionsFractionFromBreakdown: ({ filing }) => optionsFromBreakdown(filing.asset_breakdown),
  // churn needs consecutive filings → recompute from holdings
  positionChurnFromFilings:     ({ filing, churnByFiling }) => churnByFiling[filing.id] ?? null,
};

function fitInput(p) {
  const ns = p.normalized_signals ?? {};
  return {
    estimated_aum_usd:      p.estimated_aum_usd,
    portfolio_turnover_pct: p.portfolio_turnover_pct,
    equities_pct:           p.equities_pct,
    options_present:        p.options_present,
    position_count:         p.position_count,
    segment_canonical:      p.segment_canonical ?? p.inferred_segment ?? '',
    clientTypes:            ns.client_types?.value ?? [],
    advFlags:               { hasPrivateFundClients: ns.has_private_fund_clients?.value ?? false },
  };
}

function servedFromBreakdown(breakdown, servedBuckets) {
  if (!breakdown) return null;
  const servedSet = new Set((servedBuckets ?? []).filter(b => b.served).map(b => b.bucket_key));
  let served = 0, total = 0;
  for (const [b, v] of Object.entries(breakdown)) { const val = Number(v?.value || 0); total += val; if (servedSet.has(b)) served += val; }
  return total > 0 ? served / total : null;
}
function optionsFromBreakdown(breakdown) {
  if (!breakdown) return null;
  let opt = 0, total = 0;
  for (const [b, v] of Object.entries(breakdown)) { const val = Number(v?.value || 0); total += val; if (b === 'option') opt += val; }
  return total > 0 ? Math.round((opt / total) * 10000) / 100 : null;
}
function reRelevance(prospect, cfg) {
  const bd = prospect.asset_class_breakdown;
  const config = cfg.relevanceConfig ?? {};
  if (bd && Object.keys(bd).length) {
    const servedSet = new Set((cfg.servedBuckets ?? []).filter(b => b.served).map(b => b.bucket_key));
    const byBucket = Object.fromEntries(Object.entries(bd).map(([k, v]) => [k, Number(v?.value || 0)]));
    const total = Object.values(byBucket).reduce((s, v) => s + v, 0);
    const served = Object.entries(byBucket).reduce((s, [k, v]) => s + (servedSet.has(k) ? v : 0), 0);
    return deriveRelevanceVerdict({
      served_fraction: total > 0 ? served / total : null,
      total_value: total, holdingCount: prospect.position_count ?? 0,
      byBucket, servedSet, config,
    }).verdict;
  }
  // No breakdown → ADV name path.
  return deriveAdvRelevance(prospect.firm_name, cfg.advNameFlags ?? [], config).verdict;
}

// ── Value comparison (tolerant for floats) ────────────────────────────────────
export function valuesMatch(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function dotGet(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ── DRIFT: stored value matches re-derivation ─────────────────────────────────
/**
 * For each signal_definition, resolve its derivation.target + re-derive from
 * stored inputs, compare to the stored value. A NULL/absent derivation, or a
 * derived fn missing from DERIVE_FNS, is a FAIL (coverage hole) — never skipped.
 * Returns { row_count, observed:{drift:[{prospect_id,signal_key,stored,derived}], undescribed:[...]}, expected }.
 */
export function checkDriftStoredMatchesDerived(prospects, signalDefs, cfg, filings = [], churnByFiling = {}) {
  const drift = [];
  const undescribed = [];
  const filingsByProspect = {};
  for (const f of filings) (filingsByProspect[f.prospect_id] ??= []).push(f);

  for (const def of signalDefs) {
    const d = def.derivation;
    if (d == null) { undescribed.push({ signal_key: def.signal_key, reason: 'null_derivation' }); continue; }
    if (d.kind === 'skip') continue; // reserved, explicit
    const target = d.target ?? {};

    for (const p of prospects) {
      // resolve stored + derived per target shape
      if (target.tuple) {
        const tuple = (p.normalized_signals ?? {})[target.tuple];
        if (!tuple) continue; // this prospect doesn't carry this signal
        const raw = rawFor(p, tuple.source);
        let derived;
        try { derived = deriveTuple(d, tuple.source, { firmName: p.firm_name, raw, cfg }); }
        catch (e) { drift.push({ prospect_id: p.id, signal_key: def.signal_key, error: e.message }); continue; }
        if (derived === undefined) { undescribed.push({ signal_key: def.signal_key, reason: `no fn for source ${tuple.source}` }); continue; }
        if (!valuesMatch(tuple.value, derived)) drift.push({ prospect_id: p.id, signal_key: def.signal_key, stored: tuple.value, derived });

      } else if (target.column) {
        const stored = p[target.column];
        if (stored == null) continue; // not computed for this firm
        const fn = DERIVE_FNS[d.fn];
        if (!fn) { undescribed.push({ signal_key: def.signal_key, reason: `no fn ${d.fn}` }); continue; }
        let derived; try { derived = fn({ prospect: p, cfg }); } catch (e) { drift.push({ prospect_id: p.id, signal_key: def.signal_key, error: e.message }); continue; }
        if (!valuesMatch(stored, derived)) drift.push({ prospect_id: p.id, signal_key: def.signal_key, stored, derived });

      } else if (target.filing_metric) {
        const fn = DERIVE_FNS[d.fn];
        if (!fn) { undescribed.push({ signal_key: def.signal_key, reason: `no fn ${d.fn}` }); continue; }
        for (const filing of filingsByProspect[p.id] ?? []) {
          const stored = filing.served_fraction != null && target.filing_metric === 'served_fraction'
            ? filing.served_fraction
            : (filing.activity_metrics ?? {})[target.filing_metric];
          if (stored == null) continue;
          let derived; try { derived = fn({ filing, cfg, churnByFiling }); } catch (e) { drift.push({ prospect_id: p.id, filing_id: filing.id, signal_key: def.signal_key, error: e.message }); continue; }
          if (derived != null && !valuesMatch(stored, derived)) drift.push({ prospect_id: p.id, filing_id: filing.id, signal_key: def.signal_key, stored, derived });
        }
      } else {
        undescribed.push({ signal_key: def.signal_key, reason: 'unknown target shape' });
      }
    }
  }
  const row_count = drift.length + undescribed.length;
  return { row_count, observed: { drift: drift.slice(0, 20), drift_count: drift.length, undescribed }, expected: { drift: 0, undescribed: 0 } };
}

function rawFor(prospect, source) {
  return (prospect.sources_by_key ?? {})[source] ?? {};
}
function deriveTuple(d, source, ctx) {
  if (d.kind === 'passthrough') {
    // pass-through: compare tuple.value vs raw[raw_key] (dot-path)
    return dotGet(ctx.raw, d.raw_key);
  }
  // derived
  const fnName = d.by_source ? d.by_source[source] : d.fn;
  if (!fnName) return undefined; // no fn for this source → undescribed
  const fn = DERIVE_FNS[fnName];
  if (!fn) return undefined;
  return fn(ctx);
}

// ── INVARIANTS ────────────────────────────────────────────────────────────────
export function checkAumNonnegative(prospects) {
  const bad = prospects.filter(p => (p.aum_canonical != null && p.aum_canonical < 0) || (p.estimated_aum_usd != null && p.estimated_aum_usd < 0));
  return { row_count: bad.length, observed: { negatives: bad.length, samples: bad.slice(0, 5).map(p => p.id) }, expected: { negatives: 0 } };
}
export function checkCompletenessRange(prospects) {
  const bad = prospects.filter(p => p.signal_completeness != null && (p.signal_completeness < 0 || p.signal_completeness > 1));
  return { row_count: bad.length, observed: { out_of_range: bad.length }, expected: { out_of_range: 0 } };
}
export function checkServedFractionRange(prospects) {
  const bad = prospects.filter(p => p.asset_class_served_fraction != null && (p.asset_class_served_fraction < 0 || p.asset_class_served_fraction > 1));
  return { row_count: bad.length, observed: { out_of_range: bad.length }, expected: { out_of_range: 0 } };
}
export function checkLayer3MirrorsLayer2(prospects, refs) {
  // Re-resolve canonical fields from normalized_signals and compare all promoted columns.
  const bad = [];
  for (const p of prospects) {
    const ns = p.normalized_signals; if (!ns) continue;
    const seg = resolveSegmentCanonical(ns, refs.segmentMappings);
    const aum = resolveAumCanonical(ns);
    const tier = resolveSizeTier(aum.value, refs.sizeBands);
    const mismatches = [];
    if (seg.value != null && !valuesMatch(p.segment_canonical, seg.value)) mismatches.push('segment_canonical');
    if (aum.value != null && !valuesMatch(p.aum_canonical, aum.value)) mismatches.push('aum_canonical');
    if (aum.value != null && !valuesMatch(p.aum_basis, aum.basis)) mismatches.push('aum_basis');
    if (aum.value != null && !valuesMatch(p.aum_source, aum.source)) mismatches.push('aum_source');
    if (aum.value != null && !valuesMatch(p.aum_as_of, aum.as_of)) mismatches.push('aum_as_of');
    if (aum.value != null && !valuesMatch(p.size_tier, tier)) mismatches.push('size_tier');
    if (mismatches.length) bad.push({ id: p.id, mismatches });
  }
  return { row_count: bad.length, observed: { mismatched_rows: bad.length, samples: bad.slice(0, 10) }, expected: { mismatched_rows: 0 } };
}
export function checkIrrelevantRequiresDominantNonserved(prospects, refs) {
  const servedSet = new Set((refs.servedBuckets ?? []).filter(b => b.served).map(b => b.bucket_key));
  const bad = prospects.filter(p => {
    if (p.asset_class_relevance !== 'irrelevant') return false;
    const bd = p.asset_class_breakdown; if (!bd) return true; // irrelevant with no breakdown = invalid
    let maxB = null, maxV = -Infinity;
    for (const [b, v] of Object.entries(bd)) { const val = Number(v?.value || 0); if (val > maxV) { maxV = val; maxB = b; } }
    return maxB == null || servedSet.has(maxB); // largest bucket is served → invalid irrelevant
  });
  return { row_count: bad.length, observed: { invalid_irrelevant: bad.length, samples: bad.slice(0, 5).map(p => p.id) }, expected: { invalid_irrelevant: 0 } };
}
export function checkSourceImpliesSourceRow(prospects) {
  // prospects already filtered is_audit_only=false by the runner.
  const bad = prospects.filter(p => p.source && !(p.sources_by_key && Object.keys(p.sources_by_key).length));
  return { row_count: bad.length, observed: { missing_source_row: bad.length, samples: bad.slice(0, 5).map(p => p.firm_name) }, expected: { missing_source_row: 0 } };
}
export function checkDedupResolvedHasMatchReason(dedupRows) {
  const bad = (dedupRows ?? []).filter(r => r.status && r.status !== 'pending' && (r.match_reason == null || r.match_reason === ''));
  return { row_count: bad.length, observed: { resolved_without_reason: bad.length, samples: bad.slice(0, 5).map(r => r.id) }, expected: { resolved_without_reason: 0 } };
}
export function checkConfigRegexCompiles(patternRows) {
  const bad = [];
  for (const r of patternRows ?? []) {
    try { new RegExp(r.pattern); } catch (e) { bad.push({ table: r._table, pattern: r.pattern, error: e.message }); }
  }
  return { row_count: bad.length, observed: { bad_patterns: bad }, expected: { bad_patterns: 0 } };
}
export function checkNoSegmentOver90pct(prospects, params) {
  const maxShare = params?.max_share ?? 0.90;
  const counts = {};
  let total = 0;
  for (const p of prospects) { if (p.segment_canonical == null) continue; counts[p.segment_canonical] = (counts[p.segment_canonical] ?? 0) + 1; total++; }
  let top = null, topN = 0;
  for (const [k, n] of Object.entries(counts)) if (n > topN) { topN = n; top = k; }
  const share = total > 0 ? topN / total : 0;
  const violated = share > maxShare;
  return { row_count: violated ? topN : 0, observed: { top_segment: top, share: Math.round(share * 1000) / 1000, max_share: maxShare }, expected: { max_share: maxShare } };
}

// ── DRIFT readback (secondary): a promoted write that didn't land ─────────────
export function checkDriftReadback(prospects) {
  // If normalized_signals carries a segment_inferred tuple, segment_canonical must be non-null.
  const bad = prospects.filter(p => (p.normalized_signals?.segment_inferred?.value != null) && p.segment_canonical == null);
  return { row_count: bad.length, observed: { unlanded_writes: bad.length, samples: bad.slice(0, 5).map(p => p.id) }, expected: { unlanded_writes: 0 } };
}

// ── DELTA (history via check_results) ─────────────────────────────────────────
export function checkSegmentDistributionShift(prospects, priorObserved, params) {
  const maxShiftPct = params?.max_shift_pct ?? 10;
  const dist = {};
  let total = 0;
  for (const p of prospects) { const k = p.segment_canonical ?? 'null'; dist[k] = (dist[k] ?? 0) + 1; total++; }
  const cur = Object.fromEntries(Object.entries(dist).map(([k, n]) => [k, total ? n / total : 0]));
  const observed = { distribution: cur, total };
  if (!priorObserved?.distribution) return { row_count: 0, observed, expected: { note: 'no prior baseline' } };
  // L1 distance in fraction of firms
  const keys = new Set([...Object.keys(cur), ...Object.keys(priorObserved.distribution)]);
  let shift = 0;
  for (const k of keys) shift += Math.abs((cur[k] ?? 0) - (priorObserved.distribution[k] ?? 0));
  const shiftPct = Math.round((shift / 2) * 1000) / 10; // 0..100
  observed.shift_pct = shiftPct;
  return { row_count: shiftPct > maxShiftPct ? 1 : 0, observed, expected: { max_shift_pct: maxShiftPct } };
}
export function checkDeltaConfigChangedNoRowsChanged(configSignature, priorObserved, rowsChanged) {
  const changed = priorObserved?.signature != null && priorObserved.signature !== configSignature;
  const violated = changed && (rowsChanged === 0);
  return { row_count: violated ? 1 : 0, observed: { signature: configSignature, config_changed: changed, rows_changed: rowsChanged }, expected: { note: 'config change should change some rows' } };
}

// ── Layer-2 → Layer-3 resolvers (local, dependency-free copies) ────────────────
function resolveAumCanonical(ns) {
  const adv = ns.aum_adv_regulatory, f13 = ns.aum_13f_portfolio;
  if (adv?.value != null) return { value: adv.value, basis: 'adv_regulatory', source: adv.source, as_of: adv.as_of ?? null };
  if (f13?.value != null) return { value: f13.value, basis: '13f_portfolio', source: f13.source, as_of: f13.as_of ?? null };
  return { value: null, basis: null, source: null, as_of: null };
}
function resolveSegmentCanonical(ns, mappings) {
  const seg = ns.segment_inferred; if (!seg?.value) return { value: null };
  const conn = seg.source === 'sec_13f' ? 'ingest_13f' : seg.source === 'sec_adv' ? 'ingest_adv' : seg.source;
  const m = (mappings ?? []).find(x => x.source === conn && x.source_value === seg.value);
  return { value: m ? m.canonical_value_key : seg.value };
}
function resolveSizeTier(aum, bands) {
  if (aum == null || !(bands?.length)) return null;
  for (const b of bands) { const above = b.min_aum == null || aum >= Number(b.min_aum); const below = b.max_aum == null || aum < Number(b.max_aum); if (above && below) return b.tier_key; }
  return null;
}

// ── Check registry: check_key → (defn, data) → result ─────────────────────────
const CHECK_FNS = {
  aum_nonnegative:                        (d) => checkAumNonnegative(d.prospects),
  completeness_range:                     (d) => checkCompletenessRange(d.prospects),
  served_fraction_range:                  (d) => checkServedFractionRange(d.prospects),
  layer3_mirrors_layer2:                  (d) => checkLayer3MirrorsLayer2(d.prospects, d.refs),
  irrelevant_requires_dominant_nonserved: (d) => checkIrrelevantRequiresDominantNonserved(d.prospects, d.refs),
  source_implies_source_row:              (d) => checkSourceImpliesSourceRow(d.prospects),
  dedup_resolved_has_match_reason:        (d) => checkDedupResolvedHasMatchReason(d.dedupRows),
  config_regex_compiles:                  (d) => checkConfigRegexCompiles(d.patternRows),
  no_segment_over_90pct:                  (d, def) => checkNoSegmentOver90pct(d.prospects, def.params),
  drift_stored_matches_derived:           (d) => checkDriftStoredMatchesDerived(d.prospects, d.signalDefs, d.cfg, d.filings, d.churnByFiling),
  drift_readback:                         (d) => checkDriftReadback(d.prospects),
  segment_distribution_shift:             (d, def) => checkSegmentDistributionShift(d.prospects, d.priorByKey[def.check_key], def.params),
  delta_config_changed_no_rows_changed:   (d, def) => checkDeltaConfigChangedNoRowsChanged(d.configSignature, d.priorByKey[def.check_key], d.rowsChanged),
};

function severityToStatus(severity, rowCount) {
  if (rowCount === 0) return 'pass';
  return severity === 'fail' ? 'fail' : 'warn';
}

/**
 * Run all active checks. Returns { overall: 'completed'|'completed_with_warnings'|
 * 'failed', results: [...], sanity: {...} }. Pure over the injected `data` bundle;
 * the runner wrapper below does the DB loads + writes.
 */
export function runChecks(data, definitions) {
  const results = [];
  let anyFail = false, anyWarn = false;
  for (const def of definitions) {
    if (def.is_active === false) continue;
    const fn = CHECK_FNS[def.check_key];
    if (!fn) { // an active check with no implementation is itself a failure
      results.push({ check_key: def.check_key, status: 'fail', observed: { error: 'no implementation' }, expected: {}, row_count: 1 });
      anyFail = true; continue;
    }
    const r = fn(data, def);
    const status = severityToStatus(def.severity, r.row_count);
    if (status === 'fail') anyFail = true;
    if (status === 'warn') anyWarn = true;
    results.push({ check_key: def.check_key, status, observed: r.observed, expected: r.expected, row_count: r.row_count });
  }
  const sanity = {
    checked: results.length,
    pass: results.filter(r => r.status === 'pass').length,
    warn: results.filter(r => r.status === 'warn').length,
    fail: results.filter(r => r.status === 'fail').length,
    rows_changed: data.rowsChanged ?? null,
  };
  const overall = anyFail ? 'failed' : anyWarn ? 'completed_with_warnings' : 'completed';
  return { overall, results, sanity };
}

// ── DB-loading runner + persistence ───────────────────────────────────────────

const AUDIT_FILTER = { column: 'is_audit_only', value: false }; // structural, not per-check

async function loadAll(supabase) {
  // NB: range pagination REQUIRES a stable order — without it PostgREST can
  // drop/duplicate rows across page boundaries (silently corrupting any
  // >1000-row load, e.g. prospect_holdings → wrong churn re-derivation).
  const page = async (table, select, orderCol = 'id', extra = q => q) => {
    let rows = [], offset = 0;
    while (true) {
      let q = supabase.from(table).select(select).order(orderCol, { ascending: true }).range(offset, offset + 999);
      const { data } = await extra(q);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
      offset += 1000;
    }
    return rows;
  };

  const prospects = await page(
    'prospects',
    'id, firm_name, source, estimated_aum_usd, position_count, portfolio_turnover_pct, equities_pct, options_present, inferred_segment, segment_canonical, aum_canonical, aum_basis, aum_source, aum_as_of, size_tier, signal_completeness, normalized_signals, asset_class_relevance, asset_class_breakdown, asset_class_served_fraction, fit_score',
    'id', q => q.eq(AUDIT_FILTER.column, AUDIT_FILTER.value),
  );
  const sources = await page('prospect_sources', 'prospect_id, source, signals', 'prospect_id');
  const byProspect = {};
  for (const s of sources) (byProspect[s.prospect_id] ??= {})[s.source] = s.signals ?? {};
  for (const p of prospects) p.sources_by_key = byProspect[p.id] ?? {};

  const dedupRows  = await page('dedup_queue', 'id, status, match_reason');
  const filings    = await page('prospect_filings', 'id, prospect_id, period_of_report, served_fraction, asset_breakdown, activity_metrics');
  const signalDefs = await page('signal_definitions', 'signal_key, derivation');

  // pattern rows for config_regex_compiles (tagged with source table)
  const tag = (rows, t) => (rows ?? []).map(r => ({ ...r, _table: t }));
  const patternRows = [
    ...tag(await page('segment_name_signals', 'pattern'), 'segment_name_signals'),
    ...tag(await page('asset_class_patterns', 'pattern'), 'asset_class_patterns'),
    ...tag(await page('relevance_adv_name_flags', 'pattern'), 'relevance_adv_name_flags'),
  ];

  // churn per filing (needs holdings) — recompute from the stored filing sequence
  const holdings = await page('prospect_holdings', 'filing_id, cusip, value_usd, put_call');
  const holdingsByFiling = {};
  for (const h of holdings) (holdingsByFiling[h.filing_id] ??= []).push(h);
  const filingsByProspect = {};
  for (const f of filings) (filingsByProspect[f.prospect_id] ??= []).push({ filing_id: f.id, period_of_report: f.period_of_report, holdings: holdingsByFiling[f.id] ?? [] });
  const churnByFiling = {};
  for (const list of Object.values(filingsByProspect)) {
    const m = computeActivityMetrics(list);
    for (const [fid, metrics] of Object.entries(m)) churnByFiling[fid] = metrics.position_churn_pct;
  }

  return { prospects, dedupRows, filings, signalDefs, patternRows, churnByFiling };
}

async function loadCfg(supabase) {
  const { loadNormalizationRefs } = await import('./normalize.js');
  const { loadFitScoreConfig }     = await import('./fitScore.js');
  const refs = await loadNormalizationRefs(supabase);
  const fitScoreConfig = await loadFitScoreConfig();
  return {
    nameSignals:     refs.nameSignals,
    segmentMappings: refs.segmentMappings,
    sizeBands:       refs.sizeBands,
    servedBuckets:   refs.servedBuckets,
    advNameFlags:    refs.advNameFlags,
    relevanceConfig: refs.relevanceConfig,
    fitScoreConfig,
    _refs: refs,
  };
}

async function loadPriorByKey(supabase, deltaKeys) {
  const out = {};
  for (const key of deltaKeys) {
    const { data } = await supabase.from('check_results')
      .select('observed').eq('check_key', key).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data?.observed) out[key] = data.observed;
  }
  return out;
}

/**
 * Load everything, run active checks, persist check_results, and return
 * { overall, sanity }. `opts`: { jobRunId, gitSha, rowsChanged }.
 */
export async function runSanityChecks(ctx, { jobRunId = null, gitSha = null, rowsChanged = null, persist = true } = {}) {
  const { supabase, logger } = ctx;

  const { data: definitions } = await supabase
    .from('check_definitions').select('*').eq('is_active', true).order('sort_order');
  const defs = definitions ?? [];

  const [data, cfg] = await Promise.all([loadAll(supabase), loadCfg(supabase)]);
  const deltaKeys = defs.filter(d => d.family === 'delta').map(d => d.check_key);
  const priorByKey = await loadPriorByKey(supabase, deltaKeys);

  const configSignature = signatureOf(cfg);
  const bundle = {
    ...data,
    refs: { segmentMappings: cfg.segmentMappings, sizeBands: cfg.sizeBands, servedBuckets: cfg.servedBuckets },
    cfg,
    priorByKey,
    configSignature,
    rowsChanged,
  };

  const { overall, results, sanity } = runChecks(bundle, defs);

  // persist results (skipped for a dry-run preview)
  if (persist && results.length) {
    const rows = results.map(r => ({
      job_run_id: jobRunId, check_key: r.check_key, status: r.status,
      observed: r.observed, expected: r.expected, row_count: r.row_count,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('check_results').insert(rows.slice(i, i + 100));
      if (error) logger?.warn(`sanity: check_results insert — ${error.message}`);
    }
  }

  sanity.git_sha = gitSha;
  logger?.info(`Sanity: ${sanity.pass} pass / ${sanity.warn} warn / ${sanity.fail} fail → ${overall}`);
  return { overall, sanity, results };
}

function signatureOf(cfg) {
  // Content signature of the config surfaces a check depends on (stable JSON).
  const stable = (rows, keys) => JSON.stringify((rows ?? []).map(r => keys.map(k => r[k])).sort());
  return JSON.stringify({
    nameSignals: stable(cfg.nameSignals, ['pattern', 'target_segment', 'signal_kind', 'vetoes_hedge_fund', 'confidence']),
    servedBuckets: stable(cfg.servedBuckets, ['bucket_key', 'served']),
    relevanceConfig: cfg.relevanceConfig,
    fitTierRatios: cfg.fitScoreConfig?.tierRatios,
  });
}
