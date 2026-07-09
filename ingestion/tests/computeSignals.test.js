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
  deriveAdvSegment,
  matchNameSignals,
  computePassesICP,
} from '../src/engine/computeSignals.js';

// Name-signal config fixture — mirrors the seed rows in migration 024
// (segment_name_signals). Passed to deriveAdvSegment so the tests exercise the
// data-driven path exactly as production does.
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
    // Quant / systematic
    ['Quantitative Strategies LP',         'quant_fund'],
    ['Systematic Alpha Fund',              'quant_fund'],
    ['Algorithmic Trading Partners',       'quant_fund'],  // quant wins before prop/partners

    // Prop trading
    ['Proprietary Capital LLC',            'prop_trader'],
    ['XYZ Trading Co',                     'prop_trader'],

    // Wealth management
    ['Ironwood Wealth Management',         'wealth_manager'],
    ['Wealth Strategies Group',            'wealth_manager'],

    // Banking / trust
    ['First National Bank',                'bank'],
    ['Commerce Trust Company',             'bank'],

    // Broker / dealer / securities
    ['XYZ Broker Dealer Securities Corp',  'broker_dealer'],
    ['Atlantic Securities LLC',            'broker_dealer'],

    // Pension / retirement
    ['State Teachers Pension Fund',        'pension'],
    ['University Endowment Foundation',    'pension'],
    ['City Retirement System',             'pension'],

    // Insurance
    ['Hartford Life Insurance Co',         'insurance'],
    ['Zurich Re Assurance',                'insurance'],

    // Family office
    ['Rockefeller Family Office',          'family_office'],
    ['Johnson Family Partners',            'family_office'],  // 'family' wins before 'partners'

    // Explicit hedge fund signal
    ['Tiger Hedge Fund Management',        'hedge_fund'],

    // Advisory / RIA
    ['Mercer Investment Advisors',         'asset_manager'],
    ['Pacific Advisory Group',             'asset_manager'],

    // Named management / capital firms
    ['Goldman Sachs Asset Management',     'asset_manager'],
    ['Fidelity Capital Management',        'asset_manager'],
    ['General Partners LLC',               'asset_manager'],  // 'partners' token
    ['Capital Partners',                   'asset_manager'],  // 'partners' + 'capital'
    ['Blue Ridge Capital',                 'asset_manager'],  // 'capital' token

    // No reliable signal → other (honest fallback, no longer defaults to hedge_fund)
    ['Sanders Morris Harris',              'other'],
    ['Acme Investments',                   'other'],  // 'investments' alone not a signal
    ['',                                   'other'],
    [null,                                 'other'],
  ])('%s → %s', (name, expected) => {
    expect(inferSegment(name)).toBe(expected);
  });

  it('all return values are valid canonical segment keys', () => {
    const VALID = new Set([
      'quant_fund','prop_trader','wealth_manager','bank','broker_dealer',
      'pension','insurance','family_office','hedge_fund','asset_manager','other',
    ]);
    const samples = [
      'Quantitative Research LLC', 'Prop Trading Inc', 'Wealth Group',
      'National Bank', 'Broker Corp', 'Pension Trust', 'Insurance Co',
      'Family Office Ltd', 'Hedge Capital', 'Financial Advisors', 'Unknown',
    ];
    for (const name of samples) {
      expect(VALID, `inferSegment('${name}') not in valid set`).toContain(inferSegment(name));
    }
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

// ── matchNameSignals ──────────────────────────────────────────────────────────

describe('matchNameSignals', () => {
  it('returns [] when no rule matches', () => {
    expect(matchNameSignals('Sanders Morris Harris', NAME_SIGNALS)).toEqual([]);
  });

  it('returns [] for empty config', () => {
    expect(matchNameSignals('Anything Wealth', [])).toEqual([]);
  });

  it('matches a rule case-insensitively', () => {
    const m = matchNameSignals('EVERWEALTH CAPITAL', NAME_SIGNALS);
    expect(m[0].target_segment).toBe('wealth_manager');
  });

  it('sorts strongest-first (confidence desc, then sort_order asc)', () => {
    // "Wealth Trust Bank" matches wealth (medium) + bank (low) → wealth wins
    const m = matchNameSignals('Wealth Trust Bank', NAME_SIGNALS);
    expect(m[0].target_segment).toBe('wealth_manager'); // medium beats low
    expect(m.map(r => r.target_segment)).toContain('bank');
  });

  it('skips inactive and invalid-regex rules', () => {
    const cfg = [
      { pattern: '(', target_segment: 'bank', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'low', sort_order: 1, is_active: true },
      { pattern: 'wealth', target_segment: 'wealth_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'low', sort_order: 2, is_active: false },
      { pattern: 'pension', target_segment: 'pension', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'low', sort_order: 3, is_active: true },
    ];
    const m = matchNameSignals('Wealth Pension Bank', cfg);
    expect(m).toHaveLength(1);                    // invalid '(' skipped, inactive 'wealth' skipped
    expect(m[0].target_segment).toBe('pension');
  });
});

// ── deriveAdvSegment ────────────────────────────────────────────────────────────
//
// Core principle: hedge_fund is EARNED, never defaulted. Anchor cases below map
// to the Part D verification set (Argent/iCapital/KA → unknown, Waterway →
// wealth_manager, Tremont → asset_manager, a dominant-pooled firm → hedge_fund).

describe('deriveAdvSegment — composition with dominance', () => {
  it('dominant pooled vehicles → hedge_fund (EARNED)', () => {
    const r = deriveAdvSegment('Meridian Partners LP', ['pooled_investment_vehicles'], true, NAME_SIGNALS);
    expect(r.value).toBe('hedge_fund');
    expect(r.confidence).toBe('high');
    expect(r.basis).toBe('adv_client_type');
  });

  it('Waterway: HNW + pooled (pooled not dominant) → wealth_manager', () => {
    const r = deriveAdvSegment('Waterway Advisors', ['high_net_worth', 'pooled_investment_vehicles'], false, NAME_SIGNALS);
    expect(r.value).toBe('wealth_manager');
    expect(r.confidence).toBe('high');
  });

  it('HNW / individuals only → wealth_manager (positive retail evidence)', () => {
    const r = deriveAdvSegment('Anytown Advisors', ['high_net_worth', 'individuals'], false, NAME_SIGNALS);
    expect(r.value).toBe('wealth_manager');
  });

  it('Tremont: pension_plans + private-fund flag → asset_manager (control, unchanged)', () => {
    const r = deriveAdvSegment('Tremont Group', ['pension_plans'], true, NAME_SIGNALS);
    expect(r.value).toBe('asset_manager');
    expect(r.confidence).toBe('medium'); // flag conflicts with institutional composition
  });

  it('institutional clients dominate over pooled → asset_manager', () => {
    const r = deriveAdvSegment('Clearbridge Investments', ['pooled_investment_vehicles', 'institutional'], true, NAME_SIGNALS);
    expect(r.value).toBe('asset_manager');
  });

  it('clean institutional-only → asset_manager/high', () => {
    const r = deriveAdvSegment('Institutional Advisors', ['institutional'], false, NAME_SIGNALS);
    expect(r.value).toBe('asset_manager');
    expect(r.confidence).toBe('high');
  });
});

describe('deriveAdvSegment — name veto blocks hedge_fund', () => {
  it('pooled-dominant BUT strong non-HF name → veto redirects to the name target', () => {
    // Composition alone would earn hedge_fund; the "wealth" veto blocks it.
    const r = deriveAdvSegment('Everwealth Capital', ['pooled_investment_vehicles'], true, NAME_SIGNALS);
    expect(r.value).not.toBe('hedge_fund');
    expect(r.value).toBe('wealth_manager');
    expect(r.basis).toBe('adv_name_veto');
  });

  it('pooled-dominant + quant name → refines to quant_fund (not a veto)', () => {
    const r = deriveAdvSegment('Quant Systematic Fund', ['pooled_investment_vehicles'], true, NAME_SIGNALS);
    expect(r.value).toBe('quant_fund');
    expect(r.confidence).toBe('high');
  });
});

describe('deriveAdvSegment — fund_type promotion (anchored, config-driven)', () => {
  // Anchored patterns must NOT match the confirmed false positives.
  it('QUANTECH / QUANTCA (pooled) → hedge_fund, NOT quant_fund', () => {
    expect(deriveAdvSegment('QUANTECH LLC', ['pooled_investment_vehicles'], true, NAME_SIGNALS).value).toBe('hedge_fund');
    expect(deriveAdvSegment('QUANTCA CAPITAL', ['pooled_investment_vehicles'], true, NAME_SIGNALS).value).toBe('hedge_fund');
  });
  it('PROPERTY / PROPEL (pooled) → hedge_fund, NOT prop_trading', () => {
    expect(deriveAdvSegment('PROPERTY GROUP LP', ['pooled_investment_vehicles'], true, NAME_SIGNALS).value).toBe('hedge_fund');
    expect(deriveAdvSegment('PROPEL ADVISORS', ['pooled_investment_vehicles'], true, NAME_SIGNALS).value).toBe('hedge_fund');
  });

  // The three cases.
  it('empty clientTypes + systematic name → quant_fund (DIRECT target)', () => {
    const r = deriveAdvSegment('Systematic Alpha', [], false, NAME_SIGNALS);
    expect(r.value).toBe('quant_fund');
    expect(r.basis).toBe('adv_name_signal');
  });
  it('hedge_fund base + systematic → quant_fund (PROMOTION)', () => {
    const r = deriveAdvSegment('Systematic Capital', ['pooled_investment_vehicles'], true, NAME_SIGNALS);
    expect(r.value).toBe('quant_fund');
  });
  it('asset_manager base + quantitative → stays asset_manager + possible_quant_fund FLAG', () => {
    const r = deriveAdvSegment('Quantitative Advisers', ['institutional'], false, NAME_SIGNALS);
    expect(r.value).toBe('asset_manager');
    expect(r.flags).toEqual({ possible_quant_fund: true });
  });
  it('wealth_manager base + fund-type name → stays wealth_manager + flag (never demote)', () => {
    const r = deriveAdvSegment('Systematic Partners', ['high_net_worth'], false, NAME_SIGNALS);
    expect(r.value).toBe('wealth_manager');
    expect(r.flags).toEqual({ possible_quant_fund: true });
  });

  it('config-driven: adding asset_manager to promote_from promotes an asset_manager base', () => {
    const cfg = NAME_SIGNALS.map(r =>
      r.target_segment === 'quant_fund' ? { ...r, promote_from: ['hedge_fund', 'asset_manager'] } : r);
    expect(deriveAdvSegment('Quant Advisers', ['institutional'], false, NAME_SIGNALS).value).toBe('asset_manager'); // default
    expect(deriveAdvSegment('Quant Advisers', ['institutional'], false, cfg).value).toBe('quant_fund');             // promoted
  });
});

describe('deriveAdvSegment — empty clientTypes (unknown unless earned)', () => {
  it('flag-only + neutral name → unknown (the generic "was hedge_fund" case)', () => {
    const r = deriveAdvSegment('Bedrock Group LLC', [], true, NAME_SIGNALS);
    expect(r.value).toBe('unknown');
    expect(r.confidence).toBe('low');
    expect(r.basis).toBe('adv_flag_only');
  });

  it('Argent Retirement Plan Advisors → wealth_manager/low (retirement name rule; anchor)', () => {
    // Real firm: 'ARGENT RETIREMENT PLAN ADVISORS, LLC', flag-only, empty clientTypes.
    // The kept retirement→wealth_manager name rule classifies it (a legitimate
    // positive classification, NOT a hedge_fund guess). Anchor: wealth_manager/low.
    const r = deriveAdvSegment('ARGENT RETIREMENT PLAN ADVISORS, LLC', [], true, NAME_SIGNALS);
    expect(r.value).toBe('wealth_manager');
    expect(r.confidence).toBe('low');
    expect(r.basis).toBe('adv_name_signal');
  });

  it('iCapital: flag-only + neutral name (generic "capital") → unknown', () => {
    const r = deriveAdvSegment('iCapital Advisors LLC', [], true, NAME_SIGNALS);
    expect(r.value).toBe('unknown');
  });

  it('KA Credit: flag-only, "credit" is NOT a segment signal → unknown', () => {
    const r = deriveAdvSegment('KA Credit Advisors LLC', [], true, NAME_SIGNALS);
    expect(r.value).toBe('unknown');
  });

  it('flag-only is NOT enough for hedge_fund even with pooled flag set', () => {
    const r = deriveAdvSegment('Opaque Holdings LLC', [], true, NAME_SIGNALS);
    expect(r.value).toBe('unknown');
  });

  it('strong name signal (no client data) → that segment at rule confidence', () => {
    const r = deriveAdvSegment('Granite Wealth Management', [], false, NAME_SIGNALS);
    expect(r.value).toBe('wealth_manager');
    expect(r.confidence).toBe('medium');
    expect(r.basis).toBe('adv_name_signal');
  });

  it('fund-corroborating name (no client data) → hedge_fund/medium (earned by name)', () => {
    const r = deriveAdvSegment('Tiger Hedge Master Fund', [], true, NAME_SIGNALS);
    expect(r.value).toBe('hedge_fund');
    expect(r.confidence).toBe('medium');
  });

  it('neutral name + no flag → unknown/low', () => {
    const r = deriveAdvSegment('Sanders Morris Harris', [], false, NAME_SIGNALS);
    expect(r.value).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});

describe('deriveAdvSegment — config-driven (changing a config row changes behavior)', () => {
  it('with no config, a strong-name firm falls back to unknown; with config it classifies', () => {
    const withoutCfg = deriveAdvSegment('Granite Wealth Management', [], false, []);
    expect(withoutCfg.value).toBe('unknown');

    const withCfg = deriveAdvSegment('Granite Wealth Management', [], false, NAME_SIGNALS);
    expect(withCfg.value).toBe('wealth_manager');
  });

  it('adding a credit rule would route "credit" firms — proving table-driven behavior', () => {
    const creditCfg = [
      ...NAME_SIGNALS,
      { pattern: 'credit', target_segment: 'asset_manager', signal_kind: 'name_signal', vetoes_hedge_fund: true, confidence: 'low', sort_order: 12, is_active: true },
    ];
    // Default config: 'KA Credit' is unknown (no credit rule)
    expect(deriveAdvSegment('KA Credit Advisors', [], true, NAME_SIGNALS).value).toBe('unknown');
    // With a credit rule added to the table: same firm now routes to asset_manager
    expect(deriveAdvSegment('KA Credit Advisors', [], true, creditCfg).value).toBe('asset_manager');
  });
});
