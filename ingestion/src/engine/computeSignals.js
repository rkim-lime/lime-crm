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
 * confidence='low' — a name is a weak signal. When no token reliably indicates
 * the firm type the fallback is 'unknown' (could-not-classify → enrichment
 * queue), NOT 'other'. 'other' is reserved for a positive classification of a
 * firm type outside the taxonomy (manual/enrichment), and is never produced
 * automatically — same status as quant_fund/prop_trading (reachable, just not
 * currently auto-derived).
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

  // No reliable signal — could-not-classify → enrichment queue (NOT 'other').
  return 'unknown';
}

/**
 * Match a firm name against the segment_name_signals config rows.
 *
 * Each row: { pattern, target_segment, signal_kind ('name_signal'|'fund_name'),
 *             vetoes_hedge_fund, confidence, sort_order, is_active }.
 * `pattern` is a case-insensitive regex fragment. Invalid patterns are skipped.
 * Returns the matching rows sorted strongest-first (confidence desc, then
 * sort_order asc) so callers can take the first match as the winner.
 */
export function matchNameSignals(firmName, nameSignals = []) {
  const name = firmName ?? '';
  const rank = { high: 3, medium: 2, low: 1 };
  const matches = [];
  for (const rule of nameSignals ?? []) {
    if (rule?.is_active === false || !rule?.pattern) continue;
    let re;
    try { re = new RegExp(rule.pattern, 'i'); } catch { continue; }
    if (re.test(name)) matches.push(rule);
  }
  matches.sort((a, b) =>
    (rank[b.confidence] ?? 0) - (rank[a.confidence] ?? 0)
    || (a.sort_order ?? 999) - (b.sort_order ?? 999)
  );
  return matches;
}

/**
 * Derive the institutional segment for an ADV firm.
 *
 * Core principle: hedge_fund is EARNED (dominant pooled/private-fund
 * composition, or a corroborating fund name), never DEFAULTED. Weak /
 * conflicting / flag-only-with-neutral-name firms resolve to 'unknown'
 * (an honest null → enrichment queue), NOT a hedge_fund guess.
 *
 * Priority order:
 *  (1) Non-empty clientTypes → composition with dominance:
 *      - pooled is the sole macro-category → hedge_fund (EARNED)
 *        · a vetoing name (vetoes_hedge_fund=true) redirects to its target
 *        · a fund-type name (quant/prop) refines to that subtype
 *      - institutional / pension clients present → asset_manager (dominant)
 *      - retail (HNW/individuals) present, pooled not dominant → wealth_manager
 *      - none of the above resolved → 'unknown'
 *  (2) Empty clientTypes:
 *      - a strong name signal → its target segment (confidence per rule)
 *      - a fund-corroborating name → hedge_fund (medium)
 *      - neutral/ambiguous name → 'unknown' (the private-fund flag alone is
 *        NOT enough to earn hedge_fund)
 *  (3) Name VETO is enforced inside the pooled-dominant branch and, for empty
 *      clientTypes, by the name signal itself winning over any fund_name.
 *
 * Name-signal patterns/targets/veto/confidence come from `nameSignals` (the
 * segment_name_signals config table), never inline. Returns
 * { value, confidence, basis } so callers get a fully-formed provenance tuple.
 * This is the single source of truth used by both the ADV connector and the
 * normalizer, so live ingest and backfill produce identical results.
 */
export function deriveAdvSegment(firmName, clientTypes, hasPrivateFundClients, nameSignals = []) {
  const ct = clientTypes ?? [];
  const matches      = matchNameSignals(firmName, nameSignals);
  const vetoRule     = matches.find(r => r.vetoes_hedge_fund);
  const fundTypeRule = matches.find(r => r.signal_kind === 'fund_type');

  const hasPooled        = ct.includes('pooled_investment_vehicles');
  const hasInstitutional = ct.includes('pension_plans') || ct.includes('institutional');
  const hasRetail        = ct.includes('high_net_worth') || ct.includes('individuals');

  // ── (1) Composition with dominance (client-type evidence present) ──────────
  if (ct.length > 0) {
    // Base verdict from composition (dominance), name veto redirecting only the
    // pooled-dominant hedge_fund call.
    let base;
    if (hasPooled && !hasInstitutional && !hasRetail) {
      base = vetoRule
        ? { value: vetoRule.target_segment, confidence: 'medium', basis: 'adv_name_veto' }
        : { value: 'hedge_fund', confidence: 'high', basis: 'adv_client_type' };
    } else if (hasInstitutional) {
      // Downgraded to medium when the private-fund flag or a pooled/retail mix
      // muddies the structure (Tremont/Bluescape/Clearbridge patterns).
      const conf = (hasPrivateFundClients || hasPooled || hasRetail) ? 'medium' : 'high';
      base = { value: 'asset_manager', confidence: conf, basis: 'adv_client_type' };
    } else if (hasRetail) {
      base = { value: 'wealth_manager', confidence: 'high', basis: 'adv_client_type' };
    } else {
      base = { value: 'unknown', confidence: 'medium', basis: 'adv_client_type' };
    }

    // Fund-type PROMOTION (config-driven; promote_from from the config row, no
    // conflict matrix). base ∈ promote_from → refine to the subtype. Otherwise
    // KEEP the base and raise a possible_<target> enrichment lead — never a
    // demotion to unknown.
    if (fundTypeRule) {
      const promoteFrom = fundTypeRule.promote_from ?? [];
      if (promoteFrom.includes(base.value)) {
        return { ...base, value: fundTypeRule.target_segment };
      }
      return { ...base, flags: { [`possible_${fundTypeRule.target_segment}`]: true } };
    }
    return base;
  }

  // ── (2) Empty clientTypes — name path: EVERY name rule is a DIRECT target ───
  // (name_signal / fund_name / fund_type alike), strongest-first. promote_from
  // does NOT apply here. The private-fund flag alone is NOT enough for hedge_fund.
  if (matches.length) {
    return { value: matches[0].target_segment, confidence: matches[0].confidence, basis: 'adv_name_signal' };
  }
  return {
    value:      'unknown',
    confidence: 'low',
    basis:      hasPrivateFundClients ? 'adv_flag_only' : 'adv_name_signal',
  };
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
