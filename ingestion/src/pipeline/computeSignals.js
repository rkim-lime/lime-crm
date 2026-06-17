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
