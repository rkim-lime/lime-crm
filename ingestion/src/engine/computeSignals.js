/**
 * Sum all holding values to estimate AUM from the 13F disclosure.
 */
export function estimateAUM(holdings) {
  return (holdings ?? []).reduce((s, h) => s + (h.valueUsd || 0), 0);
}

/**
 * Portfolio turnover between two consecutive quarters.
 * Turnover = Σ|value_change_per_cusip| / average(current_total, prior_total) × 100
 * Returns null if either quarter has no holdings.
 */
export function computeTurnover(currentHoldings, priorHoldings) {
  if (!currentHoldings?.length || !priorHoldings?.length) return null;

  const cur = new Map(currentHoldings.map(h => [h.cusip, h.valueUsd || 0]));
  const pri = new Map(priorHoldings.map(h  => [h.cusip, h.valueUsd || 0]));
  const all = new Set([...cur.keys(), ...pri.keys()]);

  let totalChange = 0;
  for (const cusip of all) {
    totalChange += Math.abs((cur.get(cusip) ?? 0) - (pri.get(cusip) ?? 0));
  }

  const avgPortfolio = (estimateAUM(currentHoldings) + estimateAUM(priorHoldings)) / 2;
  if (avgPortfolio === 0) return null;

  return Math.min(100, (totalChange / avgPortfolio) * 100);
}

/**
 * Asset class breakdown from holdings.
 * Returns { equitiesPct, optionsPresent }
 */
export function assetMix(holdings) {
  if (!holdings?.length) return { equitiesPct: 0, optionsPresent: false };

  const total = estimateAUM(holdings);
  if (total === 0) return { equitiesPct: 0, optionsPresent: false };

  let equitiesValue  = 0;
  let optionsPresent = false;

  for (const h of holdings) {
    const isOption = h.putCall === 'Put' || h.putCall === 'Call'
      || /\b(put|call)\b/i.test(h.titleOfClass);

    if (isOption) {
      optionsPresent = true;
    } else {
      equitiesValue += h.valueUsd || 0;
    }
  }

  return {
    equitiesPct:   Math.round((equitiesValue / total) * 10000) / 100,
    optionsPresent,
  };
}

/**
 * Infer institutional segment from firm name tokens (case-insensitive).
 *
 * Rules are ordered most-specific → least-specific. All inferences are
 * confidence='low' — a name is a weak signal. 'other' is returned when no
 * token reliably indicates the firm type, rather than guessing 'hedge_fund'.
 *
 * ADV segment inference is overridden downstream by client-type data
 * (confidence='high') — this function is the shared starting point.
 */
export function inferSegment(firmName) {
  const n = (firmName ?? '').toLowerCase();

  // Quantitative / systematic / algorithmic (distinctive vocabulary)
  if (/quant(?:itative)?|systematic|algorithmic/.test(n))  return 'quant_fund';

  // Proprietary trading ('prop' or 'proprietary', or 'trading co')
  if (/prop(?:rietary)?|trading\s+co/.test(n))             return 'prop_trader';

  // Wealth management (before generic 'management' / 'advisory' terms)
  if (/wealth/.test(n))                                     return 'wealth_manager';

  // Banking / trust companies
  if (/\bbank\b|\btrust\b|national\s+ass(?:oc)?/.test(n)) return 'bank';

  // Broker / dealer / securities firms
  if (/broker|dealer|securities|brokerage/.test(n))        return 'broker_dealer';

  // Pension / retirement / endowment
  if (/pension|retirement|endowment|foundation/.test(n))   return 'pension';

  // Insurance carriers and reinsurers
  if (/insurance|assurance/.test(n))                       return 'insurance';

  // Family offices ('family office' phrase preferred; 'family' alone is a signal in this context)
  if (/family\s+office|\bfamily\b/.test(n))               return 'family_office';

  // Explicit hedge-fund identifier
  if (/\bhedge\b/.test(n))                                 return 'hedge_fund';

  // Registered investment advisers (before generic management terms)
  if (/advis(?:or|ory|er|ors|ers)/.test(n))              return 'asset_manager';

  // Named asset/investment/capital management firms
  if (/(?:capital|asset|investment)\s+management/.test(n)) return 'asset_manager';

  // 'Partners' or 'capital' alone — common in fund names, ambiguous but
  // less misleading than defaulting to hedge_fund
  if (/\bpartners?\b|\bcapital\b/.test(n))                return 'asset_manager';

  // No reliable signal — honest fallback
  return 'other';
}

/**
 * Check whether a prospect passes the ICP thresholds loaded from
 * icp_filter_config. Null numeric signals are treated as 0.
 * Returns true if icpConfig is null/undefined (no config = open ICP).
 */
export function computePassesICP(prospect, icpConfig) {
  if (!icpConfig) return true;

  const aum            = prospect.estimated_aum_usd      ?? 0;
  const turnover       = prospect.portfolio_turnover_pct  ?? 0;
  const positions      = prospect.position_count          ?? 0;
  const segment        = prospect.inferred_segment        ?? '';
  const hasPrivateFund = prospect.advFlags?.hasPrivateFundClients ?? false;

  const excludedSegments = icpConfig.excluded_segments  ?? [];
  const minAum           = icpConfig.min_aum_usd        ?? 0;
  const minTurnover      = icpConfig.min_turnover_pct   ?? 0;
  const minPositions     = icpConfig.min_position_count ?? 0;

  // Private-fund-only advisers don't report SMA AUM (regulatoryAum is null,
  // normalized to 0). Bypass AUM threshold so large private-fund managers
  // aren't incorrectly filtered.
  if (!hasPrivateFund && aum < minAum)       return false;
  if (turnover  < minTurnover)               return false;
  if (positions < minPositions)              return false;
  if (excludedSegments.includes(segment))    return false;

  return true;
}
