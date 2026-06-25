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
 * Infer institutional segment from firm name heuristics.
 */
export function inferSegment(firmName) {
  const n = (firmName ?? '').toLowerCase();

  if (/quant(?:itative)?|systematic|algorithmic/.test(n)) return 'quant_fund';
  if (/pension|retirement|endowment|foundation/.test(n))  return 'pension';
  if (/prop(?:rietary)?|trading\s+co/.test(n))            return 'prop_trader';
  if (/broker|dealer|securities(?:\s+corp)?/.test(n))     return 'broker_dealer';

  return 'hedge_fund'; // default for institutional 13F filers
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
