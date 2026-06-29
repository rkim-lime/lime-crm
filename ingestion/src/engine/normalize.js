/**
 * Normalization layer — Layer 2 (per-signal provenance tuples) and
 * Layer 3 (canonical indexed fields) derived from raw connector signals.
 *
 * Exported pure helpers are tested directly; DB-touching functions accept
 * a pre-loaded refs object (load once per connector run, reuse per firm).
 */

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
export function extractSignals(firmSignal) {
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

    if (firmSignal.inferred_segment) {
      signals.segment_inferred = {
        value:      firmSignal.inferred_segment,
        basis:      '13f_name_heuristic',
        source:     'sec_13f',
        as_of:      asOf,
        confidence: 'low',
      };
    }

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

    if (firmSignal.inferred_segment) {
      // Confidence depends on whether client-type data drove the segment.
      // If the firm has private-fund clients or any ADV client types, the ADV
      // connector overrode the name heuristic → high confidence.
      const clientTypeDriven =
        firmSignal.advFlags?.hasPrivateFundClients ||
        (firmSignal.clientTypes?.length ?? 0) > 0;
      signals.segment_inferred = {
        value:      firmSignal.inferred_segment,
        basis:      clientTypeDriven ? 'adv_client_type' : 'adv_name_heuristic',
        source:     'sec_adv',
        as_of:      null,
        confidence: clientTypeDriven ? 'high' : 'low',
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
 * Higher confidence wins; ties broken by more recent as_of.
 */
export function mergeSignal(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const er = CONFIDENCE_RANK[existing.confidence] ?? 0;
  const ir = CONFIDENCE_RANK[incoming.confidence] ?? 0;

  if (ir > er) return incoming;
  if (ir < er) return existing;

  // Same confidence — prefer more recent as_of date
  if (incoming.as_of && (!existing.as_of || incoming.as_of > existing.as_of)) {
    return incoming;
  }
  return existing;
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
 */
export function deriveSegmentCanonical(normalizedSignals, segmentMappings) {
  const seg = normalizedSignals.segment_inferred;
  if (!seg?.value) return { value: null, confidence: null };

  const connectorSrc = SOURCE_TO_CONNECTOR[seg.source] ?? seg.source;
  const mapping = (segmentMappings ?? []).find(
    m => m.source === connectorSrc && m.source_value === seg.value,
  );

  if (mapping) {
    return { value: mapping.canonical_value_key, confidence: mapping.confidence };
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

/**
 * Load all reference tables needed for normalization.
 * Call once per connector run; pass the result as `refs` to normalizeFirm.
 */
export async function loadNormalizationRefs(supabase) {
  const [signalDefs, segmentMappings, sizeBands] = await Promise.all([
    loadSignalDefs(supabase),
    loadSegmentMappings(supabase),
    loadSizeBands(supabase),
  ]);
  return { signalDefs, segmentMappings, sizeBands };
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

  const { signalDefs, segmentMappings, sizeBands } =
    refs ?? await loadNormalizationRefs(supabase);

  // ── 1. Extract signals from this connector run ─────────────────────────────
  const currentSignals = extractSignals(firmSignal);

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
    size_tier:           sizeTier,
    signal_completeness: completeness,
    normalized_signals:  merged,
    normalized_at:       new Date().toISOString(),
  };
  if (jurisdiction != null) patch.jurisdiction = jurisdiction;

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
