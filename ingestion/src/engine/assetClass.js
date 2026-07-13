/**
 * Asset-class relevance — ingestion seam.
 *
 * The PURE helpers (classifier, breakdown, verdict, name-flags, HFT/activity
 * metrics) now live in shared/engine/assetClass.js — a single source imported by
 * both this pipeline and the Vite frontend (Config UI preview). This module
 * re-exports them unchanged and retains the DB orchestrator
 * (computeAssetClassForProspect), which reads holdings/filings via ctx.supabase
 * and therefore cannot move into a browser-safe module.
 */

import {
  computeActivityMetrics,
  computeBreakdown,
  deriveRelevanceVerdict,
  deriveAdvRelevance,
  computePossibleHft,
} from '../../../shared/engine/assetClass.js';

// Re-export every pure helper from its shared home so existing consumers
// (normalize, sanityChecks, tests) keep importing from ./assetClass.js unchanged.
export * from '../../../shared/engine/assetClass.js';

// ── DB orchestrator ─────────────────────────────────────────────────────────

/**
 * Compute + persist asset-class relevance for one prospect.
 *   • per filing: breakdown + served_fraction + detected classes + activity
 *     metrics → prospect_filings (time-series; never overwrites other filings)
 *   • firm verdict from the LATEST 13F filing, else the ADV name-flag path
 *   • possible_hft flag from AUM/holdings mismatch
 * Returns the firm-level patch (asset_class_* fields) for prospects/accounts.
 * The auto verdict is written to asset_class_relevance; the human override
 * column is never touched here (Part C resolves effective = override ?? auto).
 */
export async function computeAssetClassForProspect(ctx, prospectId, firmSignal, refs) {
  const { supabase } = ctx;
  const { assetPatterns, servedBuckets, advNameFlags, relevanceConfig } = refs;
  const config = relevanceConfig ?? {};

  // Load filings + holdings for this prospect
  const { data: filings } = await supabase
    .from('prospect_filings')
    .select('id, period_of_report')
    .eq('prospect_id', prospectId)
    .order('period_of_report', { ascending: false });

  const filingList = filings ?? [];
  let holdingsByFiling = {};
  if (filingList.length) {
    // Paginate — a plain .in() caps at PostgREST's 1000-row limit, which for a
    // large filer (e.g. a filing with 3800 holdings) silently truncates the book
    // and corrupts the value-weighted breakdown, served_fraction, and churn.
    const filingIds = filingList.map(f => f.id);
    let offset = 0;
    while (true) {
      const { data: holdings } = await supabase
        .from('prospect_holdings')
        .select('id, filing_id, cusip, issuer_name, value_usd, class_title, put_call')
        .in('filing_id', filingIds)
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      for (const h of holdings ?? []) (holdingsByFiling[h.filing_id] ??= []).push(h);
      if (!holdings || holdings.length < 1000) break;
      offset += 1000;
    }
  }

  // Activity metrics across the filing history
  const activity = computeActivityMetrics(
    filingList.map(f => ({ filing_id: f.id, period_of_report: f.period_of_report, holdings: holdingsByFiling[f.id] ?? [] })),
  );

  // Per-filing breakdowns → persist (time-series)
  const nowIso = new Date().toISOString();
  let latest = null;
  for (const f of filingList) {
    const holds = holdingsByFiling[f.id] ?? [];
    const bd = computeBreakdown(holds, assetPatterns, servedBuckets);
    const filingPatch = {
      served_fraction:        bd.served_fraction,
      asset_breakdown:        bd.breakdown,
      detected_asset_classes: bd.detected_asset_classes,
      activity_metrics:       activity[f.id] ?? null,
      relevance_computed_at:  nowIso,
    };
    await supabase.from('prospect_filings').update(filingPatch).eq('id', f.id);
    if (!latest) latest = { filing: f, holds, bd }; // first = most recent (ordered desc)
  }

  // Firm verdict
  const aum = firmSignal?.estimated_aum_usd ?? null;
  const latestHoldingCount = latest ? latest.holds.length : 0;
  let result, breakdown = null, servedFraction = null;

  if (latest && latestHoldingCount > 0) {
    breakdown = latest.bd.breakdown;
    servedFraction = latest.bd.served_fraction;
    const v = deriveRelevanceVerdict({
      served_fraction: latest.bd.served_fraction,
      total_value:     latest.bd.total_value,
      holdingCount:    latestHoldingCount,
      byBucket:        latest.bd.byBucket,
      servedSet:       latest.bd.servedSet,
      config,
    });
    // A sufficient 13F book gives a band verdict; an insufficient/empty 13F book
    // stays 'unknown' (13F filers are NOT rerouted to the ADV default).
    result = { verdict: v.verdict, confidence: v.confidence, flags: {} };
  } else {
    // No 13F filings at all → ADV path (name-flag → suspect, else default).
    result = deriveAdvRelevance(firmSignal?.firmName, advNameFlags, config);
  }

  // possible_hft positive lead (config-driven mismatch). has13fFiling gates out
  // ADV-only advisers with no 13F when possible_hft_requires_13f_filer is true.
  const flags = { ...(result.flags ?? {}) };
  if (computePossibleHft({ aum, holdingCount: latestHoldingCount, has13fFiling: filingList.length > 0, config })) {
    flags.possible_hft = true;
  }
  if (result.verdict === 'suspect') flags.review = true;

  return {
    asset_class_relevance:       result.verdict,
    asset_class_confidence:      result.confidence,
    asset_class_served_fraction: servedFraction,
    asset_class_breakdown:       breakdown,
    asset_class_flags:           Object.keys(flags).length ? flags : null,
    asset_class_computed_at:     nowIso,
  };
}
