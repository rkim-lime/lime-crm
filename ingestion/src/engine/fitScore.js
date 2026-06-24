import { supabase } from '../supabaseClient.js';
import { logger }   from '../utils/logger.js';

// Module-level cache — weights are stable within a single run
let _weights = null;

async function loadWeights() {
  if (_weights) return _weights;

  const { data, error } = await supabase
    .from('scoring_config')
    .select('criterion_key, weight')
    .eq('score_type', 'prospect_fit')
    .eq('is_active', true);

  if (error || !data?.length) {
    logger.warn('Could not load prospect_fit weights from DB — using hardcoded defaults:', error?.message ?? 'no rows');
    return {
      aum_tier:             20,
      portfolio_turnover:   25,
      equity_concentration: 15,
      options_present:      15,
      position_count:       10,
      filer_type:           15,
    };
  }

  _weights = Object.fromEntries(data.map(r => [r.criterion_key, r.weight]));
  logger.debug('Loaded prospect_fit weights from DB:', _weights);
  return _weights;
}

/**
 * Compute prospect fit score from signals on a prospect object.
 * Returns { score: number, breakdown: object }
 */
export async function computeFitScore(prospect) {
  const w   = await loadWeights();
  const bd  = {};

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

  // position_count
  const cnt      = prospect.position_count ?? 0;
  const cntRatio = cnt >= 100 ? 1.0 : cnt >= 50 ? 0.5 : 0.25;
  bd.position_count = { weight: w.position_count ?? 10, ratio: cntRatio, points: Math.round((w.position_count ?? 10) * cntRatio) };

  // filer_type
  const seg      = prospect.inferred_segment ?? '';
  const segRatio = ['hedge_fund', 'quant_fund', 'prop_trader'].includes(seg) ? 1.0
                 : seg === 'pension'       ? 0.25
                 : 0.5;
  bd.filer_type = { weight: w.filer_type ?? 15, ratio: segRatio, points: Math.round((w.filer_type ?? 15) * segRatio) };

  const score = Math.min(100, Object.values(bd).reduce((s, b) => s + b.points, 0));
  return { score, breakdown: bd };
}
