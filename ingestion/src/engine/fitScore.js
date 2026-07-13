import { supabase } from '../supabaseClient.js';
import { logger }   from '../utils/logger.js';
import { computeFitScore } from '../../../shared/engine/fitScore.js';

// Module-level caches — config is stable within a single run.
let _weights = null;
let _tierCfg = null;

async function loadWeights() {
  if (_weights) return _weights;

  const { data, error } = await supabase
    .from('scoring_config')
    .select('criterion_key, weight')
    .eq('score_type', 'prospect_fit')
    .eq('is_active', true);

  if (error || !data?.length) {
    logger.warn('Could not load prospect_fit weights from DB — using hardcoded defaults:', error?.message ?? 'no rows');
    // Weights after migration 016 rebalance (total = 100)
    return {
      aum_tier:              20,
      portfolio_turnover:    25,
      equity_concentration:  15,
      options_present:       15,
      position_count:         5,
      filer_type:            10,
      client_type_fit:        5,
      private_fund_adviser:   5,
    };
  }

  _weights = Object.fromEntries(data.map(r => [r.criterion_key, r.weight]));
  logger.debug('Loaded prospect_fit weights from DB:', _weights);
  return _weights;
}

// segment fit_tier map (taxonomy_values, 'segment' taxonomy) + tier→ratio map
// (fit_tier_ratios). A NULL fit_tier means ABSTAIN (no ratio; handled in code).
async function loadTierConfig() {
  if (_tierCfg) return _tierCfg;

  const { data: tax } = await supabase
    .from('taxonomies').select('id').eq('taxonomy_key', 'segment').maybeSingle();

  let segmentTiers = {};
  if (tax) {
    const { data: vals } = await supabase
      .from('taxonomy_values').select('value_key, fit_tier').eq('taxonomy_id', tax.id);
    segmentTiers = Object.fromEntries((vals ?? []).map(v => [v.value_key, v.fit_tier ?? null]));
  }

  const { data: ratios } = await supabase.from('fit_tier_ratios').select('tier, ratio');
  const tierRatios = Object.fromEntries((ratios ?? []).map(r => [r.tier, Number(r.ratio)]));

  _tierCfg = { segmentTiers, tierRatios };
  return _tierCfg;
}

/**
 * Load the full fit-score config bundle (weights + segment tiers + tier ratios).
 * Callers inject this into computeFitScore — the pure scorer never fetches.
 */
export async function loadFitScoreConfig() {
  const [weights, tierCfg] = await Promise.all([loadWeights(), loadTierConfig()]);
  return { weights, ...tierCfg };
}

// computeFitScore (the pure scorer) now lives in shared/engine so the Config UI
// preview imports the SAME function. Re-exported so ingestion consumers
// (writers, sanityChecks) are unchanged.
export { computeFitScore };
