/**
 * Asset-class relevance — the eligibility layer of the gate-then-score funnel.
 *
 * Value-weighted 13F asset-class breakdown → per-firm relevance verdict, kept
 * SEPARATE from the fit score. EVERYTHING is config-driven (migration 026):
 *   - asset_class_patterns          → classifier rules + precedence (sort_order)
 *   - served_asset_classes          → which buckets count as served
 *   - relevance_adv_name_flags      → ADV negative-name soft flags
 *   - asset_class_relevance_config  → thresholds/knobs (no inline constants)
 *   - relevance_verdict_actions     → verdict → gate/penalize/pass
 *
 * The pure functions take config as arguments (offline-testable). The DB
 * orchestrator (computeAssetClassForProspect) reads holdings/filings and
 * persists per-filing breakdowns + the firm verdict. Called from the
 * normalization path so backfill == live.
 */

import { computeTurnover } from './computeSignals.js';

// ── Classifier ──────────────────────────────────────────────────────────────

/**
 * Classify a single holding into an asset-class bucket.
 * put_call → 'option' FIRST (structural: the authoritative option flag; ~24% of
 * 13F value wears equity-like class_titles). Then class_title / etf_name
 * patterns applied by sort_order precedence. Unmatched → 'other' (fail-safe).
 *
 * `patterns`: rows from asset_class_patterns. pattern_kind 'class_title' matches
 * class_title; 'etf_name' matches issuer_name (fund-name assist).
 */
export function classifyHolding(holding, patterns) {
  if (holding?.put_call) return 'option';

  const title  = holding?.class_title ?? '';
  const issuer = holding?.issuer_name ?? '';

  const sorted = [...(patterns ?? [])]
    .filter(p => p?.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  for (const p of sorted) {
    let re;
    try { re = new RegExp(p.pattern, 'i'); } catch { continue; }
    const target = p.pattern_kind === 'etf_name' ? issuer : title;
    if (re.test(target)) return p.bucket;
  }
  return 'other';
}

/**
 * Value-weighted bucket breakdown for a set of holdings.
 * Returns served_fraction = served value ÷ total — NULL when total is 0 (an
 * empty book is undefined, NOT 0; this protects the absence path downstream).
 */
export function computeBreakdown(holdings, patterns, servedBuckets) {
  const servedSet = new Set((servedBuckets ?? []).filter(b => b.served).map(b => b.bucket_key));
  const byBucket = {};
  let total = 0;
  for (const h of holdings ?? []) {
    const b = classifyHolding(h, patterns);
    const v = Number(h.value_usd || 0);
    byBucket[b] = (byBucket[b] ?? 0) + v;
    total += v;
  }
  const breakdown = {};
  let servedValue = 0;
  for (const [b, v] of Object.entries(byBucket)) {
    breakdown[b] = { value: v, fraction: total > 0 ? v / total : null };
    if (servedSet.has(b)) servedValue += v;
  }
  return {
    breakdown,
    byBucket,
    servedSet,
    total_value:            total,
    served_fraction:        total > 0 ? servedValue / total : null,
    detected_asset_classes: Object.keys(byBucket),
  };
}

/** The single largest bucket by value is a served=false bucket (positive non-served dominance). */
export function isNonServedDominant(byBucket, servedSet) {
  let maxB = null, maxV = -Infinity;
  for (const [b, v] of Object.entries(byBucket ?? {})) {
    if (v > maxV) { maxV = v; maxB = b; }
  }
  return maxB != null && !(servedSet instanceof Set ? servedSet.has(maxB) : false);
}

// ── Verdict derivation ──────────────────────────────────────────────────────

/**
 * 13F verdict from a filing breakdown, applying the CONFIRMED absence routing.
 *   Guard 1 (FIRST): holdings < min_holdings OR empty/zero-value → 'unknown'
 *     (never gated; respects gate_on_absence=false). Banding is unreachable
 *     for thin books, so served_fraction=0-from-no-holdings can never be gated.
 *   Bands (only with a sufficient book): served ≥ relevant_min → relevant;
 *     ≥ likely_min → likely_relevant; ≤ irrelevant_max AND non-served bucket
 *     dominant → irrelevant; else suspect.
 * All thresholds come from `config` (asset_class_relevance_config).
 */
export function deriveRelevanceVerdict({ served_fraction, total_value, holdingCount, byBucket, servedSet, config }) {
  const minHoldings    = config?.min_holdings ?? 10;
  const minServedValue = config?.min_served_value ?? null;

  const insufficient =
    !holdingCount || holdingCount < minHoldings ||
    !total_value || total_value <= 0 ||
    (minServedValue != null && total_value < minServedValue);
  if (insufficient) return { verdict: 'unknown', confidence: 'low', reason: 'insufficient_holdings' };

  const relMin = config?.relevant_min_fraction ?? 0.80;
  const likMin = config?.likely_min_fraction ?? 0.50;
  const irrMax = config?.irrelevant_max_fraction ?? 0.20;

  if (served_fraction >= relMin) return { verdict: 'relevant',        confidence: 'high',   reason: 'high_served' };
  if (served_fraction >= likMin) return { verdict: 'likely_relevant', confidence: 'medium', reason: 'moderate_served' };

  if (served_fraction <= irrMax && isNonServedDominant(byBucket, servedSet)) {
    return { verdict: 'irrelevant', confidence: 'high', reason: 'non_served_dominant' };
  }
  return { verdict: 'suspect', confidence: 'low', reason: 'low_served_not_dominant' };
}

/** Match a firm name against relevance_adv_name_flags (strongest sort_order first). */
export function matchAdvNameFlags(firmName, nameFlags) {
  const name = firmName ?? '';
  const out = [];
  for (const f of nameFlags ?? []) {
    if (f?.is_active === false) continue;
    let re;
    try { re = new RegExp(f.pattern, 'i'); } catch { continue; }
    if (re.test(name)) out.push(f);
  }
  return out.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
}

/**
 * ADV verdict (no sufficient 13F book): a negative name-flag → suspect (soft,
 * low-conf, review flag) — a name NEVER auto-gates. No signal →
 * no_signal_adv_default from config. Returns { verdict, confidence, flags }.
 */
export function deriveAdvRelevance(firmName, nameFlags, config) {
  const m = matchAdvNameFlags(firmName, nameFlags);
  if (m.length) {
    const top = m[0];
    return {
      verdict:    top.verdict ?? 'suspect',
      confidence: top.confidence ?? 'low',
      flags:      { review: true, adv_name_flag: top.implied_class },
    };
  }
  return { verdict: config?.no_signal_adv_default ?? 'likely_relevant', confidence: 'low', flags: {} };
}

/**
 * Positive-lead trigger: AUM ≥ possible_hft_min_aum AND a tiny book
 * (holdings < min_holdings). When possible_hft_requires_13f_filer is true
 * (default), the firm must ALSO be a 13F filer (has13fFiling) — an adviser with
 * no 13F at all is expected (private-fund/sub-threshold/non-US), not a flat-
 * overnight mismatch. Set the knob false to restore AUM+holdings-only behavior.
 */
export function computePossibleHft({ aum, holdingCount, has13fFiling = false, config }) {
  const minAum      = config?.possible_hft_min_aum ?? 1_000_000_000;
  const minHoldings = config?.min_holdings ?? 10;
  const requires13f = config?.possible_hft_requires_13f_filer ?? true;

  const aumOk = aum != null && aum >= minAum;
  const tiny  = !holdingCount || holdingCount < minHoldings;
  if (!aumOk || !tiny) return false;
  if (requires13f && !has13fFiling) return false;
  return true;
}

/** Resolve a verdict to its configured action (gate/penalize/pass) from relevance_verdict_actions. */
export function verdictAction(verdict, verdictActions) {
  const row = (verdictActions ?? []).find(v => v.verdict === verdict);
  return row?.action ?? 'pass';
}

// ── Time-series activity metrics (compute + store; NOT scored yet) ──────────

const toTurnoverShape = h => ({ cusip: h.cusip, valueUsd: Number(h.value_usd || 0) });

/** Fraction of the book that changed q/q by CUSIP: |symmetric diff| ÷ |union|. */
export function positionChurn(curHoldings, priorHoldings) {
  const cur = new Set((curHoldings ?? []).map(h => h.cusip));
  const pri = new Set((priorHoldings ?? []).map(h => h.cusip));
  if (cur.size === 0 && pri.size === 0) return null;
  const union = new Set([...cur, ...pri]);
  let changed = 0;
  for (const c of union) if (cur.has(c) !== pri.has(c)) changed++;
  return union.size ? Math.round((changed / union.size) * 10000) / 100 : null;
}

/**
 * Per-filing activity metrics across a firm's filing history.
 * `filings`: [{ filing_id, period_of_report, holdings: [...] }]. Returns a map
 * filing_id → { position_count, options_value_fraction, turnover_pct,
 * position_churn_pct, position_count_delta }. Turnover reuses computeTurnover.
 */
export function computeActivityMetrics(filings) {
  const sorted = [...(filings ?? [])].sort(
    (a, b) => String(a.period_of_report ?? '').localeCompare(String(b.period_of_report ?? '')),
  );
  const out = {};
  for (let i = 0; i < sorted.length; i++) {
    const cur  = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const curH = cur.holdings ?? [];
    const totVal = curH.reduce((s, h) => s + Number(h.value_usd || 0), 0);
    const optVal = curH.filter(h => h.put_call).reduce((s, h) => s + Number(h.value_usd || 0), 0);
    out[cur.filing_id] = {
      position_count:         curH.length,
      options_value_fraction: totVal > 0 ? Math.round((optVal / totVal) * 10000) / 100 : null,
      turnover_pct:           prev ? computeTurnover(curH.map(toTurnoverShape), (prev.holdings ?? []).map(toTurnoverShape)) : null,
      position_churn_pct:     prev ? positionChurn(curH, prev.holdings) : null,
      position_count_delta:   prev ? curH.length - (prev.holdings?.length ?? 0) : null,
    };
  }
  return out;
}
