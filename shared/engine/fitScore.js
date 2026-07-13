/**
 * Prospect fit scoring — the PURE, config-injected scorer.
 *
 * Lives in shared/engine so both the ingestion pipeline and the Vite frontend
 * (Config UI preview) call the SAME function. The DB config loader
 * (loadFitScoreConfig, which reads scoring_config / taxonomy_values /
 * fit_tier_ratios via the service client) stays in ingestion/src/engine/fitScore.js
 * and injects its result here — this module imports nothing runtime-specific.
 */

/**
 * Compute prospect fit score. PURE + SYNCHRONOUS — the config bundle
 * { weights, segmentTiers, tierRatios } is INJECTED, never fetched inside, so
 * the Config UI preview can call this with a candidate config (the seam).
 *
 * Segment scoring is fully config-driven: the firm's segment_canonical maps to a
 * fit_tier (taxonomy_values) → a ratio (fit_tier_ratios). A NULL tier (e.g.
 * 'other'/'unknown', or an unmapped segment) ABSTAINS — filer_type is dropped
 * from BOTH the points sum and the weight denominator, and the remaining
 * criteria renormalize to 100 (a true abstain, not a 0.5 filler, not a downward
 * prior). Keys on segment_canonical (falls back to inferred_segment).
 *
 * Returns { score: number, breakdown: object }.
 */
export function computeFitScore(prospect, cfg = {}) {
  const w            = cfg.weights ?? {};
  const segmentTiers = cfg.segmentTiers ?? {};
  const tierRatios   = cfg.tierRatios ?? {};
  const bd           = {};

  // aum_tier
  const aum        = prospect.estimated_aum_usd ?? 0;
  const aumRatio   = aum >= 500_000_000 ? 1.0 : aum >= 100_000_000 ? 0.5 : 0.25;
  bd.aum_tier = { weight: w.aum_tier ?? 20, ratio: aumRatio, points: Math.round((w.aum_tier ?? 20) * aumRatio) };

  // portfolio_turnover
  const trn      = prospect.portfolio_turnover_pct;
  const trnRatio = trn == null ? 0.5 : trn >= 50 ? 1.0 : trn >= 25 ? 0.5 : 0.25;
  bd.portfolio_turnover = { weight: w.portfolio_turnover ?? 25, ratio: trnRatio, points: Math.round((w.portfolio_turnover ?? 25) * trnRatio) };

  // equity_concentration
  const eqPct    = prospect.equities_pct ?? 0;
  const eqRatio  = eqPct >= 70 ? 1.0 : eqPct >= 40 ? 0.5 : 0.25;
  bd.equity_concentration = { weight: w.equity_concentration ?? 15, ratio: eqRatio, points: Math.round((w.equity_concentration ?? 15) * eqRatio) };

  // options_present
  const optRatio = prospect.options_present ? 1.0 : 0;
  bd.options_present = { weight: w.options_present ?? 15, ratio: optRatio, points: Math.round((w.options_present ?? 15) * optRatio) };

  // position_count (weight reduced from 10→5 after migration 016)
  const cnt      = prospect.position_count ?? 0;
  const cntRatio = cnt >= 100 ? 1.0 : cnt >= 50 ? 0.5 : 0.25;
  bd.position_count = { weight: w.position_count ?? 5, ratio: cntRatio, points: Math.round((w.position_count ?? 5) * cntRatio) };

  // filer_type — config-driven segment tier → ratio. Keys on segment_canonical.
  // A NULL/absent tier ABSTAINS (renormalize; see below).
  const seg    = prospect.segment_canonical ?? prospect.inferred_segment ?? '';
  const filerW = w.filer_type ?? 10;
  const tier   = segmentTiers[seg];
  if (tier == null) {
    bd.filer_type = { weight: filerW, ratio: null, points: 0, abstained: true };
  } else {
    const ratio = tierRatios[tier] ?? 0;
    bd.filer_type = { weight: filerW, ratio, points: Math.round(filerW * ratio) };
  }

  // client_type_fit — ADV: pooled/institutional full, HNW partial, retail/absent zero
  // 13F prospects have no clientTypes → gracefully scores 0
  const clientTypes   = prospect.clientTypes ?? [];
  const FULL_TYPES    = ['pooled_investment_vehicles', 'institutional'];
  const PARTIAL_TYPES = ['high_net_worth', 'pension_plans'];
  const ctRatio = clientTypes.some(t => FULL_TYPES.includes(t))    ? 1.0
                : clientTypes.some(t => PARTIAL_TYPES.includes(t)) ? 0.5
                : 0;
  bd.client_type_fit = { weight: w.client_type_fit ?? 5, ratio: ctRatio, points: Math.round((w.client_type_fit ?? 5) * ctRatio) };

  // private_fund_adviser — ADV: full if advises private funds; 13F scores 0 (no advFlags)
  const pfRatio = prospect.advFlags?.hasPrivateFundClients ? 1.0 : 0;
  bd.private_fund_adviser = { weight: w.private_fund_adviser ?? 5, ratio: pfRatio, points: Math.round((w.private_fund_adviser ?? 5) * pfRatio) };

  // Renormalize over the criteria that actually scored: an abstained criterion
  // (segment for null-tier) is excluded from BOTH the points sum and the weight
  // denominator, so the score is the firm's percentage on the remaining
  // criteria. When nothing abstains, totalWeight = 100 and this reduces to the
  // plain points sum (behavior unchanged for classified firms).
  const scored      = Object.values(bd).filter(b => !b.abstained);
  const totalWeight = scored.reduce((s, b) => s + b.weight, 0);
  const rawPoints   = scored.reduce((s, b) => s + b.points, 0);
  const score       = totalWeight > 0 ? Math.min(100, Math.round((rawPoints / totalWeight) * 100)) : 0;
  return { score, breakdown: bd };
}
