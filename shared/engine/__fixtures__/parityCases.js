// Golden parity fixtures for shared/engine — REAL config pulled from the DB
// (scoring_config, taxonomy_values, fit_tier_ratios, asset_class_relevance_config,
// served_asset_classes, segment_name_signals) on 2026-07-13. Not synthetic.
//
// The SAME cases are asserted from BOTH the ingestion vitest suite
// (ingestion/tests/parity.test.js) and the frontend vitest suite
// (src/engine/parity.test.js). Both green ⇒ the two toolchains import the same
// shared source and compute identically; any divergence fails loudly.
//
// Anchors baked in: Point72 → asset_manager / relevant; wealth_manager fit_tier
// ratio → 0.25; empty-13F → unknown (not gated); debt-dominant book → irrelevant.

export const CONFIG = {
  weights: {
    aum_tier: 19, portfolio_turnover: 26, equity_concentration: 15, options_present: 15,
    position_count: 5, filer_type: 10, client_type_fit: 5, private_fund_adviser: 5,
  },
  segmentTiers: {
    hedge_fund: 'high', quant_fund: 'high', prop_trading: 'high', asset_manager: 'medium',
    wealth_manager: 'low', broker_dealer: 'medium', bank: 'low', pension: 'low',
    insurance: 'low', family_office: 'medium', other: null, unknown: null,
  },
  tierRatios: { high: 1, medium: 0.5, low: 0.25 },
  relevanceConfig: {
    min_holdings: 10, min_served_value: null,
    relevant_min_fraction: 0.8, likely_min_fraction: 0.5, irrelevant_max_fraction: 0.2,
    no_signal_adv_default: 'likely_relevant',
    possible_hft_min_aum: 1000000000, possible_hft_requires_13f_filer: true,
  },
  servedBuckets: [
    { bucket_key: 'equity', served: true }, { bucket_key: 'option', served: true },
    { bucket_key: 'adr', served: true }, { bucket_key: 'etf_trust', served: true },
    { bucket_key: 'debt', served: false }, { bucket_key: 'other', served: true },
  ],
  nameSignals: [
    { pattern: 'wealth', target_segment: 'wealth_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'medium', sort_order: 1, is_active: true, promote_from: null },
    { pattern: '\\bquant(?:itative)?\\b|\\bsystematic\\b|\\balgorithmic\\b', target_segment: 'quant_fund', signal_kind: 'fund_type', vetoes_hedge_fund: false, confidence: 'medium', sort_order: 8, is_active: true, promote_from: ['hedge_fund'] },
    { pattern: '\\bhedge\\b', target_segment: 'hedge_fund', signal_kind: 'fund_name', vetoes_hedge_fund: false, confidence: 'medium', sort_order: 10, is_active: true, promote_from: null },
  ],
};

export const SERVED_SET = new Set(CONFIG.servedBuckets.filter(b => b.served).map(b => b.bucket_key));

const FIT_CFG = { weights: CONFIG.weights, segmentTiers: CONFIG.segmentTiers, tierRatios: CONFIG.tierRatios };
const REL = CONFIG.relevanceConfig;
const NS = CONFIG.nameSignals;

// A classified 13F firm that maxes every non-segment criterion; only the segment
// tier varies across the fit-score cases (so the anchor differences are isolated).
const strongFirm = (segment_canonical) => ({
  estimated_aum_usd: 6_000_000_000, portfolio_turnover_pct: 60, equities_pct: 90,
  options_present: true, position_count: 120, segment_canonical,
});

export const cases = [
  // ── inferSegment (13F by_source path) ──
  { fn: 'inferSegment', label: 'Point72 → asset_manager', args: ['Point72 Asset Management, L.P.'], expected: 'asset_manager' },
  { fn: 'inferSegment', label: 'wealth name → wealth_manager', args: ['Trevian Wealth Management'], expected: 'wealth_manager' },
  { fn: 'inferSegment', label: 'systematic → quant_fund', args: ['Systematic Alpha Management'], expected: 'quant_fund' },
  { fn: 'inferSegment', label: 'no signal → unknown', args: ['Zephyr Global Holdings'], expected: 'unknown' },

  // ── deriveAdvSegment (ADV by_source path) ──
  { fn: 'deriveAdvSegment', label: 'pooled-only → hedge_fund (earned)', args: ['Meridian Capital Partners', ['pooled_investment_vehicles'], false, NS], expected: { value: 'hedge_fund', confidence: 'high', basis: 'adv_client_type' } },
  { fn: 'deriveAdvSegment', label: 'institutional → asset_manager', args: ['Blackpoint Institutional Group', ['institutional'], false, NS], expected: { value: 'asset_manager', confidence: 'high', basis: 'adv_client_type' } },
  { fn: 'deriveAdvSegment', label: 'empty clientTypes + neutral → unknown', args: ['Zephyr Global Holdings', [], false, NS], expected: { value: 'unknown', confidence: 'low', basis: 'adv_name_signal' } },
  { fn: 'deriveAdvSegment', label: 'wealth name (empty CT) → wealth_manager', args: ['Cascade Wealth Advisors', [], false, NS], expected: { value: 'wealth_manager', confidence: 'medium', basis: 'adv_name_signal' } },
  { fn: 'deriveAdvSegment', label: 'pooled + quant name → promote to quant_fund', args: ['Quantum Systematic Fund', ['pooled_investment_vehicles'], false, NS], expected: { value: 'quant_fund', confidence: 'high', basis: 'adv_client_type' } },

  // ── computeFitScore (config-injected; abstain + tier cases) ──
  { fn: 'computeFitScore', label: 'asset_manager classified (medium tier → 0.5)', args: [strongFirm('asset_manager'), FIT_CFG], expected: { score: 85, breakdown: {
    aum_tier: { weight: 19, ratio: 1, points: 19 }, portfolio_turnover: { weight: 26, ratio: 1, points: 26 },
    equity_concentration: { weight: 15, ratio: 1, points: 15 }, options_present: { weight: 15, ratio: 1, points: 15 },
    position_count: { weight: 5, ratio: 1, points: 5 }, filer_type: { weight: 10, ratio: 0.5, points: 5 },
    client_type_fit: { weight: 5, ratio: 0, points: 0 }, private_fund_adviser: { weight: 5, ratio: 0, points: 0 },
  } } },
  { fn: 'computeFitScore', label: 'wealth_manager (low tier → 0.25 anchor)', args: [strongFirm('wealth_manager'), FIT_CFG], expected: { score: 83, breakdown: {
    aum_tier: { weight: 19, ratio: 1, points: 19 }, portfolio_turnover: { weight: 26, ratio: 1, points: 26 },
    equity_concentration: { weight: 15, ratio: 1, points: 15 }, options_present: { weight: 15, ratio: 1, points: 15 },
    position_count: { weight: 5, ratio: 1, points: 5 }, filer_type: { weight: 10, ratio: 0.25, points: 3 },
    client_type_fit: { weight: 5, ratio: 0, points: 0 }, private_fund_adviser: { weight: 5, ratio: 0, points: 0 },
  } } },
  { fn: 'computeFitScore', label: 'unknown segment → filer_type ABSTAINS (renormalize)', args: [strongFirm('unknown'), FIT_CFG], expected: { score: 89, breakdown: {
    aum_tier: { weight: 19, ratio: 1, points: 19 }, portfolio_turnover: { weight: 26, ratio: 1, points: 26 },
    equity_concentration: { weight: 15, ratio: 1, points: 15 }, options_present: { weight: 15, ratio: 1, points: 15 },
    position_count: { weight: 5, ratio: 1, points: 5 }, filer_type: { weight: 10, ratio: null, points: 0, abstained: true },
    client_type_fit: { weight: 5, ratio: 0, points: 0 }, private_fund_adviser: { weight: 5, ratio: 0, points: 0 },
  } } },

  // ── deriveRelevanceVerdict (relevant / likely / irrelevant / suspect / unknown) ──
  { fn: 'deriveRelevanceVerdict', label: 'relevant (Point72-like, equity-dominant)', args: [{ served_fraction: 0.95, total_value: 1_000_000_000, holdingCount: 120, byBucket: { equity: 950_000_000, debt: 50_000_000 }, servedSet: SERVED_SET, config: REL }], expected: { verdict: 'relevant', confidence: 'high', reason: 'high_served' } },
  { fn: 'deriveRelevanceVerdict', label: 'likely_relevant (moderate served)', args: [{ served_fraction: 0.6, total_value: 1_000_000_000, holdingCount: 40, byBucket: { equity: 600_000_000, debt: 400_000_000 }, servedSet: SERVED_SET, config: REL }], expected: { verdict: 'likely_relevant', confidence: 'medium', reason: 'moderate_served' } },
  { fn: 'deriveRelevanceVerdict', label: 'irrelevant (debt-dominant, non-served)', args: [{ served_fraction: 0.1, total_value: 1_000_000_000, holdingCount: 50, byBucket: { debt: 900_000_000, equity: 100_000_000 }, servedSet: SERVED_SET, config: REL }], expected: { verdict: 'irrelevant', confidence: 'high', reason: 'non_served_dominant' } },
  { fn: 'deriveRelevanceVerdict', label: 'suspect (low served, not dominant-gated)', args: [{ served_fraction: 0.3, total_value: 1_000_000_000, holdingCount: 40, byBucket: { equity: 300_000_000, debt: 700_000_000 }, servedSet: SERVED_SET, config: REL }], expected: { verdict: 'suspect', confidence: 'low', reason: 'low_served_not_dominant' } },
  { fn: 'deriveRelevanceVerdict', label: 'empty 13F → unknown, NOT gated', args: [{ served_fraction: null, total_value: 0, holdingCount: 0, byBucket: {}, servedSet: SERVED_SET, config: REL }], expected: { verdict: 'unknown', confidence: 'low', reason: 'insufficient_holdings' } },
];
