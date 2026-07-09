/**
 * Normalization layer — Layer 2 (per-signal provenance tuples) and
 * Layer 3 (canonical indexed fields) derived from raw connector signals.
 *
 * Exported pure helpers are tested directly; DB-touching functions accept
 * a pre-loaded refs object (load once per connector run, reuse per firm).
 */

import { inferSegment, deriveAdvSegment } from './computeSignals.js';
import { computeAssetClassForProspect } from './assetClass.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

// Maps firmSignal.source → the source key used in taxonomy_mappings
const SOURCE_TO_CONNECTOR = {
  'sec_13f': 'ingest_13f',
  'sec_adv': 'ingest_adv',
};

// Scoring-relevant canonical dimensions (used for signal_completeness)
const SCORING_DIMENSIONS = new Set([
  'aum', 'execution_sensitivity', 'segment', 'client_type', 'cross_market',
]);


// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Extract normalized signal entries from a FirmSignal produced by a connector.
 * Returns an object keyed by signal_key, each value being a provenance tuple:
 *   { value, basis, source, as_of, confidence }
 */
export function extractSignals(firmSignal, nameSignals = []) {
  const signals = {};
  const src = firmSignal.source;

  if (src === 'sec_13f') {
    const asOf = firmSignal.quarters?.[0]?.filing?.periodOfReport ?? null;

    signals.aum_13f_portfolio = {
      value:      firmSignal.estimated_aum_usd,
      basis:      '13f_portfolio',
      source:     'sec_13f',
      as_of:      asOf,
      confidence: 'high',
    };

    if (firmSignal.portfolio_turnover_pct != null) {
      signals.turnover_pct = {
        value:      firmSignal.portfolio_turnover_pct,
        basis:      '13f_signals',
        source:     'sec_13f',
        as_of:      asOf,
        confidence: 'medium', // approximation from quarter-over-quarter diff
      };
    }

    if (firmSignal.equities_pct != null) {
      signals.equities_pct = {
        value:      firmSignal.equities_pct,
        basis:      '13f_signals',
        source:     'sec_13f',
        as_of:      asOf,
        confidence: 'high',
      };
    }

    signals.options_present = {
      value:      firmSignal.options_present ?? false,
      basis:      '13f_signals',
      source:     'sec_13f',
      as_of:      asOf,
      confidence: 'high',
    };

    if (firmSignal.position_count != null) {
      signals.position_count = {
        value:      firmSignal.position_count,
        basis:      '13f_signals',
        source:     'sec_13f',
        as_of:      asOf,
        confidence: 'high',
      };
    }

    // Always recompute from the firm name using the current heuristic.
    // Do NOT read firmSignal.inferred_segment — it may be a stale connector-cached
    // value from a previous ingest run before the heuristic was updated.
    signals.segment_inferred = {
      value:      inferSegment(firmSignal.firmName),
      basis:      '13f_name_heuristic',
      source:     'sec_13f',
      as_of:      asOf,
      confidence: 'low',
    };

  } else if (src === 'sec_adv') {
    // Use regulatoryAum (null = not reported by private-fund-only advisers),
    // NOT estimated_aum_usd (which is coerced to 0 for engine safety).
    if (firmSignal.regulatoryAum != null) {
      signals.aum_adv_regulatory = {
        value:      firmSignal.regulatoryAum,
        basis:      'adv_regulatory',
        source:     'sec_adv',
        as_of:      null, // ADV bulk file carries no per-filing date
        confidence: 'high',
      };
    }

    {
      // Always recompute from primary evidence — never read firmSignal.inferred_segment.
      // The backfill sets inferred_segment = inferSegment(firmName) (name heuristic only),
      // which ignores clientTypes and advFlags entirely. Reading it here would produce
      // wrong segments for backfill runs. Same principle as 13F: recompute from the actual
      // data, ignore the cached field. deriveAdvSegment reads the name-signal config
      // (segment_name_signals) so backfill and live ingest produce identical results.
      const clientTypes  = firmSignal.clientTypes ?? [];
      const hasPrivFund  = firmSignal.advFlags?.hasPrivateFundClients ?? false;
      const seg = deriveAdvSegment(firmSignal.firmName, clientTypes, hasPrivFund, nameSignals);

      signals.segment_inferred = {
        value:      seg.value,
        basis:      seg.basis,
        source:     'sec_adv',
        as_of:      null,
        confidence: seg.confidence,
        flags:      seg.flags ?? null, // possible_<subtype> enrichment leads (fund_type on a non-promote base)
      };
    }

    if ((firmSignal.clientTypes?.length ?? 0) > 0) {
      signals.client_types = {
        value:      firmSignal.clientTypes,
        basis:      'adv_item5d',
        source:     'sec_adv',
        as_of:      null,
        confidence: 'high',
      };
    }

    // Always include has_private_fund_clients when source is ADV
    signals.has_private_fund_clients = {
      value:      firmSignal.advFlags?.hasPrivateFundClients ?? false,
      basis:      'adv_item7a',
      source:     'sec_adv',
      as_of:      null,
      confidence: 'high',
    };
  }

  return signals;
}

/**
 * Merge two signal entries for the same signal_key.
 *
 * Same-source rule: when both signals come from the same connector, skip the
 * confidence comparison and apply only the as_of recency rule. Re-running a
 * connector is a re-computation, not a cross-source competition — a stale
 * confidence level written by old logic must not block corrections from the
 * same source on the next ingest (the Bluescape/Tremont pattern: old logic
 * stored hedge_fund/high; new logic correctly emits asset_manager/medium, but
 * high > medium would have kept the wrong value without this rule).
 *
 * Cross-source rule: higher confidence wins; recency (as_of) breaks ties.
 */
export function mergeSignal(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  // Same-source re-ingest: skip confidence comparison, use only recency.
  if (existing.source && incoming.source && existing.source === incoming.source) {
    if (existing.as_of && incoming.as_of) {
      return incoming.as_of >= existing.as_of ? incoming : existing;
    }
    if (incoming.as_of) return incoming;
    if (existing.as_of) return existing;
    return incoming; // both null → fresh computation wins
  }

  const er = CONFIDENCE_RANK[existing.confidence] ?? 0;
  const ir = CONFIDENCE_RANK[incoming.confidence] ?? 0;

  if (ir > er) return incoming;
  if (ir < er) return existing;

  // Same confidence — prefer the signal with a more recent as_of.
  // When both have dates, pick the newer one. When only one has a date, that one wins.
  // When both are null (e.g. backfill re-processing), prefer incoming so fresh
  // computation overwrites the cached value rather than silently keeping it.
  if (existing.as_of && incoming.as_of) {
    return incoming.as_of >= existing.as_of ? incoming : existing;
  }
  if (incoming.as_of) return incoming;
  if (existing.as_of) return existing;
  return incoming; // both null → fresh computation wins
}

/**
 * Derive the canonical AUM value with provenance.
 * Precedence: ADV regulatory > 13F portfolio.
 * Returns { value, basis, source, as_of } — all nullable.
 */
export function deriveAumCanonical(normalizedSignals) {
  const adv = normalizedSignals.aum_adv_regulatory;
  const f13 = normalizedSignals.aum_13f_portfolio;

  if (adv?.value != null) {
    return { value: adv.value, basis: 'adv_regulatory', source: adv.source, as_of: adv.as_of };
  }
  if (f13?.value != null) {
    return { value: f13.value, basis: '13f_portfolio', source: f13.source, as_of: f13.as_of };
  }
  return { value: null, basis: null, source: null, as_of: null };
}

/**
 * Map the best available segment_inferred signal to a canonical taxonomy value_key.
 * segmentMappings: rows from taxonomy_mappings for the 'segment' taxonomy.
 * Returns { value, confidence } — both nullable.
 *
 * Taxonomy mappings translate raw connector values → canonical vocabulary keys.
 * They must NOT override confidence: confidence reflects the conflict-aware
 * quality of the Layer-2 tuple (e.g. medium for institutional+privateFund),
 * which the mapping row's hardcoded value knows nothing about.
 */
export function deriveSegmentCanonical(normalizedSignals, segmentMappings) {
  const seg = normalizedSignals.segment_inferred;
  if (!seg?.value) return { value: null, confidence: null };

  const connectorSrc = SOURCE_TO_CONNECTOR[seg.source] ?? seg.source;
  const mapping = (segmentMappings ?? []).find(
    m => m.source === connectorSrc && m.source_value === seg.value,
  );

  if (mapping) {
    // mapping.canonical_value_key translates the value; tuple confidence is authoritative.
    return { value: mapping.canonical_value_key, confidence: seg.confidence };
  }

  // No mapping found — use the raw value as-is (may already be canonical, e.g. 'hedge_fund')
  return { value: seg.value, confidence: seg.confidence };
}

/**
 * Bucket an AUM value against size_tier_config bands.
 * sizeBands: [{ tier_key, min_aum, max_aum }] ordered by sort_order.
 * Returns tier_key string, or null if aumValue is null or no band matches.
 */
export function deriveSizeTier(aumValue, sizeBands) {
  if (aumValue == null || !(sizeBands?.length)) return null;

  for (const band of sizeBands) {
    const aboveMin = band.min_aum == null || aumValue >= Number(band.min_aum);
    const belowMax = band.max_aum == null || aumValue < Number(band.max_aum);
    if (aboveMin && belowMax) return band.tier_key;
  }
  return null;
}

/**
 * Compute signal completeness as a 0..1 fraction of scoring-relevant
 * signal_definitions that have a populated (non-null value) entry.
 */
export function computeCompleteness(normalizedSignals, signalDefs) {
  const scoringDefs = (signalDefs ?? []).filter(
    d => SCORING_DIMENSIONS.has(d.canonical_dimension),
  );
  if (!scoringDefs.length) return 0;

  let populated = 0;
  for (const def of scoringDefs) {
    const sig = normalizedSignals[def.signal_key];
    if (sig != null && sig.value != null) populated++;
  }

  return Math.round((populated / scoringDefs.length) * 100) / 100;
}


// ── DB loaders ────────────────────────────────────────────────────────────────

async function loadSignalDefs(supabase) {
  const { data } = await supabase
    .from('signal_definitions')
    .select('signal_key, canonical_dimension');
  return data ?? [];
}

async function loadSegmentMappings(supabase) {
  const { data: tax } = await supabase
    .from('taxonomies')
    .select('id')
    .eq('taxonomy_key', 'segment')
    .maybeSingle();

  if (!tax) return [];

  const { data } = await supabase
    .from('taxonomy_mappings')
    .select('source, source_value, canonical_value_key, confidence')
    .eq('taxonomy_id', tax.id);

  return data ?? [];
}

async function loadSizeBands(supabase) {
  const { data } = await supabase
    .from('size_tier_config')
    .select('tier_key, min_aum, max_aum')
    .order('sort_order');
  return data ?? [];
}

async function loadNameSignals(supabase) {
  const { data } = await supabase
    .from('segment_name_signals')
    .select('pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order');
  return data ?? [];
}

// ── Asset-class relevance config (migration 026) ──────────────────────────────
async function loadAssetPatterns(supabase) {
  const { data } = await supabase
    .from('asset_class_patterns')
    .select('pattern, bucket, pattern_kind, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order');
  return data ?? [];
}
async function loadServedBuckets(supabase) {
  const { data } = await supabase
    .from('served_asset_classes')
    .select('bucket_key, served, sort_order');
  return data ?? [];
}
async function loadAdvNameFlags(supabase) {
  const { data } = await supabase
    .from('relevance_adv_name_flags')
    .select('pattern, implied_class, verdict, confidence, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order');
  return data ?? [];
}
async function loadRelevanceConfig(supabase) {
  const { data } = await supabase
    .from('asset_class_relevance_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  return data ?? {};
}
async function loadVerdictActions(supabase) {
  const { data } = await supabase
    .from('relevance_verdict_actions')
    .select('verdict, action');
  return data ?? [];
}

/**
 * Load all reference tables needed for normalization.
 * Call once per connector run; pass the result as `refs` to normalizeFirm.
 */
export async function loadNormalizationRefs(supabase) {
  const [
    signalDefs, segmentMappings, sizeBands, nameSignals,
    assetPatterns, servedBuckets, advNameFlags, relevanceConfig, verdictActions,
  ] = await Promise.all([
    loadSignalDefs(supabase),
    loadSegmentMappings(supabase),
    loadSizeBands(supabase),
    loadNameSignals(supabase),
    loadAssetPatterns(supabase),
    loadServedBuckets(supabase),
    loadAdvNameFlags(supabase),
    loadRelevanceConfig(supabase),
    loadVerdictActions(supabase),
  ]);
  return {
    signalDefs, segmentMappings, sizeBands, nameSignals,
    assetPatterns, servedBuckets, advNameFlags, relevanceConfig, verdictActions,
  };
}

async function loadExistingNormalized(supabase, { prospectId, accountId }) {
  if (accountId) {
    const { data } = await supabase
      .from('accounts')
      .select('normalized_signals')
      .eq('id', accountId)
      .maybeSingle();
    return data?.normalized_signals ?? null;
  }
  if (prospectId) {
    const { data } = await supabase
      .from('prospects')
      .select('normalized_signals')
      .eq('id', prospectId)
      .maybeSingle();
    return data?.normalized_signals ?? null;
  }
  return null;
}

async function upsertIdentifiers(supabase, prospectId, accountId, firmSignal) {
  const pairs = [
    firmSignal.cik        ? { type: 'cik', value: firmSignal.cik }        : null,
    firmSignal.crdNumber  ? { type: 'crd', value: firmSignal.crdNumber }  : null,
  ].filter(Boolean);

  for (const { type, value } of pairs) {
    const { data: existing } = await supabase
      .from('prospect_identifiers')
      .select('id, prospect_id, account_id')
      .eq('identifier_type', type)
      .eq('identifier_value', value)
      .maybeSingle();

    if (existing) {
      // Merge: only set fields that weren't already populated
      const patch = {};
      if (prospectId && !existing.prospect_id) patch.prospect_id = prospectId;
      if (accountId  && !existing.account_id)  patch.account_id  = accountId;
      if (Object.keys(patch).length) {
        await supabase
          .from('prospect_identifiers')
          .update(patch)
          .eq('id', existing.id);
      }
    } else {
      await supabase
        .from('prospect_identifiers')
        .insert({
          identifier_type:  type,
          identifier_value: value,
          prospect_id:      prospectId ?? null,
          account_id:       accountId  ?? null,
          source:           firmSignal.source,
        });
    }
  }
}


// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Normalize a firm after its FirmSignal has been resolved and written.
 *
 * @param ctx        { supabase, logger }
 * @param entityRef  { prospectId?, accountId? } — at least one must be set
 * @param firmSignal FirmSignal from the connector (current source)
 * @param refs       Pre-loaded reference tables from loadNormalizationRefs().
 *                   Pass null to load on demand (only for one-off calls).
 */
export async function normalizeFirm(ctx, entityRef, firmSignal, refs = null) {
  const { supabase, logger } = ctx;
  const { prospectId = null, accountId = null } = entityRef;

  const refsObj = refs ?? await loadNormalizationRefs(supabase);
  const { signalDefs, segmentMappings, sizeBands, nameSignals } = refsObj;

  // ── 1. Extract signals from this connector run ─────────────────────────────
  const currentSignals = extractSignals(firmSignal, nameSignals);

  // ── 2. Load existing accumulated normalized_signals and merge ─────────────
  const existingNorm = await loadExistingNormalized(supabase, { prospectId, accountId });
  const merged = { ...(existingNorm ?? {}) };
  for (const [key, entry] of Object.entries(currentSignals)) {
    merged[key] = mergeSignal(merged[key], entry);
  }

  // ── 3. Derive canonical fields ─────────────────────────────────────────────
  const aumResult  = deriveAumCanonical(merged);
  const segResult  = deriveSegmentCanonical(merged, segmentMappings);
  const sizeTier   = deriveSizeTier(aumResult.value, sizeBands);
  const completeness = computeCompleteness(merged, signalDefs);

  // jurisdiction: SEC filers are always US; unknown connectors leave it null
  const jurisdiction = (firmSignal.source === 'sec_13f' || firmSignal.source === 'sec_adv')
    ? 'us' : null;

  // ── 4. Build update patch ──────────────────────────────────────────────────
  const patch = {
    aum_canonical:       aumResult.value    ?? null,
    aum_basis:           aumResult.basis    ?? null,
    aum_source:          aumResult.source   ?? null,
    aum_as_of:           aumResult.as_of    ?? null,
    segment_canonical:   segResult.value    ?? null,
    segment_confidence:  segResult.confidence ?? null,
    segment_flags:       merged.segment_inferred?.flags ?? null,
    size_tier:           sizeTier,
    signal_completeness: completeness,
    normalized_signals:  merged,
    normalized_at:       new Date().toISOString(),
  };
  if (jurisdiction != null) patch.jurisdiction = jurisdiction;

  // ── 4b. Asset-class relevance (eligibility layer) ──────────────────────────
  // Reads this prospect's filings/holdings, persists per-filing breakdowns
  // (time-series), and derives the firm verdict. Config-driven (refs). The auto
  // verdict is written here; the human override column is left untouched.
  if (prospectId) {
    try {
      const acPatch = await computeAssetClassForProspect({ supabase, logger }, prospectId, firmSignal, refsObj);
      Object.assign(patch, acPatch);
    } catch (err) {
      logger?.warn(`normalizeFirm — asset-class ${prospectId}: ${err.message}`);
    }
  }

  // ── 5. Persist to DB ───────────────────────────────────────────────────────
  if (accountId) {
    const { error } = await supabase.from('accounts').update(patch).eq('id', accountId);
    if (error) logger?.warn(`normalizeFirm — account ${accountId}: ${error.message}`);
  }
  if (prospectId) {
    const { error } = await supabase.from('prospects').update(patch).eq('id', prospectId);
    if (error) logger?.warn(`normalizeFirm — prospect ${prospectId}: ${error.message}`);
  }

  // ── 6. Maintain identifier store ───────────────────────────────────────────
  await upsertIdentifiers(supabase, prospectId, accountId, firmSignal);

  return patch;
}
