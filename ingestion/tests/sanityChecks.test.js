/**
 * Unit tests for engine/sanityChecks.js — pure check logic over fixtures.
 * Each check fires on a synthetic violation and passes on clean data;
 * NULL derivation → drift fails; delta is idempotent on identical data.
 */
import { describe, it, expect, vi } from 'vitest';

// Shared fake-supabase state (hoisted so the vi.mock factory can close over it).
const H = vi.hoisted(() => ({ fixtures: {}, capture: {} }));

// Generic chainable + thenable fake. Honors .eq('is_audit_only', false) on the
// prospects table so the structural population filter is genuinely exercised.
vi.mock('../src/supabaseClient.js', () => {
  const make = (table) => {
    const eqs = [];
    const rowsFor = () => {
      let rows = H.fixtures[table] ?? [];
      for (const [col, val] of eqs) rows = rows.filter(r => r[col] === val);
      return rows;
    };
    const b = {
      select: () => b, order: () => b, range: () => b, limit: () => b,
      eq: (col, val) => { eqs.push([col, val]); if (table === 'prospects') (H.capture.prospectEq ??= []).push([col, val]); return b; },
      maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      single:      () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      insert: (rows) => { (H.capture.inserts ??= {})[table] = [...(H.capture.inserts?.[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])]; return Promise.resolve({ data: null, error: null }); },
      then: (res) => res({ data: rowsFor(), error: null }),
    };
    return b;
  };
  return { supabase: { from: make } };
});
vi.mock('../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  checkAumNonnegative, checkCompletenessRange, checkServedFractionRange,
  checkLayer3MirrorsLayer2, checkIrrelevantRequiresDominantNonserved,
  checkSourceImpliesSourceRow, checkDedupResolvedHasMatchReason,
  checkConfigRegexCompiles, checkNoSegmentOver90pct, checkDriftReadback,
  checkDriftStoredMatchesDerived, checkSegmentDistributionShift,
  checkDeltaConfigChangedNoRowsChanged, runChecks, runSanityChecks,
} = await import('../src/engine/sanityChecks.js');

const NAME_SIGNALS = [
  { pattern: 'wealth', target_segment: 'wealth_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'medium', sort_order: 1, is_active: true },
];
const SERVED = [
  { bucket_key: 'equity', served: true }, { bucket_key: 'debt', served: false }, { bucket_key: 'other', served: true },
];
const FIT_CFG = {
  weights: { aum_tier: 20, portfolio_turnover: 25, equity_concentration: 15, options_present: 15, position_count: 5, filer_type: 10, client_type_fit: 5, private_fund_adviser: 5 },
  segmentTiers: { hedge_fund: 'high', asset_manager: 'medium', wealth_manager: 'low', unknown: null, other: null },
  tierRatios: { high: 1.0, medium: 0.5, low: 0.25 },
};
const CFG = { nameSignals: NAME_SIGNALS, servedBuckets: SERVED, fitScoreConfig: FIT_CFG, relevanceConfig: {}, advNameFlags: [], segmentMappings: [], sizeBands: [] };

// ── invariants ────────────────────────────────────────────────────────────────
describe('invariant checks', () => {
  it('aum_nonnegative: passes clean, fails on a negative', () => {
    expect(checkAumNonnegative([{ id: 1, aum_canonical: 5e9, estimated_aum_usd: 5e9 }]).row_count).toBe(0);
    expect(checkAumNonnegative([{ id: 2, aum_canonical: -1, estimated_aum_usd: 0 }]).row_count).toBe(1);
  });
  it('completeness_range: [0,1] only', () => {
    expect(checkCompletenessRange([{ signal_completeness: 0.5 }]).row_count).toBe(0);
    expect(checkCompletenessRange([{ signal_completeness: 1.4 }]).row_count).toBe(1);
  });
  it('served_fraction_range: null or [0,1]', () => {
    expect(checkServedFractionRange([{ asset_class_served_fraction: null }, { asset_class_served_fraction: 0.9 }]).row_count).toBe(0);
    expect(checkServedFractionRange([{ asset_class_served_fraction: 1.2 }]).row_count).toBe(1);
  });
  it('layer3_mirrors_layer2: fails when segment_canonical drifts from normalized_signals', () => {
    const ns = { segment_inferred: { value: 'hedge_fund', source: 'sec_13f' } };
    const clean = [{ id: 1, segment_canonical: 'hedge_fund', normalized_signals: ns }];
    const bad   = [{ id: 2, segment_canonical: 'other',      normalized_signals: ns }];
    expect(checkLayer3MirrorsLayer2(clean, CFG).row_count).toBe(0);
    expect(checkLayer3MirrorsLayer2(bad, CFG).row_count).toBe(1);
  });
  it('irrelevant_requires_dominant_nonserved: irrelevant with equity-dominant book fails', () => {
    const ok  = [{ id: 1, asset_class_relevance: 'irrelevant', asset_class_breakdown: { debt: { value: 90 }, equity: { value: 10 } } }];
    const bad = [{ id: 2, asset_class_relevance: 'irrelevant', asset_class_breakdown: { equity: { value: 90 }, debt: { value: 10 } } }];
    expect(checkIrrelevantRequiresDominantNonserved(ok, { servedBuckets: SERVED }).row_count).toBe(0);
    expect(checkIrrelevantRequiresDominantNonserved(bad, { servedBuckets: SERVED }).row_count).toBe(1);
  });
  it('source_implies_source_row: source but no source row fails', () => {
    expect(checkSourceImpliesSourceRow([{ id: 1, source: 'sec_13f', sources_by_key: { sec_13f: {} } }]).row_count).toBe(0);
    expect(checkSourceImpliesSourceRow([{ id: 2, firm_name: 'X', source: 'sec_13f', sources_by_key: {} }]).row_count).toBe(1);
  });
  it('dedup_resolved_has_match_reason: resolved without reason fails', () => {
    expect(checkDedupResolvedHasMatchReason([{ id: 1, status: 'resolved', match_reason: 'cik' }, { id: 2, status: 'pending', match_reason: null }]).row_count).toBe(0);
    expect(checkDedupResolvedHasMatchReason([{ id: 3, status: 'resolved', match_reason: null }]).row_count).toBe(1);
  });
  it('config_regex_compiles: bad regex fails', () => {
    expect(checkConfigRegexCompiles([{ pattern: '\\bwealth\\b', _table: 'x' }]).row_count).toBe(0);
    expect(checkConfigRegexCompiles([{ pattern: '(', _table: 'segment_name_signals' }]).row_count).toBe(1);
  });
  it('no_segment_over_90pct: >90% share warns', () => {
    const skewed = Array.from({ length: 95 }, (_, i) => ({ id: i, segment_canonical: 'unknown' }))
      .concat(Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, segment_canonical: 'hedge_fund' })));
    expect(checkNoSegmentOver90pct(skewed, { max_share: 0.90 }).row_count).toBeGreaterThan(0);
    const balanced = Array.from({ length: 50 }, (_, i) => ({ id: i, segment_canonical: i % 2 ? 'a' : 'b' }));
    expect(checkNoSegmentOver90pct(balanced, { max_share: 0.90 }).row_count).toBe(0);
  });
  it('drift_readback: segment_inferred tuple present but segment_canonical null → fail', () => {
    const bad = [{ id: 1, normalized_signals: { segment_inferred: { value: 'unknown' } }, segment_canonical: null }];
    expect(checkDriftReadback(bad).row_count).toBe(1);
    const ok = [{ id: 2, normalized_signals: { segment_inferred: { value: 'unknown' } }, segment_canonical: 'unknown' }];
    expect(checkDriftReadback(ok).row_count).toBe(0);
  });
});

// ── drift_stored_matches_derived ──────────────────────────────────────────────
describe('drift_stored_matches_derived', () => {
  const passthroughDef = { signal_key: 'equities_pct', derivation: { target: { tuple: 'equities_pct' }, kind: 'passthrough', raw_key: 'equities_pct' } };
  const segDef = { signal_key: 'segment_inferred', derivation: { target: { tuple: 'segment_inferred' }, kind: 'derived', by_source: { sec_13f: 'inferSegment', sec_adv: 'deriveAdvSegment' } } };

  it('passthrough tuple: matches Layer-1, drifts when it disagrees', () => {
    const clean = [{ id: 1, firm_name: 'X', normalized_signals: { equities_pct: { value: 87.3, source: 'sec_13f' } }, sources_by_key: { sec_13f: { equities_pct: 87.3 } } }];
    expect(checkDriftStoredMatchesDerived(clean, [passthroughDef], CFG).row_count).toBe(0);
    const drift = [{ id: 2, firm_name: 'X', normalized_signals: { equities_pct: { value: 87.3, source: 'sec_13f' } }, sources_by_key: { sec_13f: { equities_pct: 50 } } }];
    expect(checkDriftStoredMatchesDerived(drift, [segDef, passthroughDef], CFG).row_count).toBe(1);
  });

  it('segment_inferred by_source: 13F→inferSegment, ADV→deriveAdvSegment; catches the freeze', () => {
    // 13F: stored 'other' but inferSegment('Navalign LLC')='unknown' → drift (the freeze bug)
    const frozen = [{ id: 1, firm_name: 'Navalign LLC', normalized_signals: { segment_inferred: { value: 'other', source: 'sec_13f' } }, sources_by_key: { sec_13f: {} } }];
    expect(checkDriftStoredMatchesDerived(frozen, [segDef], CFG).row_count).toBe(1);
    // 13F clean
    const ok13 = [{ id: 2, firm_name: 'Navalign LLC', normalized_signals: { segment_inferred: { value: 'unknown', source: 'sec_13f' } }, sources_by_key: { sec_13f: {} } }];
    expect(checkDriftStoredMatchesDerived(ok13, [segDef], CFG).row_count).toBe(0);
    // ADV clean: pooled-only → hedge_fund via deriveAdvSegment
    const okAdv = [{ id: 3, firm_name: 'Apex Partners LP', normalized_signals: { segment_inferred: { value: 'hedge_fund', source: 'sec_adv' } }, sources_by_key: { sec_adv: { clientTypes: ['pooled_investment_vehicles'], advFlags: { hasPrivateFundClients: true } } } }];
    expect(checkDriftStoredMatchesDerived(okAdv, [segDef], CFG).row_count).toBe(0);
  });

  it('column target: fit_score re-derived via computeFitScore', () => {
    // 20+25+15+15+5(pos)+10(hedge=high) + 0 client_type + 0 private_fund = 90 (no ADV signals)
    const p = { id: 1, firm_name: 'X', segment_canonical: 'hedge_fund', estimated_aum_usd: 1e9, portfolio_turnover_pct: 75, equities_pct: 90, options_present: true, position_count: 200, normalized_signals: {}, fit_score: 90 };
    const fitDef = { signal_key: 'fit_score', derivation: { target: { column: 'fit_score' }, kind: 'derived', fn: 'computeFitScore' } };
    expect(checkDriftStoredMatchesDerived([p], [fitDef], CFG).row_count).toBe(0);       // matches
    expect(checkDriftStoredMatchesDerived([{ ...p, fit_score: 42 }], [fitDef], CFG).row_count).toBe(1); // drifts
  });

  it('NULL/absent derivation → FAIL (coverage hole), even with no matching prospect', () => {
    const undescribed = { signal_key: 'newthing', derivation: null };
    const r = checkDriftStoredMatchesDerived([], [undescribed], CFG);
    expect(r.row_count).toBe(1);
    expect(r.observed.undescribed[0]).toMatchObject({ signal_key: 'newthing', reason: 'null_derivation' });
  });

  it('derived fn missing from dispatch map → undescribed → fail', () => {
    const badFn = { signal_key: 'x', derivation: { target: { column: 'fit_score' }, kind: 'derived', fn: 'noSuchFn' } };
    const p = { id: 1, fit_score: 10, normalized_signals: {} };
    expect(checkDriftStoredMatchesDerived([p], [badFn], CFG).row_count).toBe(1);
  });

  it('skip descriptor is honored (no fail)', () => {
    const skipDef = { signal_key: 'match_reason', derivation: { kind: 'skip', reason: 'resolveFirm I/O' } };
    expect(checkDriftStoredMatchesDerived([{ id: 1, normalized_signals: {} }], [skipDef], CFG).row_count).toBe(0);
  });
});

// ── delta ─────────────────────────────────────────────────────────────────────
describe('delta checks', () => {
  const pop = Array.from({ length: 10 }, (_, i) => ({ segment_canonical: i < 6 ? 'unknown' : 'asset_manager' }));

  it('segment_distribution_shift: no prior → pass; identical prior → 0 shift (idempotent)', () => {
    const first = checkSegmentDistributionShift(pop, null, { max_shift_pct: 10 });
    expect(first.row_count).toBe(0); // no baseline
    const second = checkSegmentDistributionShift(pop, first.observed, { max_shift_pct: 10 });
    expect(second.observed.shift_pct).toBe(0);
    expect(second.row_count).toBe(0);
  });
  it('segment_distribution_shift: a big shift warns', () => {
    const prior = checkSegmentDistributionShift(pop, null, { max_shift_pct: 10 }).observed;
    const shifted = pop.map(() => ({ segment_canonical: 'hedge_fund' })); // 100% moved
    expect(checkSegmentDistributionShift(shifted, prior, { max_shift_pct: 10 }).row_count).toBe(1);
  });
  it('delta_config_changed_no_rows_changed: changed config + 0 rows → warn', () => {
    expect(checkDeltaConfigChangedNoRowsChanged('sigB', { signature: 'sigA' }, 0).row_count).toBe(1);
    expect(checkDeltaConfigChangedNoRowsChanged('sigB', { signature: 'sigA' }, 5).row_count).toBe(0); // rows changed → ok
    expect(checkDeltaConfigChangedNoRowsChanged('sigA', { signature: 'sigA' }, 0).row_count).toBe(0); // unchanged → ok
  });
});

// ── runChecks aggregation ─────────────────────────────────────────────────────
describe('runChecks aggregation → overall status', () => {
  const DEFS = [
    { check_key: 'aum_nonnegative', family: 'invariant', severity: 'fail', is_active: true },
    { check_key: 'no_segment_over_90pct', family: 'invariant', severity: 'warn', is_active: true, params: { max_share: 0.90 } },
  ];
  const clean = { prospects: [{ id: 1, aum_canonical: 1, estimated_aum_usd: 1, segment_canonical: 'a' }, { id: 2, aum_canonical: 1, estimated_aum_usd: 1, segment_canonical: 'b' }] };

  it('all pass → completed', () => {
    const { overall, sanity } = runChecks(clean, DEFS);
    expect(overall).toBe('completed'); expect(sanity.fail).toBe(0); expect(sanity.warn).toBe(0);
  });
  it('a warn → completed_with_warnings', () => {
    const skew = { prospects: Array.from({ length: 20 }, (_, i) => ({ id: i, aum_canonical: 1, estimated_aum_usd: 1, segment_canonical: 'unknown' })) };
    expect(runChecks(skew, DEFS).overall).toBe('completed_with_warnings');
  });
  it('a fail → failed', () => {
    const bad = { prospects: [{ id: 1, aum_canonical: -5, estimated_aum_usd: -5, segment_canonical: 'a' }] };
    expect(runChecks(bad, DEFS).overall).toBe('failed');
  });
  it('an active check with no implementation is itself a fail', () => {
    const r = runChecks(clean, [{ check_key: 'ghost_check', family: 'invariant', severity: 'fail', is_active: true }]);
    expect(r.overall).toBe('failed');
  });
});

// ── runner: structural is_audit_only exclusion + persistence ──────────────────
describe('runSanityChecks — structural audit-only exclusion + persistence', () => {
  it('excludes is_audit_only rows (the SANDERS shadow) and writes check_results', async () => {
    H.fixtures = {
      check_definitions: [{ check_key: 'source_implies_source_row', family: 'invariant', severity: 'fail', is_active: true, params: {} }],
      prospects: [
        { id: 'p1', firm_name: 'Real Co', source: 'sec_13f', is_audit_only: false, normalized_signals: {} },
        // audit shadow: source but no source row — would FAIL if not excluded
        { id: 'shadow', firm_name: 'SANDERS MORRIS HARRIS LLC', source: 'sec_13f', is_audit_only: true, normalized_signals: {} },
      ],
      prospect_sources: [{ prospect_id: 'p1', source: 'sec_13f', signals: {} }],
    };
    H.capture = {};

    const { overall, sanity } = await runSanityChecks({ supabase: (await import('../src/supabaseClient.js')).supabase, logger: { info: vi.fn(), warn: vi.fn() } }, { jobRunId: 'run1', gitSha: 'abc123' });

    // the audit shadow was filtered → source_implies_source_row passes → run completes
    expect(overall).toBe('completed');
    expect(sanity.fail).toBe(0);
    // structural filter was applied on the prospects query
    expect(H.capture.prospectEq).toContainEqual(['is_audit_only', false]);
    // results persisted with the run id + git_sha threaded into sanity
    expect(H.capture.inserts?.check_results?.[0]).toMatchObject({ job_run_id: 'run1', check_key: 'source_implies_source_row', status: 'pass' });
    expect(sanity.git_sha).toBe('abc123');
  });
});
