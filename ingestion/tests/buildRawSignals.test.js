import { describe, it, expect } from 'vitest';
import { buildRawSignals, STRUCTURAL_KEYS } from '../src/engine/runConnector.js';

// Minimal structural shell shared by both connectors
const STRUCT = {
  firmName:         'Test Co',
  source:           'sec_13f',
  source_url:       'https://example.com',
  cik:              '0001234567',
  crdNumber:        null,
  secNumber:        null,
  quarters:         [],
  inferred_segment: 'hedge_fund',
};

// ── STRUCTURAL_KEYS contract ──────────────────────────────────────────────────

describe('STRUCTURAL_KEYS', () => {
  it('contains all identity/structural field names', () => {
    const expected = [
      'firmName', 'source', 'source_url', 'cik', 'crdNumber',
      'secNumber', 'quarters', 'inferred_segment',
    ];
    for (const key of expected) {
      expect(STRUCTURAL_KEYS.has(key), `expected '${key}' in STRUCTURAL_KEYS`).toBe(true);
    }
  });
});

// ── buildRawSignals ───────────────────────────────────────────────────────────

describe('buildRawSignals', () => {
  it('excludes every structural key from the output', () => {
    const signal = { ...STRUCT, estimated_aum_usd: 1e9 };
    const raw = buildRawSignals(signal);
    for (const key of STRUCTURAL_KEYS) {
      expect(raw, `'${key}' should not appear in rawSignals`).not.toHaveProperty(key);
    }
  });

  it('adds computed_at to every output', () => {
    const raw = buildRawSignals({ ...STRUCT, estimated_aum_usd: 0 });
    expect(raw).toHaveProperty('computed_at');
    expect(new Date(raw.computed_at).getTime()).not.toBeNaN();
  });

  it('13F signal: stored shape is unchanged — only numeric signals + computed_at', () => {
    const signal = {
      ...STRUCT,
      estimated_aum_usd:      5_000_000_000,
      position_count:         120,
      portfolio_turnover_pct: 42.5,
      equities_pct:           87.3,
      options_present:        true,
    };
    const raw = buildRawSignals(signal);
    expect(raw).toMatchObject({
      estimated_aum_usd:      5_000_000_000,
      position_count:         120,
      portfolio_turnover_pct: 42.5,
      equities_pct:           87.3,
      options_present:        true,
    });
    // No ADV-specific fields
    expect(raw).not.toHaveProperty('regulatoryAum');
    expect(raw).not.toHaveProperty('clientTypes');
    expect(raw).not.toHaveProperty('advFlags');
  });

  it('ADV signal: clientTypes, advFlags, regulatoryAum are persisted', () => {
    const signal = {
      ...STRUCT,
      source:           'sec_adv',
      cik:              null,
      crdNumber:        '123456',
      estimated_aum_usd: 2_228_148_061,
      position_count:    0,
      portfolio_turnover_pct: null,
      equities_pct:      0,
      options_present:   false,
      regulatoryAum:     2_228_148_061,
      clientTypes:       ['pooled_investment_vehicles', 'high_net_worth'],
      advFlags:          { hasPrivateFundClients: true },
    };
    const raw = buildRawSignals(signal);
    expect(raw.regulatoryAum).toBe(2_228_148_061);
    expect(raw.clientTypes).toEqual(['pooled_investment_vehicles', 'high_net_worth']);
    expect(raw.advFlags).toEqual({ hasPrivateFundClients: true });
    // Shared numeric fields still present
    expect(raw.estimated_aum_usd).toBe(2_228_148_061);
    expect(raw.position_count).toBe(0);
  });

  it('ADV private-fund-only: regulatoryAum null is persisted (not coerced away)', () => {
    const signal = {
      ...STRUCT,
      source:        'sec_adv',
      crdNumber:     '999',
      estimated_aum_usd: 0,
      regulatoryAum: null,  // legitimately not reported
      clientTypes:   ['pooled_investment_vehicles'],
      advFlags:      { hasPrivateFundClients: true },
    };
    const raw = buildRawSignals(signal);
    expect(raw).toHaveProperty('regulatoryAum', null);
  });

  it('future connector: arbitrary new signal field auto-persists without editing runConnector.js', () => {
    const signal = {
      ...STRUCT,
      source:         'enrichment_v2',
      // Hypothetical new signal fields a future connector might emit
      esg_score:      78.5,
      global_aum_usd: 5e10,
      strategies:     ['long_short', 'global_macro'],
    };
    const raw = buildRawSignals(signal);
    expect(raw.esg_score).toBe(78.5);
    expect(raw.global_aum_usd).toBe(5e10);
    expect(raw.strategies).toEqual(['long_short', 'global_macro']);
    // Structural fields still excluded
    expect(raw).not.toHaveProperty('firmName');
    expect(raw).not.toHaveProperty('source');
    expect(raw).not.toHaveProperty('quarters');
  });
});
