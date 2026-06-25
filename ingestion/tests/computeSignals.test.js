/**
 * Unit tests for engine/computeSignals.js
 *
 * All exports are pure functions — no mocking, no network.
 *
 * NOTE on computePassesICP + private-fund bug:
 *   Private-fund-only ADV advisers have estimated_aum_usd = 0 (regulatoryAum ?? 0).
 *   Without a special case, a min_aum_usd ICP threshold would reject them even
 *   though their AUM is legitimately unreported (not actually zero). The fix adds
 *   advFlags.hasPrivateFundClients bypass to the AUM threshold check.
 *   See the failing test below and the corresponding fix in computeSignals.js.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateAUM,
  computeTurnover,
  assetMix,
  inferSegment,
  computePassesICP,
} from '../src/engine/computeSignals.js';

// ── estimateAUM ───────────────────────────────────────────────────────────────

describe('estimateAUM', () => {
  it('returns 0 for empty holdings', () => {
    expect(estimateAUM([])).toBe(0);
    expect(estimateAUM(null)).toBe(0);
    expect(estimateAUM(undefined)).toBe(0);
  });

  it('sums valueUsd across all holdings', () => {
    const holdings = [
      { cusip: 'A', valueUsd: 1_000_000 },
      { cusip: 'B', valueUsd: 2_500_000 },
      { cusip: 'C', valueUsd: 500_000  },
    ];
    expect(estimateAUM(holdings)).toBe(4_000_000);
  });

  it('treats missing valueUsd as 0', () => {
    expect(estimateAUM([{ cusip: 'X' }, { cusip: 'Y', valueUsd: 100 }])).toBe(100);
  });
});

// ── computeTurnover ───────────────────────────────────────────────────────────

describe('computeTurnover', () => {
  const q1 = [
    { cusip: 'AAPL', valueUsd: 1_000_000 },
    { cusip: 'MSFT', valueUsd: 1_000_000 },
  ];

  it('returns null if either quarter is empty', () => {
    expect(computeTurnover(q1,  [])).toBeNull();
    expect(computeTurnover([],  q1)).toBeNull();
    expect(computeTurnover(null, q1)).toBeNull();
  });

  it('returns 0% for identical portfolios (no change)', () => {
    expect(computeTurnover(q1, q1)).toBe(0);
  });

  it('returns 100% when portfolio is completely replaced', () => {
    const q2 = [
      { cusip: 'GOOG', valueUsd: 1_000_000 },
      { cusip: 'AMZN', valueUsd: 1_000_000 },
    ];
    // totalChange = 1M+1M (sold AAPL/MSFT) + 1M+1M (bought GOOG/AMZN) = 4M
    // avgPortfolio = (2M + 2M) / 2 = 2M
    // turnover = 4M / 2M * 100 = 200%, capped at 100
    expect(computeTurnover(q2, q1)).toBe(100);
  });

  it('computes partial turnover correctly', () => {
    // AAPL unchanged, MSFT: was 1M now 500K (change = 500K)
    const q2 = [
      { cusip: 'AAPL', valueUsd: 1_000_000 },
      { cusip: 'MSFT', valueUsd:   500_000 },
    ];
    // totalChange = 500K
    // avgPortfolio = (1.5M + 2M) / 2 = 1.75M
    // turnover = 500K / 1.75M * 100 ≈ 28.57%
    const t = computeTurnover(q2, q1);
    expect(t).toBeCloseTo(28.57, 1);
  });

  it('is capped at 100%', () => {
    // Extreme: add 10x new positions
    const cur = Array.from({ length: 10 }, (_, i) => ({ cusip: `N${i}`, valueUsd: 1_000_000 }));
    const t   = computeTurnover(cur, q1);
    expect(t).toBe(100);
  });
});

// ── assetMix ──────────────────────────────────────────────────────────────────

describe('assetMix', () => {
  it('returns zeros for empty holdings', () => {
    expect(assetMix([])).toEqual({ equitiesPct: 0, optionsPresent: false });
    expect(assetMix(null)).toEqual({ equitiesPct: 0, optionsPresent: false });
  });

  it('100% equities when no options', () => {
    const h = [
      { valueUsd: 1000, putCall: null,  titleOfClass: 'COM' },
      { valueUsd: 2000, putCall: null,  titleOfClass: 'COM' },
    ];
    const { equitiesPct, optionsPresent } = assetMix(h);
    expect(equitiesPct).toBe(100);
    expect(optionsPresent).toBe(false);
  });

  it('detects Put via putCall field and excludes from equitiesPct', () => {
    const h = [
      { valueUsd: 900,  putCall: null,  titleOfClass: 'COM' },
      { valueUsd: 100,  putCall: 'Put', titleOfClass: 'PUT' },
    ];
    const { equitiesPct, optionsPresent } = assetMix(h);
    expect(optionsPresent).toBe(true);
    expect(equitiesPct).toBe(90);
  });

  it('detects Call via putCall field', () => {
    const h = [{ valueUsd: 500, putCall: 'Call', titleOfClass: 'COM' }];
    expect(assetMix(h).optionsPresent).toBe(true);
  });

  it('detects options via titleOfClass keyword when putCall is absent', () => {
    const h = [
      { valueUsd: 800, putCall: null, titleOfClass: 'COM' },
      { valueUsd: 200, putCall: null, titleOfClass: 'PUT OPTION' },
    ];
    const { optionsPresent, equitiesPct } = assetMix(h);
    expect(optionsPresent).toBe(true);
    expect(equitiesPct).toBe(80);
  });
});

// ── inferSegment ──────────────────────────────────────────────────────────────

describe('inferSegment', () => {
  it.each([
    ['Quantitative Strategies LP',         'quant_fund'],
    ['Systematic Alpha Fund',              'quant_fund'],
    ['Algorithmic Trading Partners',       'quant_fund'],
    ['State Teachers Pension Fund',        'pension'],
    ['University Endowment Foundation',    'pension'],
    ['Proprietary Capital LLC',            'prop_trader'],
    ['XYZ Broker Dealer Securities Corp',  'broker_dealer'],
    ['General Partners LLC',               'hedge_fund'],   // default
    ['',                                   'hedge_fund'],
    [null,                                 'hedge_fund'],
  ])('%s → %s', (name, expected) => {
    expect(inferSegment(name)).toBe(expected);
  });
});

// ── computePassesICP ──────────────────────────────────────────────────────────

describe('computePassesICP', () => {
  const STRONG_PROSPECT = {
    estimated_aum_usd:     2_000_000_000,
    portfolio_turnover_pct: 60,
    position_count:         150,
    inferred_segment:       'hedge_fund',
  };

  const ICP = {
    min_aum_usd:        100_000_000,
    min_turnover_pct:   20,
    min_position_count: 50,
    excluded_segments:  ['pension', 'broker_dealer'],
  };

  it('null icpConfig → always passes (open ICP)', () => {
    expect(computePassesICP({}, null)).toBe(true);
    expect(computePassesICP({}, undefined)).toBe(true);
  });

  it('strong prospect passes all ICP thresholds', () => {
    expect(computePassesICP(STRONG_PROSPECT, ICP)).toBe(true);
  });

  it('fails when AUM is below minimum', () => {
    expect(computePassesICP({ ...STRONG_PROSPECT, estimated_aum_usd: 50_000_000 }, ICP)).toBe(false);
  });

  it('fails when turnover is below minimum', () => {
    expect(computePassesICP({ ...STRONG_PROSPECT, portfolio_turnover_pct: 10 }, ICP)).toBe(false);
  });

  it('fails when position count is below minimum', () => {
    expect(computePassesICP({ ...STRONG_PROSPECT, position_count: 5 }, ICP)).toBe(false);
  });

  it('fails when segment is excluded', () => {
    expect(computePassesICP({ ...STRONG_PROSPECT, inferred_segment: 'pension' }, ICP)).toBe(false);
    expect(computePassesICP({ ...STRONG_PROSPECT, inferred_segment: 'broker_dealer' }, ICP)).toBe(false);
  });

  it('null AUM and turnover coerce to 0 (not undefined)', () => {
    const nullSignal = { estimated_aum_usd: null, portfolio_turnover_pct: null, position_count: null };
    // With min_aum=100M: 0 < 100M → fails
    expect(computePassesICP(nullSignal, { min_aum_usd: 100_000_000 })).toBe(false);
  });

  it('private-fund-only ADV firm with null AUM passes ICP despite min_aum threshold', () => {
    // MK Capital pattern: estimated_aum_usd = 0 (regulatoryAum ?? 0),
    // but advFlags.hasPrivateFundClients = true.
    // These firms legitimately don't report SMA AUM — a Citadel-scale private fund
    // adviser could appear here. They should bypass the AUM ICP filter.
    const mkCapital = {
      estimated_aum_usd:     0,   // normalized from null regulatoryAum
      portfolio_turnover_pct: null,
      position_count:         0,
      inferred_segment:       'hedge_fund',
      advFlags:               { hasPrivateFundClients: true },
    };
    expect(computePassesICP(mkCapital, { min_aum_usd: 100_000_000 })).toBe(true);
  });
});
