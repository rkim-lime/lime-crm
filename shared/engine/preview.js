/**
 * Config-UI preview / dry-run — pure delta computation for unsaved edits.
 *
 * The load-bearing rule (CONFIG_UI_BUILD.md, "Implementation traps"): NEVER
 * reimplement engine logic here. Every prediction delegates to the SAME
 * config-injected functions the ingestion engine runs — deriveRelevanceVerdict,
 * deriveAdvSegment, computeFitScore — so preview/actual agreement is true by
 * construction, not by luck. This module only marshals STORED inputs into those
 * functions under two configs (current vs candidate) and diffs the results.
 *
 * Lives in shared/engine so the Vite frontend and the vitest suite import the
 * exact same code path. Zero runtime-specific imports (no supabase, no React).
 */

import { deriveRelevanceVerdict, verdictAction } from './assetClass.js';
import { deriveAdvSegment } from './computeSignals.js';
import { computeFitScore } from './fitScore.js';

export const RELEVANCE_VERDICTS = ['relevant', 'likely_relevant', 'suspect', 'irrelevant', 'unknown'];

function emptyCounts() {
  return Object.fromEntries(RELEVANCE_VERDICTS.map((v) => [v, 0]));
}

// ── Relevance re-band ─────────────────────────────────────────────────────────

/**
 * Reconstruct deriveRelevanceVerdict's inputs from a STORED firm row. No
 * holdings traversal — served_fraction and the value-weighted breakdown are
 * already persisted (prospects.asset_class_served_fraction / asset_class_breakdown).
 * `breakdown` shape: { bucket: { value, fraction } } (or bucket → number).
 */
export function firmRelevanceInputs(firm) {
  const byBucket = firm.byBucket ?? Object.fromEntries(
    Object.entries(firm.breakdown ?? {}).map(([b, v]) => [b, Number((v && typeof v === 'object') ? v.value ?? 0 : v ?? 0)]),
  );
  const total_value = firm.total_value ?? Object.values(byBucket).reduce((s, v) => s + v, 0);
  const holdingCount = firm.holdingCount ?? firm.position_count ?? null;
  return { served_fraction: firm.served_fraction, total_value, holdingCount, byBucket };
}

/** Single firm's verdict under `config`. `servedSet` is a Set of served bucket_keys. */
export function rebandVerdict(firm, config, servedSet) {
  const inputs = firmRelevanceInputs(firm);
  return deriveRelevanceVerdict({ ...inputs, servedSet, config }).verdict;
}

/**
 * Predict the effect of an asset_class_relevance_config edit across stored firms.
 * Both current and candidate verdicts are computed by the SAME engine fn on the
 * SAME stored inputs, so `moved`/transitions are exactly what a recompute yields.
 *
 * `servedSet` — Set of currently-served bucket_keys (served toggles are not part
 * of a threshold preview; changing them would need holdings, out of scope here).
 * `verdictActions` — relevance_verdict_actions rows, to count gate transitions
 * faithfully (default: only 'irrelevant' gates).
 */
export function previewRelevanceReband({ firms, currentConfig, candidateConfig, servedSet, verdictActions }) {
  const from = emptyCounts();
  const to = emptyCounts();
  const transitions = {};
  const changedFirms = [];
  let moved = 0;
  let gatedBefore = 0;
  let gatedAfter = 0;
  const gates = (verdict) => verdictAction(verdict, verdictActions ?? [{ verdict: 'irrelevant', action: 'gate' }]) === 'gate';

  for (const firm of firms ?? []) {
    const before = rebandVerdict(firm, currentConfig, servedSet);
    const after = rebandVerdict(firm, candidateConfig, servedSet);
    from[before] = (from[before] ?? 0) + 1;
    to[after] = (to[after] ?? 0) + 1;
    if (gates(before)) gatedBefore++;
    if (gates(after)) gatedAfter++;
    if (before !== after) {
      moved++;
      const key = `${before}→${after}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
      changedFirms.push({ id: firm.id, firm_name: firm.firm_name, from: before, to: after });
    }
  }

  return {
    total: (firms ?? []).length,
    counts: { from, to },
    moved,
    transitions,
    gated: { before: gatedBefore, after: gatedAfter, delta: gatedAfter - gatedBefore },
    changedFirms,
  };
}

// ── Segment re-derive (ADV firms only) ────────────────────────────────────────

/**
 * Predict the effect of a segment_name_signals edit. deriveAdvSegment is re-run
 * over each firm's STORED clientTypes + firm name under current vs candidate
 * signal rules. ADV firms only — 13F segments use fixed composition rules the
 * name-signal list does not govern; the caller must pass ADV firms.
 */
export function previewSegmentReband({ firms, currentSignals, candidateSignals }) {
  const changes = [];
  for (const f of firms ?? []) {
    const before = deriveAdvSegment(f.firm_name, f.clientTypes ?? [], f.hasPrivateFundClients ?? false, currentSignals ?? []).value;
    const after = deriveAdvSegment(f.firm_name, f.clientTypes ?? [], f.hasPrivateFundClients ?? false, candidateSignals ?? []).value;
    if (before !== after) changes.push({ id: f.id, firm_name: f.firm_name, from: before, to: after });
  }
  return { total: (firms ?? []).length, changed: changes.length, changes };
}

// ── Fit-score distribution shift ──────────────────────────────────────────────

const FIT_BANDS = [
  { key: '80–100', min: 80 }, { key: '60–79', min: 60 }, { key: '40–59', min: 40 },
  { key: '20–39', min: 20 }, { key: '0–19', min: 0 },
];
const fitBand = (score) => (FIT_BANDS.find((b) => score >= b.min) ?? FIT_BANDS[FIT_BANDS.length - 1]).key;

/**
 * Predict the fit-score distribution shift from a weights/tier-ratio edit.
 * computeFitScore is the same pure scorer the fit backfill runs; `firms` are
 * its scoringInput shape. Config bundles: { weights, segmentTiers, tierRatios }.
 */
export function previewFitDistribution({ firms, currentCfg, candidateCfg }) {
  const before = Object.fromEntries(FIT_BANDS.map((b) => [b.key, 0]));
  const after = Object.fromEntries(FIT_BANDS.map((b) => [b.key, 0]));
  let sumBefore = 0;
  let sumAfter = 0;
  let changed = 0;
  for (const f of firms ?? []) {
    const b = computeFitScore(f, currentCfg ?? {}).score;
    const a = computeFitScore(f, candidateCfg ?? {}).score;
    before[fitBand(b)]++; after[fitBand(a)]++;
    sumBefore += b; sumAfter += a;
    if (a !== b) changed++;
  }
  const n = (firms ?? []).length || 1;
  return {
    total: (firms ?? []).length,
    changed,
    distribution: { before, after },
    mean: { before: Math.round((sumBefore / n) * 10) / 10, after: Math.round((sumAfter / n) * 10) / 10 },
  };
}

// ── Regex test panel + validation ─────────────────────────────────────────────

/** Compile-validate a pattern. { ok } or { ok:false, error }. Never throws. */
export function compileRegex(pattern) {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, 'i');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Run a pattern against real names (prospects.firm_name). Never crashes on a bad
 * regex — returns { ok:false, error } instead. On success:
 * { ok, count, total, samples (≤12), matched }.
 */
export function matchNames(pattern, names) {
  const c = compileRegex(pattern);
  if (!c.ok) return { ok: false, error: c.error, count: 0, total: (names ?? []).length, samples: [], matched: [] };
  const re = new RegExp(pattern, 'i');
  const matched = (names ?? []).filter((n) => re.test(n ?? ''));
  return { ok: true, count: matched.length, total: (names ?? []).length, samples: matched.slice(0, 12), matched };
}

/**
 * Diff an edited pattern against its current value over real names:
 * "was N → now M (+added / −removed)". Blocks (ok:false) on an invalid new pattern.
 */
export function patternDiff(oldPattern, newPattern, names) {
  const after = matchNames(newPattern, names);
  if (!after.ok) return { ok: false, error: after.error };
  const before = matchNames(oldPattern, names);
  const beforeMatched = before.ok ? before.matched : [];
  const beforeSet = new Set(beforeMatched);
  const afterSet = new Set(after.matched);
  return {
    ok: true,
    beforeCount: before.ok ? before.count : null,
    afterCount: after.count,
    added: after.matched.filter((n) => !beforeSet.has(n)),
    removed: beforeMatched.filter((n) => !afterSet.has(n)),
  };
}

// ── asset_class_relevance_config guardrails ───────────────────────────────────

/**
 * Threshold ordering must hold: irrelevant_max < likely_min < relevant_min.
 * Reject inversions BEFORE save (CONFIG_UI_BUILD.md decision 6).
 */
export function validateThresholdOrder(config) {
  const irr = Number(config?.irrelevant_max_fraction);
  const lik = Number(config?.likely_min_fraction);
  const rel = Number(config?.relevant_min_fraction);
  if (![irr, lik, rel].every(Number.isFinite)) {
    return { ok: false, error: 'Relevance thresholds must all be numbers.' };
  }
  if (!(irr < lik && lik < rel)) {
    return {
      ok: false,
      error: `Thresholds must satisfy irrelevant_max (${irr}) < likely_min (${lik}) < relevant_min (${rel}).`,
    };
  }
  return { ok: true };
}

/** True when an edit flips gate_on_absence off→on (the HFT-exclusion confirmation gate). */
export function turningOnGateAbsence(prev, next) {
  return prev?.gate_on_absence !== true && next?.gate_on_absence === true;
}
