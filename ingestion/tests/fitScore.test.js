/**
 * Unit tests for engine/fitScore.js — computeFitScore
 *
 * Mocks supabase so loadWeights() fails and falls back to hardcoded defaults:
 *   aum_tier 20, portfolio_turnover 25, equity_concentration 15,
 *   options_present 15, position_count 5, filer_type 10,
 *   client_type_fit 5, private_fund_adviser 5  →  total 100
 */

import { describe, it, expect, vi } from 'vitest';

// Hoisted mocks — must be before any dynamic imports
vi.mock('../src/supabaseClient.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'test mock' } }),
        }),
      }),
    }),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { computeFitScore } = await import('../src/engine/fitScore.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal prospect with sensible defaults for fields not under test. */
function prospect(overrides = {}) {
  return {
    estimated_aum_usd:      0,
    portfolio_turnover_pct: null,
    equities_pct:           0,
    options_present:        false,
    position_count:         0,
    inferred_segment:       'hedge_fund',
    clientTypes:            [],
    advFlags:               undefined,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeFitScore', () => {
  it('scores a high-fit 13F prospect near the top', async () => {
    const { score, breakdown } = await computeFitScore(prospect({
      estimated_aum_usd:      2_000_000_000,  // $2B → aumRatio 1.0 → 20 pts
      portfolio_turnover_pct: 75,             // ≥50 → 1.0 → 25 pts
      equities_pct:           90,             // ≥70 → 1.0 → 15 pts
      options_present:        true,           //        1.0 → 15 pts
      position_count:         200,            // ≥100 → 1.0 → 5 pts
      inferred_segment:       'hedge_fund',   //        1.0 → 10 pts
      // no clientTypes/advFlags → 0 on ADV-specific criteria
    }));
    // 20 + 25 + 15 + 15 + 5 + 10 + 0 + 0 = 90
    expect(score).toBe(90);
    expect(breakdown.aum_tier.points).toBe(20);
    expect(breakdown.portfolio_turnover.points).toBe(25);
    expect(breakdown.equity_concentration.points).toBe(15);
    expect(breakdown.options_present.points).toBe(15);
    expect(breakdown.position_count.points).toBe(5);
    expect(breakdown.filer_type.points).toBe(10);
    expect(breakdown.client_type_fit.points).toBe(0);
    expect(breakdown.private_fund_adviser.points).toBe(0);
  });

  it('scores a low-fit prospect near the bottom', async () => {
    const { score } = await computeFitScore(prospect({
      estimated_aum_usd:      5_000_000,    // <$100M → 0.25 → 5
      portfolio_turnover_pct: 5,            // <25 → 0.25 → 6
      equities_pct:           10,           // <40 → 0.25 → 4
      options_present:        false,        //         0 → 0
      position_count:         5,            // <50 → 0.25 → 1
      inferred_segment:       'broker_dealer', // 0.5 → 5
    }));
    // 5 + 6 + 4 + 0 + 1 + 5 + 0 + 0 = 21
    expect(score).toBe(21);
    expect(score).toBeLessThan(30);
  });

  it('ADV prospect with pooled vehicles + private fund scores client-type criteria', async () => {
    const { score, breakdown } = await computeFitScore(prospect({
      estimated_aum_usd:      2_000_000_000,
      portfolio_turnover_pct: null,           // unknown → 0.5 → 13
      equities_pct:           0,              // ADV has no position data → 4
      position_count:         0,              // ADV → 1
      inferred_segment:       'hedge_fund',   // 10
      clientTypes:            ['pooled_investment_vehicles', 'high_net_worth'],
      advFlags:               { hasPrivateFundClients: true },
    }));
    // 20 + 13 + 4 + 0 + 1 + 10 + 5 + 5 = 58
    expect(score).toBe(58);
    expect(breakdown.client_type_fit.points).toBe(5);       // pooled → full
    expect(breakdown.private_fund_adviser.points).toBe(5);  // hasPrivFund → full
  });

  it('ADV with HNW-only clients scores client_type_fit at 0.5', async () => {
    const { breakdown } = await computeFitScore(prospect({
      clientTypes: ['high_net_worth', 'individuals'],
      advFlags:    { hasPrivateFundClients: false },
    }));
    expect(breakdown.client_type_fit.ratio).toBe(0.5);
    expect(breakdown.private_fund_adviser.points).toBe(0);
  });

  it('13F prospect (no clientTypes) scores 0 on ADV criteria without error', async () => {
    // Confirms graceful-missing-signal behavior: undefined clientTypes → []
    const { score, breakdown } = await computeFitScore(prospect({
      estimated_aum_usd:      500_000_000,
      portfolio_turnover_pct: 30,
      equities_pct:           80,
      position_count:         80,
      inferred_segment:       'pension',
      clientTypes:            undefined,   // not set on 13F prospects
      advFlags:               undefined,
    }));
    // 20 + 13 + 15 + 0 + Math.round(5*0.5=2.5)=3 + Math.round(10*0.25=2.5)=3 + 0 + 0 = 54
    expect(breakdown.client_type_fit.points).toBe(0);
    expect(breakdown.private_fund_adviser.points).toBe(0);
    expect(score).toBe(54);
    // No throw — missing ADV fields are handled gracefully
  });

  it('MK Capital edge case: null AUM + private fund flag produces valid score', async () => {
    // estimated_aum_usd = 0 (regulatoryAum ?? 0 in normalize), advFlags present
    const { score, breakdown } = await computeFitScore(prospect({
      estimated_aum_usd:      0,    // normalized from null regulatoryAum
      portfolio_turnover_pct: null,
      equities_pct:           0,
      position_count:         0,
      inferred_segment:       'hedge_fund',
      clientTypes:            [],
      advFlags:               { hasPrivateFundClients: true },
    }));
    // aum=0→0.25→5, trn=null→0.5→13, eq=0→0.25→4, opt=0, cnt=0→0.25→1,
    // seg=hedge→10, ct=0, pf=1.0→5   = 38
    expect(breakdown.aum_tier.points).toBe(5);
    expect(breakdown.private_fund_adviser.points).toBe(5);
    expect(score).toBe(38);
    expect(typeof score).toBe('number');
    expect(isNaN(score)).toBe(false);
  });

  it('null/undefined signals never throw and produce a numeric score', async () => {
    const { score } = await computeFitScore({});
    expect(typeof score).toBe('number');
    expect(isNaN(score)).toBe(false);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('score is capped at 100', async () => {
    // All ratios at 1.0 = exactly 100 (weights sum to 100)
    const { score } = await computeFitScore(prospect({
      estimated_aum_usd:      1_000_000_000,
      portfolio_turnover_pct: 75,
      equities_pct:           90,
      options_present:        true,
      position_count:         200,
      inferred_segment:       'hedge_fund',
      clientTypes:            ['pooled_investment_vehicles'],
      advFlags:               { hasPrivateFundClients: true },
    }));
    // 20+25+15+15+5+10+5+5 = 100
    expect(score).toBe(100);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('breakdown keys match all eight scoring criteria', async () => {
    const { breakdown } = await computeFitScore(prospect());
    const keys = Object.keys(breakdown).sort();
    expect(keys).toEqual([
      'aum_tier', 'client_type_fit', 'equity_concentration',
      'filer_type', 'options_present', 'portfolio_turnover',
      'position_count', 'private_fund_adviser',
    ].sort());
  });
});
