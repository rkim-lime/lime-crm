/**
 * Unit tests for engine/normalize.js
 *
 * Pure helpers are tested directly (no mocking needed).
 * normalizeFirm is tested with a fake supabase that captures DB calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferSegment } from '../src/engine/computeSignals.js';
import {
  extractSignals,
  mergeSignal,
  deriveAumCanonical,
  deriveSegmentCanonical,
  deriveSizeTier,
  computeCompleteness,
  normalizeFirm,
} from '../src/engine/normalize.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SEGMENT_MAPPINGS = [
  { source: 'ingest_13f', source_value: 'hedge_fund',   canonical_value_key: 'hedge_fund',   confidence: 'low' },
  { source: 'ingest_13f', source_value: 'quant_fund',   canonical_value_key: 'quant_fund',   confidence: 'low' },
  { source: 'ingest_13f', source_value: 'prop_trader',  canonical_value_key: 'prop_trading', confidence: 'low' },
  { source: 'ingest_13f', source_value: 'broker_dealer',canonical_value_key: 'broker_dealer',confidence: 'low' },
  { source: 'ingest_13f', source_value: 'pension',      canonical_value_key: 'pension',      confidence: 'low' },
  { source: 'ingest_adv', source_value: 'hedge_fund',   canonical_value_key: 'hedge_fund',   confidence: 'high' },
  { source: 'ingest_adv', source_value: 'quant_fund',   canonical_value_key: 'quant_fund',   confidence: 'high' },
  { source: 'ingest_adv', source_value: 'pension',      canonical_value_key: 'pension',      confidence: 'high' },
  { source: 'ingest_adv', source_value: 'broker_dealer',canonical_value_key: 'broker_dealer',confidence: 'medium' },
];

const SIZE_BANDS = [
  { tier_key: 'mega',  min_aum: 50_000_000_000, max_aum: null },
  { tier_key: 'large', min_aum: 10_000_000_000, max_aum: 50_000_000_000 },
  { tier_key: 'mid',   min_aum:  1_000_000_000, max_aum: 10_000_000_000 },
  { tier_key: 'small', min_aum: null,            max_aum:  1_000_000_000 },
];

const SIGNAL_DEFS = [
  { signal_key: 'aum_13f_portfolio',      canonical_dimension: 'aum' },
  { signal_key: 'aum_adv_regulatory',     canonical_dimension: 'aum' },
  { signal_key: 'turnover_pct',           canonical_dimension: 'execution_sensitivity' },
  { signal_key: 'equities_pct',           canonical_dimension: 'execution_sensitivity' },
  { signal_key: 'options_present',        canonical_dimension: 'execution_sensitivity' },
  { signal_key: 'position_count',         canonical_dimension: 'execution_sensitivity' },
  { signal_key: 'client_types',           canonical_dimension: 'client_type' },
  { signal_key: 'has_private_fund_clients', canonical_dimension: 'cross_market' },
  { signal_key: 'segment_inferred',       canonical_dimension: 'segment' },
];

// Name-signal config fixture — mirrors migration 024 seed (segment_name_signals).
const NAME_SIGNALS = [
  { pattern: 'wealth',                                            target_segment: 'wealth_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'medium', sort_order: 1,  is_active: true },
  { pattern: 'retirement|\\bretire',                              target_segment: 'wealth_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'low',    sort_order: 2,  is_active: true },
  { pattern: '\\bbank\\b|trust\\s+company|trust\\s+bank|national\\s+association', target_segment: 'bank', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'low', sort_order: 3, is_active: true },
  { pattern: 'insurance|assurance',                               target_segment: 'insurance',      signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'low',    sort_order: 4,  is_active: true },
  { pattern: 'pension|endowment|foundation',                     target_segment: 'pension',        signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'low',    sort_order: 5,  is_active: true },
  { pattern: 'family\\s+office',                                 target_segment: 'family_office',  signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'low',    sort_order: 6,  is_active: true },
  { pattern: 'broker|dealer|brokerage|securities',               target_segment: 'broker_dealer',  signal_kind: 'name_signal', vetoes_hedge_fund: true,  confidence: 'low',    sort_order: 7,  is_active: true },
  { pattern: '\\bquant(?:itative)?\\b|\\bsystematic\\b|\\balgorithmic\\b', target_segment: 'quant_fund', signal_kind: 'fund_type', vetoes_hedge_fund: false, confidence: 'medium', sort_order: 8, is_active: true, promote_from: ['hedge_fund'] },
  { pattern: '\\bprop(?:rietary)?\\b|trading\\s+co',             target_segment: 'prop_trading',   signal_kind: 'fund_type',   vetoes_hedge_fund: false, confidence: 'low',    sort_order: 9,  is_active: true, promote_from: ['hedge_fund'] },
  { pattern: '\\bhedge\\b',                                       target_segment: 'hedge_fund',     signal_kind: 'fund_name',   vetoes_hedge_fund: false, confidence: 'medium', sort_order: 10, is_active: true },
  { pattern: 'master\\s+fund|feeder\\s+fund|offshore\\s+fund',    target_segment: 'hedge_fund',     signal_kind: 'fund_name',   vetoes_hedge_fund: false, confidence: 'medium', sort_order: 11, is_active: true },
];

const REFS = { signalDefs: SIGNAL_DEFS, segmentMappings: SEGMENT_MAPPINGS, sizeBands: SIZE_BANDS, nameSignals: NAME_SIGNALS };

// ── Helpers ───────────────────────────────────────────────────────────────────

function firm13F(overrides = {}) {
  return {
    source:                 'sec_13f',
    cik:                    '0001234567',
    crdNumber:              null,
    firmName:               'Apex Hedge Capital',
    estimated_aum_usd:      5_000_000_000,
    position_count:         120,
    portfolio_turnover_pct: 42.5,
    equities_pct:           87.3,
    options_present:        true,
    inferred_segment:       'hedge_fund',
    quarters:               [{ filing: { periodOfReport: '2024-03-31' }, holdings: [] }],
    ...overrides,
  };
}

function firmADV(overrides = {}) {
  return {
    source:                 'sec_adv',
    cik:                    null,
    crdNumber:              '123456',
    firmName:               'Quant Strategies LLC',
    regulatoryAum:          8_000_000_000,
    estimated_aum_usd:      8_000_000_000,
    inferred_segment:       'quant_fund',
    // Pooled-only default → hedge_fund composition, refined to quant_fund by the
    // quant name signal (requires NAME_SIGNALS to be passed to extractSignals).
    clientTypes:            ['pooled_investment_vehicles'],
    advFlags:               { hasPrivateFundClients: true },
    quarters:               [],
    ...overrides,
  };
}


// ── extractSignals ────────────────────────────────────────────────────────────

describe('extractSignals — 13F', () => {
  it('extracts all 13F signals with correct provenance', () => {
    const sigs = extractSignals(firm13F());
    expect(sigs.aum_13f_portfolio).toMatchObject({
      value:      5_000_000_000,
      basis:      '13f_portfolio',
      source:     'sec_13f',
      as_of:      '2024-03-31',
      confidence: 'high',
    });
    expect(sigs.turnover_pct.value).toBe(42.5);
    expect(sigs.turnover_pct.confidence).toBe('medium'); // approximation
    expect(sigs.equities_pct.value).toBe(87.3);
    expect(sigs.options_present.value).toBe(true);
    expect(sigs.position_count.value).toBe(120);
    expect(sigs.segment_inferred).toMatchObject({
      value:      'hedge_fund',
      basis:      '13f_name_heuristic',
      confidence: 'low',
    });
  });

  it('omits turnover_pct when null', () => {
    const sigs = extractSignals(firm13F({ portfolio_turnover_pct: null }));
    expect(sigs.turnover_pct).toBeUndefined();
  });

  it('uses empty-array quarters → as_of null', () => {
    const sigs = extractSignals(firm13F({ quarters: [] }));
    expect(sigs.aum_13f_portfolio.as_of).toBeNull();
  });

  it('as_of comes from the latest filing periodOfReport — FIX A: buildFirmSignal13F now emits it', () => {
    // buildFirmSignal13F(prospect, rawSignals, periodOfReport) sets
    // quarters: [{ filing: { periodOfReport } }] so the recompute tuple carries as_of.
    const dated = extractSignals(firm13F({ quarters: [{ filing: { periodOfReport: '2026-03-31' } }] }));
    expect(dated.segment_inferred.as_of).toBe('2026-03-31');
    expect(dated.aum_13f_portfolio.as_of).toBe('2026-03-31');
  });

  it('does not produce ADV-only signals', () => {
    const sigs = extractSignals(firm13F());
    expect(sigs.aum_adv_regulatory).toBeUndefined();
    expect(sigs.client_types).toBeUndefined();
    expect(sigs.has_private_fund_clients).toBeUndefined();
  });

  it('re-derives segment from firmName, ignores stale inferred_segment field (Ironwood → wealth_manager)', () => {
    // Simulates a firm that was originally ingested before the heuristic improvement:
    // the connector stored inferred_segment='hedge_fund', but the firm name clearly
    // identifies it as a wealth manager. normalize.js must ignore the cached field.
    const sigs = extractSignals(firm13F({
      firmName:         'Ironwood Wealth Management',
      inferred_segment: 'hedge_fund',  // stale — should be ignored
    }));
    expect(sigs.segment_inferred.value).toBe('wealth_manager');
    expect(sigs.segment_inferred.basis).toBe('13f_name_heuristic');
    expect(sigs.segment_inferred.confidence).toBe('low');
  });

  it('re-derives segment from firmName for Sanders Morris Harris → unknown (name-miss → enrichment queue)', () => {
    const sigs = extractSignals(firm13F({
      firmName:         'SANDERS MORRIS HARRIS',
      inferred_segment: 'hedge_fund',  // stale
    }));
    expect(sigs.segment_inferred.value).toBe('unknown');
  });
});

describe('extractSignals — ADV', () => {
  it('extracts ADV signals with correct provenance', () => {
    const sigs = extractSignals(firmADV(), NAME_SIGNALS);
    expect(sigs.aum_adv_regulatory).toMatchObject({
      value:      8_000_000_000,
      basis:      'adv_regulatory',
      source:     'sec_adv',
      as_of:      null,
      confidence: 'high',
    });
    expect(sigs.segment_inferred).toMatchObject({
      value:      'quant_fund',   // pooled-only → hedge composition, refined by quant name
      basis:      'adv_client_type',
      confidence: 'high',
    });
    expect(sigs.client_types.value).toEqual(['pooled_investment_vehicles']);
    expect(sigs.has_private_fund_clients).toMatchObject({
      value:      true,
      basis:      'adv_item7a',
      confidence: 'high',
    });
  });

  it('omits aum_adv_regulatory when regulatoryAum is null (private-fund-only)', () => {
    const sigs = extractSignals(firmADV({ regulatoryAum: null }), NAME_SIGNALS);
    expect(sigs.aum_adv_regulatory).toBeUndefined();
  });

  it('no client-type data + neutral name → unknown/low (honest null, not a guess)', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'Sanders Morris Harris',   // no name signal matches
      clientTypes: [],
      advFlags:    { hasPrivateFundClients: false },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('unknown');
    expect(sigs.segment_inferred.confidence).toBe('low');
    expect(sigs.segment_inferred.basis).toBe('adv_name_signal');
  });

  it('does not produce 13F-only signals', () => {
    const sigs = extractSignals(firmADV(), NAME_SIGNALS);
    expect(sigs.aum_13f_portfolio).toBeUndefined();
    expect(sigs.turnover_pct).toBeUndefined();
    expect(sigs.equities_pct).toBeUndefined();
  });
});

describe('extractSignals — ADV segment derived from clientTypes, not cached inferred_segment', () => {
  it('ignores stale inferred_segment; recomputes from clientTypes (Clearbridge backfill regression)', () => {
    // Backfill sets inferred_segment = inferSegment('Clearbridge Investments LLC') = 'unknown'.
    // extractSignals must call deriveAdvSegment: institutional clients dominate → asset_manager.
    const sigs = extractSignals(firmADV({
      firmName:         'Clearbridge Investments LLC',
      inferred_segment: 'other',  // stale name-heuristic output from backfill
      clientTypes:      ['pooled_investment_vehicles', 'pension_plans', 'institutional', 'individuals'],
      advFlags:         { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('asset_manager');
    expect(sigs.segment_inferred.confidence).toBe('medium'); // institutional + mix
  });

  it('flag-only (no clientTypes) + neutral name → unknown, NOT a hedge_fund guess (MK Capital)', () => {
    // hedge_fund must be EARNED. The private-fund flag alone with a neutral name
    // ('capital' is not a segment signal) resolves to unknown → enrichment queue.
    const sigs = extractSignals(firmADV({
      firmName:         'MK Capital Company',
      inferred_segment: 'asset_manager', // stale name-heuristic output from backfill
      clientTypes:      [],
      advFlags:         { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('unknown');
    expect(sigs.segment_inferred.confidence).toBe('low');
    expect(sigs.segment_inferred.basis).toBe('adv_flag_only');
  });

  it('backfill and live ingest produce identical segments for same inputs', () => {
    const base = {
      firmName:    'Clearbridge Investments LLC',
      clientTypes: ['pension_plans'],
      advFlags:    { hasPrivateFundClients: true },
    };
    // Live ingest: inferred_segment already computed by normalizeFromFirm
    const liveSigs = extractSignals(firmADV({ ...base, inferred_segment: 'asset_manager' }), NAME_SIGNALS);
    // Backfill: inferred_segment set to inferSegment(firmName) = 'unknown' (name heuristic)
    const backfillSigs = extractSignals(firmADV({ ...base, inferred_segment: 'other' }), NAME_SIGNALS);
    expect(liveSigs.segment_inferred.value).toBe(backfillSigs.segment_inferred.value);
    expect(liveSigs.segment_inferred.confidence).toBe(backfillSigs.segment_inferred.confidence);
  });
});

describe('extractSignals — ADV segment confidence', () => {
  it('pension_plans + hasPrivateFundClients=true → asset_manager/medium (Bluescape/Tremont pattern)', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'Bluescape Energy Partners LLC', // non-quant name
      clientTypes: ['pension_plans'],
      advFlags:    { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('asset_manager');
    expect(sigs.segment_inferred.confidence).toBe('medium');
    expect(sigs.segment_inferred.basis).toBe('adv_client_type');
  });

  it('pooled vehicles only + hasPrivateFundClients=true → hedge_fund/high (EARNED)', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'Apex Partners LP', // non-quant, non-veto name
      clientTypes: ['pooled_investment_vehicles'],
      advFlags:    { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('hedge_fund');
    expect(sigs.segment_inferred.confidence).toBe('high');
  });

  it('high_net_worth only, no private fund → wealth_manager/high', () => {
    // firmName 'Quant Strategies LLC' matches the quant name signal, but the
    // quant refinement only applies in the pooled-dominant branch; retail wins here.
    const sigs = extractSignals(firmADV({
      clientTypes: ['high_net_worth'],
      advFlags:    { hasPrivateFundClients: false },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('wealth_manager');
    expect(sigs.segment_inferred.confidence).toBe('high');
  });

  it('pooled + institutional mixed → asset_manager/medium (Clearbridge pattern)', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'Clearbridge Investments LLC', // non-quant name
      clientTypes: ['pooled_investment_vehicles', 'pension_plans', 'institutional'],
      advFlags:    { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('asset_manager');
    expect(sigs.segment_inferred.confidence).toBe('medium');
  });

  it('name veto: pooled-dominant + "wealth" name → wealth_manager, NOT hedge_fund', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'Everwealth Capital LP',
      clientTypes: ['pooled_investment_vehicles'],
      advFlags:    { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('wealth_manager');
    expect(sigs.segment_inferred.basis).toBe('adv_name_veto');
  });

  it('hasPrivateFundClients=true, no client types + neutral name → unknown/low (flag-only, NOT hedge_fund)', () => {
    const sigs = extractSignals(firmADV({
      firmName:    'MK Capital Company', // 'capital' is not a segment signal
      clientTypes: [],
      advFlags:    { hasPrivateFundClients: true },
    }), NAME_SIGNALS);
    expect(sigs.segment_inferred.value).toBe('unknown');
    expect(sigs.segment_inferred.confidence).toBe('low');
  });
});


// ── mergeSignal ───────────────────────────────────────────────────────────────

describe('mergeSignal', () => {
  it('returns incoming when existing is null', () => {
    const inc = { value: 100, confidence: 'low', as_of: null, source: 'sec_13f', basis: 'x' };
    expect(mergeSignal(null, inc)).toBe(inc);
  });

  it('higher confidence wins regardless of recency', () => {
    const low  = { value: 1, confidence: 'low',  as_of: '2024-06-30', source: 'sec_13f', basis: 'a' };
    const high = { value: 2, confidence: 'high', as_of: '2024-01-01', source: 'sec_adv', basis: 'b' };
    expect(mergeSignal(low, high)).toBe(high);
    expect(mergeSignal(high, low)).toBe(high);
  });

  it('same confidence: more recent as_of wins', () => {
    const older  = { value: 1, confidence: 'high', as_of: '2023-12-31', source: 'sec_13f', basis: 'a' };
    const newer  = { value: 2, confidence: 'high', as_of: '2024-03-31', source: 'sec_13f', basis: 'a' };
    expect(mergeSignal(older, newer)).toBe(newer);
    expect(mergeSignal(newer, older)).toBe(newer);
  });

  it('same confidence and identical as_of: incoming wins (fresh computation overwrites cache)', () => {
    const e = { value: 1, confidence: 'high', as_of: '2024-03-31', source: 'sec_13f', basis: 'a' };
    const i = { value: 2, confidence: 'high', as_of: '2024-03-31', source: 'sec_13f', basis: 'a' };
    expect(mergeSignal(e, i)).toBe(i);
  });

  it('same confidence, both as_of null: incoming wins (backfill re-normalization case)', () => {
    const stale = { value: 'hedge_fund',    confidence: 'low', as_of: null, source: 'sec_13f', basis: '13f_name_heuristic' };
    const fresh = { value: 'wealth_manager', confidence: 'low', as_of: null, source: 'sec_13f', basis: '13f_name_heuristic' };
    expect(mergeSignal(stale, fresh)).toBe(fresh);
  });

  it('existing has as_of, incoming null: existing wins (dated signal beats undated)', () => {
    const dated   = { value: 1, confidence: 'low', as_of: '2024-03-31', source: 'sec_13f', basis: 'a' };
    const undated = { value: 2, confidence: 'low', as_of: null,         source: 'sec_13f', basis: 'a' };
    expect(mergeSignal(dated, undated)).toBe(dated);
  });

  it('same source, stale high-confidence cached value does not block lower-confidence correction (Bluescape regression)', () => {
    // Old ADV logic stored hedge_fund/high. New logic correctly emits asset_manager/medium.
    // Without same-source rule, high > medium → stale value would survive re-ingest.
    const stale   = { value: 'hedge_fund',   confidence: 'high',   source: 'sec_adv', as_of: null, basis: 'adv_client_type' };
    const corrected = { value: 'asset_manager', confidence: 'medium', source: 'sec_adv', as_of: null, basis: 'adv_client_type' };
    expect(mergeSignal(stale, corrected)).toBe(corrected);
  });

  it('cross-source: higher confidence still wins (ADV high over 13F low)', () => {
    const low13f  = { value: 'other',      confidence: 'low',  source: 'sec_13f', as_of: '2024-03-31', basis: 'name' };
    const highAdv = { value: 'hedge_fund', confidence: 'high', source: 'sec_adv', as_of: null,         basis: 'adv_client_type' };
    expect(mergeSignal(low13f, highAdv)).toBe(highAdv);
    expect(mergeSignal(highAdv, low13f)).toBe(highAdv);
  });

  // ── recompute: authoritative backfill re-derivation ──
  const dated   = { value: 'other',   confidence: 'low', source: 'sec_13f', as_of: '2026-03-31', basis: '13f_name_heuristic' };
  const undated = { value: 'unknown', confidence: 'low', source: 'sec_13f', as_of: null,         basis: '13f_name_heuristic' };

  it('same-source: dated existing + undated incoming + recompute:true → incoming WINS (the freeze fix)', () => {
    expect(mergeSignal(dated, undated, { recompute: true })).toBe(undated);
  });
  it('same-source: dated existing + undated incoming + recompute:false → existing wins (out-of-order guard intact)', () => {
    expect(mergeSignal(dated, undated, { recompute: false })).toBe(dated);
    expect(mergeSignal(dated, undated)).toBe(dated); // default = guard
  });
  it('same-source: dated existing + NEWER dated incoming → incoming wins (unchanged)', () => {
    const newer = { ...undated, as_of: '2026-06-30' };
    expect(mergeSignal(dated, newer)).toBe(newer);
    expect(mergeSignal(dated, newer, { recompute: true })).toBe(newer);
  });
  it('same-source: dated existing + OLDER dated incoming, recompute:false → existing wins (out-of-order guard)', () => {
    const older = { ...undated, as_of: '2025-12-31' };
    expect(mergeSignal(dated, older, { recompute: false })).toBe(dated);
    // but an authoritative recompute overrides even an older date
    expect(mergeSignal(dated, older, { recompute: true })).toBe(older);
  });
});


// ── deriveAumCanonical ────────────────────────────────────────────────────────

describe('deriveAumCanonical', () => {
  it('ADV regulatory beats 13F portfolio', () => {
    const norm = {
      aum_13f_portfolio:  { value: 5e9, basis: '13f_portfolio', source: 'sec_13f', as_of: '2024-03-31' },
      aum_adv_regulatory: { value: 8e9, basis: 'adv_regulatory', source: 'sec_adv', as_of: null },
    };
    const result = deriveAumCanonical(norm);
    expect(result.value).toBe(8e9);
    expect(result.basis).toBe('adv_regulatory');
    expect(result.source).toBe('sec_adv');
  });

  it('falls back to 13F when ADV not present', () => {
    const norm = {
      aum_13f_portfolio: { value: 5e9, basis: '13f_portfolio', source: 'sec_13f', as_of: '2024-03-31' },
    };
    const result = deriveAumCanonical(norm);
    expect(result.value).toBe(5e9);
    expect(result.basis).toBe('13f_portfolio');
    expect(result.as_of).toBe('2024-03-31');
  });

  it('returns all nulls when no AUM signals present', () => {
    const result = deriveAumCanonical({ segment_inferred: { value: 'hedge_fund' } });
    expect(result).toEqual({ value: null, basis: null, source: null, as_of: null });
  });

  it('records basis and source correctly for 13F', () => {
    const norm = {
      aum_13f_portfolio: { value: 2e9, basis: '13f_portfolio', source: 'sec_13f', as_of: '2023-12-31' },
    };
    const result = deriveAumCanonical(norm);
    expect(result.basis).toBe('13f_portfolio');
    expect(result.source).toBe('sec_13f');
  });
});


// ── deriveSegmentCanonical ────────────────────────────────────────────────────

describe('deriveSegmentCanonical', () => {
  it('maps 13F prop_trader → prop_trading canonical key', () => {
    const norm = {
      segment_inferred: { value: 'prop_trader', source: 'sec_13f', confidence: 'low' },
    };
    const result = deriveSegmentCanonical(norm, SEGMENT_MAPPINGS);
    expect(result.value).toBe('prop_trading');
    expect(result.confidence).toBe('low');
  });

  it('maps ADV hedge_fund with high confidence', () => {
    const norm = {
      segment_inferred: { value: 'hedge_fund', source: 'sec_adv', confidence: 'high' },
    };
    const result = deriveSegmentCanonical(norm, SEGMENT_MAPPINGS);
    expect(result.value).toBe('hedge_fund');
    expect(result.confidence).toBe('high');
  });

  it('ADV confidence overrides 13F confidence for same canonical value', () => {
    // After merging, the ADV high-confidence entry wins. deriveSegmentCanonical
    // uses whatever is in normalized_signals.segment_inferred (already merged).
    const norm = {
      segment_inferred: { value: 'hedge_fund', source: 'sec_adv', confidence: 'high' },
    };
    const result = deriveSegmentCanonical(norm, SEGMENT_MAPPINGS);
    expect(result.confidence).toBe('high');
  });

  it('hedge_fund tuple with confidence=medium → canonical confidence=medium, not high (Bluescape regression)', () => {
    // taxonomy_mappings has hedge_fund/ingest_adv with hardcoded confidence='high'.
    // The tuple confidence (medium, from conflict-aware logic) must take precedence.
    const norm = {
      segment_inferred: { value: 'hedge_fund', source: 'sec_adv', confidence: 'medium' },
    };
    const result = deriveSegmentCanonical(norm, SEGMENT_MAPPINGS);
    expect(result.value).toBe('hedge_fund');
    expect(result.confidence).toBe('medium');
  });

  it('falls back to raw value when no mapping exists', () => {
    const norm = {
      segment_inferred: { value: 'unknown_type', source: 'sec_13f', confidence: 'low' },
    };
    const result = deriveSegmentCanonical(norm, SEGMENT_MAPPINGS);
    expect(result.value).toBe('unknown_type');
    expect(result.confidence).toBe('low');
  });

  it('returns null value when no segment signal present', () => {
    const result = deriveSegmentCanonical({ aum_13f_portfolio: { value: 1e9 } }, SEGMENT_MAPPINGS);
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
  });
});


// ── deriveSizeTier ────────────────────────────────────────────────────────────

describe('deriveSizeTier', () => {
  it.each([
    [100_000_000_000, 'mega'],   // $100B → mega (≥ $50B)
    [ 50_000_000_000, 'mega'],   // exactly $50B → mega
    [ 25_000_000_000, 'large'],  // $25B → large
    [ 10_000_000_000, 'large'],  // exactly $10B → large
    [  5_000_000_000, 'mid'],    // $5B → mid
    [  1_000_000_000, 'mid'],    // exactly $1B → mid
    [    500_000_000, 'small'],  // $500M → small
    [              0, 'small'],  // $0 → small (< $1B)
  ])('AUM %i → %s', (aum, expected) => {
    expect(deriveSizeTier(aum, SIZE_BANDS)).toBe(expected);
  });

  it('returns null for null AUM (MK Capital style)', () => {
    expect(deriveSizeTier(null, SIZE_BANDS)).toBeNull();
  });

  it('returns null for empty bands config', () => {
    expect(deriveSizeTier(5e9, [])).toBeNull();
  });
});


// ── computeCompleteness ───────────────────────────────────────────────────────

describe('computeCompleteness', () => {
  it('0.0 for empty signals', () => {
    expect(computeCompleteness({}, SIGNAL_DEFS)).toBe(0);
  });

  it('1.0 when all 9 signals present', () => {
    const norm = Object.fromEntries(
      SIGNAL_DEFS.map(d => [d.signal_key, { value: d.signal_key === 'options_present' ? false : 1 }])
    );
    expect(computeCompleteness(norm, SIGNAL_DEFS)).toBe(1);
  });

  it('increases as more signals are added', () => {
    const one  = { aum_13f_portfolio: { value: 5e9 } };
    const two  = { aum_13f_portfolio: { value: 5e9 }, turnover_pct: { value: 40 } };
    const c1   = computeCompleteness(one, SIGNAL_DEFS);
    const c2   = computeCompleteness(two, SIGNAL_DEFS);
    expect(c2).toBeGreaterThan(c1);
  });

  it('excludes signals with null value from numerator', () => {
    const norm = { aum_13f_portfolio: { value: null }, turnover_pct: { value: 40 } };
    const c = computeCompleteness(norm, SIGNAL_DEFS);
    expect(c).toBe(Math.round((1 / 9) * 100) / 100);
  });

  it('returns 0 when signalDefs is empty', () => {
    expect(computeCompleteness({ aum_13f_portfolio: { value: 5e9 } }, [])).toBe(0);
  });
});


// ── Multi-source merge ────────────────────────────────────────────────────────

describe('multi-source best-available-per-dimension', () => {
  it('firm with both 13F and ADV signals gets union; ADV AUM wins; ADV segment wins', () => {
    const signals13F = extractSignals(firm13F());
    const signalsADV = extractSignals(firmADV({
      inferred_segment: 'quant_fund',
      clientTypes: ['pooled_investment_vehicles'],
      advFlags: { hasPrivateFundClients: true },
    }), NAME_SIGNALS);

    // Simulate accumulation: start with 13F, merge ADV on top
    const merged = { ...signals13F };
    for (const [key, entry] of Object.entries(signalsADV)) {
      merged[key] = mergeSignal(merged[key], entry);
    }

    // Both AUM signals are separate keys — both present
    expect(merged.aum_13f_portfolio.value).toBe(5e9);
    expect(merged.aum_adv_regulatory.value).toBe(8e9);

    // ADV segment (high confidence) wins over 13F (low confidence)
    expect(merged.segment_inferred.source).toBe('sec_adv');
    expect(merged.segment_inferred.confidence).toBe('high');

    // ADV-only signals are present
    expect(merged.has_private_fund_clients.value).toBe(true);
    expect(merged.client_types).toBeDefined();

    // 13F-only signals preserved
    expect(merged.turnover_pct).toBeDefined();
    expect(merged.equities_pct).toBeDefined();
    expect(merged.position_count).toBeDefined();

    // Canonical: ADV AUM wins
    const aumResult = deriveAumCanonical(merged);
    expect(aumResult.value).toBe(8e9);
    expect(aumResult.basis).toBe('adv_regulatory');

    // Signal completeness is higher than either source alone
    const c13F = computeCompleteness(signals13F, SIGNAL_DEFS);
    const cMerged = computeCompleteness(merged, SIGNAL_DEFS);
    expect(cMerged).toBeGreaterThan(c13F);
  });

  it('13F-only firm: canonical uses 13F AUM with correct basis', () => {
    const merged = extractSignals(firm13F());
    const aum = deriveAumCanonical(merged);
    expect(aum.basis).toBe('13f_portfolio');
    expect(aum.source).toBe('sec_13f');
    expect(aum.as_of).toBe('2024-03-31');
  });
});


// ── Provenance tuple shape ────────────────────────────────────────────────────

describe('provenance tuple shape', () => {
  it('every extracted signal has all required provenance fields', () => {
    const required = ['value', 'basis', 'source', 'as_of', 'confidence'];
    for (const signals of [extractSignals(firm13F()), extractSignals(firmADV())]) {
      for (const [key, entry] of Object.entries(signals)) {
        for (const field of required) {
          expect(entry, `${key}.${field}`).toHaveProperty(field);
        }
      }
    }
  });
});


// ── MK Capital style null-AUM private-fund firm ───────────────────────────────

describe('MK Capital style — null regulatory AUM, private fund ADV', () => {
  const mkCapital = firmADV({
    firmName:     'MK Capital Management',
    regulatoryAum: null,                  // private-fund-only: no Item 5.F AUM
    clientTypes:  ['pooled_investment_vehicles'],
    advFlags:     { hasPrivateFundClients: true },
    inferred_segment: 'hedge_fund',
  });

  it('extracts signals without error', () => {
    expect(() => extractSignals(mkCapital)).not.toThrow();
  });

  it('has no aum_adv_regulatory signal (null AUM is not reported)', () => {
    const sigs = extractSignals(mkCapital);
    expect(sigs.aum_adv_regulatory).toBeUndefined();
  });

  it('has_private_fund_clients is present and true', () => {
    const sigs = extractSignals(mkCapital);
    expect(sigs.has_private_fund_clients.value).toBe(true);
  });

  it('aum_canonical is null (no AUM to report)', () => {
    const sigs = extractSignals(mkCapital);
    expect(deriveAumCanonical(sigs).value).toBeNull();
  });

  it('size_tier is null when aum_canonical is null', () => {
    const sigs = extractSignals(mkCapital);
    const { value } = deriveAumCanonical(sigs);
    expect(deriveSizeTier(value, SIZE_BANDS)).toBeNull();
  });

  it('segment_canonical is still derived correctly', () => {
    const sigs = extractSignals(mkCapital);
    const seg = deriveSegmentCanonical(sigs, SEGMENT_MAPPINGS);
    expect(seg.value).toBe('hedge_fund');
    expect(seg.confidence).toBe('high');
  });

  it('signal_completeness is partial but non-zero (has_private_fund + segment)', () => {
    const sigs = extractSignals(mkCapital);
    const completeness = computeCompleteness(sigs, SIGNAL_DEFS);
    expect(completeness).toBeGreaterThan(0);
    expect(completeness).toBeLessThan(1);
  });
});


// ── normalizeFirm (DB integration — mocked supabase) ─────────────────────────

describe('normalizeFirm — DB writes', () => {
  function makeFakeSupabase({ existingNorm = null } = {}) {
    const updates = {};

    const chain = (result) => {
      const b = {
        select: () => b,
        eq:     () => b,
        order:  () => b,
        maybeSingle: () => Promise.resolve({ data: result, error: null }),
        update: (patch) => {
          // capture by table (crude but sufficient for tests)
          Object.assign(updates, patch);
          return b;
        },
        insert: () => Promise.resolve({ data: null, error: null }),
      };
      return b;
    };

    return {
      sb: {
        from: (table) => {
          if (table === 'signal_definitions') return chain(SIGNAL_DEFS);
          if (table === 'taxonomies')          return chain({ id: 'tax-seg-id' });
          if (table === 'taxonomy_mappings')   return chain(SEGMENT_MAPPINGS);
          if (table === 'size_tier_config')    return chain(SIZE_BANDS);
          if (table === 'prospects' || table === 'accounts') {
            const b = chain({ normalized_signals: existingNorm });
            b.update = (patch) => { Object.assign(updates, patch); return b; };
            return b;
          }
          if (table === 'prospect_identifiers') return chain(null);
          return chain(null);
        },
      },
      updates,
    };
  }

  it('writes all canonical fields to prospects table', async () => {
    const { sb, updates } = makeFakeSupabase();
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(ctx, { prospectId: 'p1' }, firm13F(), REFS);

    expect(updates).toHaveProperty('aum_canonical', 5_000_000_000);
    expect(updates).toHaveProperty('aum_basis', '13f_portfolio');
    expect(updates).toHaveProperty('segment_canonical', 'hedge_fund');
    expect(updates).toHaveProperty('size_tier', 'mid');
    expect(updates).toHaveProperty('jurisdiction', 'us');
    expect(updates).toHaveProperty('normalized_at');
    expect(updates.signal_completeness).toBeGreaterThan(0);
    expect(updates.normalized_signals).toBeDefined();
  });

  it('merges with existing normalized_signals on re-run', async () => {
    const existing = {
      turnover_pct: { value: 35, basis: '13f_signals', source: 'sec_13f', as_of: '2023-12-31', confidence: 'medium' },
    };
    const { sb, updates } = makeFakeSupabase({ existingNorm: existing });
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(ctx, { prospectId: 'p1' }, firm13F(), REFS);

    // Both existing and new signals present in merged output
    expect(updates.normalized_signals.turnover_pct).toBeDefined();
    expect(updates.normalized_signals.aum_13f_portfolio).toBeDefined();
  });

  it('recompute:true re-derives a DATED same-source incumbent (the freeze fix, end-to-end)', async () => {
    // Incumbent: live-ingested 'other'/dated. Backfill re-derives 'unknown' with the
    // same filing date — without recompute the dated incumbent would freeze it.
    const existing = {
      segment_inferred: { value: 'other', confidence: 'low', source: 'sec_13f', as_of: '2026-03-31', basis: '13f_name_heuristic' },
    };
    const { sb, updates } = makeFakeSupabase({ existingNorm: existing });
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(
      ctx, { prospectId: 'p1' },
      firm13F({ firmName: 'Navalign LLC', quarters: [{ filing: { periodOfReport: '2026-03-31' } }] }),
      REFS, { recompute: true },
    );
    expect(updates.segment_canonical).toBe('unknown'); // fresh recompute won over dated 'other'
  });

  it('without recompute, a dated incumbent is preserved against an undated re-run (out-of-order guard)', async () => {
    const existing = {
      segment_inferred: { value: 'other', confidence: 'low', source: 'sec_13f', as_of: '2026-03-31', basis: '13f_name_heuristic' },
    };
    const { sb, updates } = makeFakeSupabase({ existingNorm: existing });
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(
      ctx, { prospectId: 'p1' },
      firm13F({ firmName: 'Navalign LLC', quarters: [] }), // undated incoming
      REFS, // no recompute
    );
    expect(updates.segment_canonical).toBe('other'); // dated incumbent preserved
  });

  it('ADV firm: aum_basis is adv_regulatory', async () => {
    const { sb, updates } = makeFakeSupabase();
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(ctx, { prospectId: 'p1' }, firmADV(), REFS);

    expect(updates.aum_basis).toBe('adv_regulatory');
    expect(updates.aum_canonical).toBe(8_000_000_000);
    expect(updates.segment_canonical).toBe('quant_fund');
    expect(updates.segment_confidence).toBe('high');
  });

  it('account_match: writes to accounts table (accountId provided)', async () => {
    const accountUpdates = {};
    const sb = {
      from: (table) => {
        const b = {
          select: () => b, eq: () => b, order: () => b,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          update: (patch) => {
            if (table === 'accounts') Object.assign(accountUpdates, patch);
            return b;
          },
          insert: () => Promise.resolve({ data: null, error: null }),
        };
        if (table === 'signal_definitions') b.maybeSingle = () => Promise.resolve({ data: SIGNAL_DEFS });
        if (table === 'taxonomies')         b.maybeSingle = () => Promise.resolve({ data: { id: 'x' } });
        if (table === 'taxonomy_mappings')  b.maybeSingle = () => Promise.resolve({ data: SEGMENT_MAPPINGS });
        if (table === 'size_tier_config')   b.maybeSingle = () => Promise.resolve({ data: SIZE_BANDS });
        return b;
      },
    };
    const ctx = { supabase: sb, logger: { warn: vi.fn() } };

    await normalizeFirm(ctx, { prospectId: 'p-audit', accountId: 'a1' }, firm13F(), REFS);

    expect(accountUpdates).toHaveProperty('aum_canonical');
    expect(accountUpdates).toHaveProperty('normalized_at');
  });
});


// ── 13F segment heuristic — end-to-end through normalize layer ────────────────

describe('13F segment heuristic — improved token rules', () => {
  // Verify the extractSignals → deriveSegmentCanonical chain for specific firm names.
  // All 13F segment inferences must stay confidence='low'.

  function sigFor(firmName, overrides = {}) {
    return extractSignals(firm13F({ firmName, inferred_segment: inferSegment(firmName), ...overrides }));
  }

  it.each([
    ['Ironwood Wealth Management',    'wealth_manager'],
    ['Capital Partners LP',           'asset_manager'],
    ['Goldman Sachs Asset Management','asset_manager'],
    ['Pacific Advisory Group',        'asset_manager'],
    ['First National Bank',           'bank'],
    ['Hartford Life Insurance',       'insurance'],
    ['Rockefeller Family Office',     'family_office'],
    ['Tiger Hedge Fund LP',           'hedge_fund'],
    ['State Teachers Pension',        'pension'],
    ['Apex Broker Dealer',            'broker_dealer'],
    ['Quantitative Research LLC',     'quant_fund'],
  ])('%s → segment_canonical=%s', (firmName, expectedCanonical) => {
    const sigs = sigFor(firmName);
    const seg = deriveSegmentCanonical(sigs, SEGMENT_MAPPINGS);
    expect(seg.value).toBe(expectedCanonical);
  });

  it('all 13F name-heuristic segments have confidence=low in extracted signals', () => {
    const names = [
      'Ironwood Wealth Management', 'Capital Partners LP', 'First National Bank',
      'Hartford Life Insurance', 'Rockefeller Family Office', 'Tiger Hedge Fund',
      'Sanders Morris Harris', 'General Partners LLC',
    ];
    for (const name of names) {
      const sigs = sigFor(name);
      expect(sigs.segment_inferred?.confidence, name).toBe('low');
    }
  });

  it('Sanders Morris Harris (no reliable token) → unknown (enrichment queue)', () => {
    const sigs = sigFor('Sanders Morris Harris');
    const seg = deriveSegmentCanonical(sigs, SEGMENT_MAPPINGS);
    expect(seg.value).toBe('unknown');
    expect(seg.confidence).toBe('low');
  });

  it('13F name-miss → segment_canonical=unknown (not other), confidence=low', () => {
    const sigs = sigFor('Acme Investments XYZ');
    const seg = deriveSegmentCanonical(sigs, SEGMENT_MAPPINGS);
    // 'unknown' has no ingest_13f mapping → fallback uses raw value → lands in
    // the WHERE segment_canonical='unknown' enrichment predicate.
    expect(seg.value).toBe('unknown');
    expect(seg.confidence).toBe('low');
  });

  it('13F segment confidence stays low even after merge with lower-confidence existing signal', () => {
    // Simulate a prior run stored the same firm with confidence=low
    const existing = {
      segment_inferred: { value: 'hedge_fund', source: 'sec_13f', confidence: 'low', as_of: null, basis: '13f_name_heuristic' },
    };
    const incoming = extractSignals(firm13F({ firmName: 'Ironwood Wealth Management', inferred_segment: 'wealth_manager' }));
    const merged   = { ...existing };
    for (const [k, v] of Object.entries(incoming)) merged[k] = mergeSignal(merged[k], v);

    // New 13F run has same confidence (low) but a different value; recency tiebreak:
    // incoming has as_of='2024-03-31', existing has as_of=null → incoming wins
    const seg = deriveSegmentCanonical(merged, SEGMENT_MAPPINGS);
    expect(seg.value).toBe('wealth_manager');
    expect(seg.confidence).toBe('low');
  });
});
