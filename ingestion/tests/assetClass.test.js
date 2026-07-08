/**
 * Unit tests for engine/assetClass.js — all pure functions, config-driven,
 * no DB. Fixtures mirror the migration 026 seed.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyHolding,
  computeBreakdown,
  isNonServedDominant,
  deriveRelevanceVerdict,
  matchAdvNameFlags,
  deriveAdvRelevance,
  computePossibleHft,
  verdictAction,
  positionChurn,
  computeActivityMetrics,
} from '../src/engine/assetClass.js';

// ── Config fixtures (mirror 026 seed) ─────────────────────────────────────────
const PATTERNS = [
  { pattern: 'SPON\\w*\\s+AD[RS]|\\bAD[RS]\\b|REGISTRY\\s+SH', bucket: 'adr',       pattern_kind: 'class_title', sort_order: 10, is_active: true },
  { pattern: '\\bNOTE\\b|\\bBOND\\b|\\bDEB\\b|DEBENTURE|\\bMTN\\b', bucket: 'debt',  pattern_kind: 'class_title', sort_order: 20, is_active: true },
  { pattern: '\\bETF\\b|TR\\s+UNIT|TRUST\\s+UNIT|UNIT\\s+INV',     bucket: 'etf_trust', pattern_kind: 'class_title', sort_order: 30, is_active: true },
  { pattern: '\\bSPDR\\b|ISHARES|VANGUARD|GOLD\\s+MINERS|RUSSELL\\s+\\d+|\\bETF\\b', bucket: 'etf_trust', pattern_kind: 'etf_name', sort_order: 40, is_active: true },
  { pattern: '\\bCOM\\b|COMMON|\\bSHS?\\b|SHARES?|\\bSTOCK\\b|\\bSTK\\b|ORD(INARY)?|\\bCL\\s+[A-Z]\\b|CLASS\\s+[A-Z]|\\bREIT\\b', bucket: 'equity', pattern_kind: 'class_title', sort_order: 50, is_active: true },
];
const SERVED = [
  { bucket_key: 'equity', served: true }, { bucket_key: 'option', served: true },
  { bucket_key: 'adr', served: true },    { bucket_key: 'etf_trust', served: true },
  { bucket_key: 'debt', served: false },  { bucket_key: 'other', served: true },
];
const ADV_FLAGS = [
  { pattern: 'realty|real\\s+estate', implied_class: 'real_estate', verdict: 'suspect', confidence: 'low', sort_order: 1, is_active: true },
  { pattern: 'credit',                implied_class: 'credit',      verdict: 'suspect', confidence: 'low', sort_order: 3, is_active: true },
];
const CONFIG = {
  gate_on_absence: false, min_holdings: 10, min_served_value: null,
  no_signal_adv_default: 'likely_relevant',
  relevant_min_fraction: 0.80, likely_min_fraction: 0.50, irrelevant_max_fraction: 0.20,
  suspect_penalty: 15, possible_hft_min_aum: 1_000_000_000,
};
const VERDICT_ACTIONS = [
  { verdict: 'relevant', action: 'pass' }, { verdict: 'likely_relevant', action: 'pass' },
  { verdict: 'unknown', action: 'pass' },  { verdict: 'suspect', action: 'penalize' },
  { verdict: 'irrelevant', action: 'gate' },
];
const h = (o) => ({ class_title: null, put_call: null, issuer_name: null, value_usd: 100, ...o });

// ── classifier ────────────────────────────────────────────────────────────────
describe('classifyHolding', () => {
  it('put_call → option FIRST, even with an equity-like class_title', () => {
    expect(classifyHolding(h({ class_title: 'COM', put_call: 'Put' }), PATTERNS)).toBe('option');
    expect(classifyHolding(h({ class_title: 'SPONSORED ADS', put_call: 'Call' }), PATTERNS)).toBe('option');
  });
  it('COM → equity', () => expect(classifyHolding(h({ class_title: 'COM' }), PATTERNS)).toBe('equity'));
  it('STOCK / CL A → equity', () => {
    expect(classifyHolding(h({ class_title: 'STOCK' }), PATTERNS)).toBe('equity');
    expect(classifyHolding(h({ class_title: 'CL A' }), PATTERNS)).toBe('equity');
  });
  it('NOTE x% → debt (before equity)', () => expect(classifyHolding(h({ class_title: 'NOTE 4.375% 6/0' }), PATTERNS)).toBe('debt'));
  it('SPONSORED ADS → adr (before equity SHS)', () => expect(classifyHolding(h({ class_title: 'SPONSORED ADS' }), PATTERNS)).toBe('adr'));
  it('TR UNIT → etf_trust', () => expect(classifyHolding(h({ class_title: 'TR UNIT' }), PATTERNS)).toBe('etf_trust'));
  it('ETF name-assist: issuer SPDR with generic title → etf_trust (before equity)', () => {
    expect(classifyHolding(h({ class_title: 'COM', issuer_name: 'SPDR S&P 500 ETF TR' }), PATTERNS)).toBe('etf_trust');
  });
  it('unmatched → other', () => expect(classifyHolding(h({ class_title: 'ZZZ WIDGET' }), PATTERNS)).toBe('other'));
});

// ── breakdown / served_fraction ───────────────────────────────────────────────
describe('computeBreakdown', () => {
  it('served_fraction = served value ÷ total; unmatched other counts as served', () => {
    const bd = computeBreakdown([
      h({ class_title: 'COM', value_usd: 70 }),
      h({ class_title: 'ZZZ', value_usd: 10 }),   // other → served
      h({ class_title: 'NOTE 5% 1/1', value_usd: 20 }), // debt → not served
    ], PATTERNS, SERVED);
    expect(bd.total_value).toBe(100);
    expect(bd.served_fraction).toBeCloseTo(0.80, 5); // (70 equity + 10 other) / 100
    expect(bd.detected_asset_classes.sort()).toEqual(['debt', 'equity', 'other']);
  });
  it('empty book → served_fraction NULL (0÷0), not 0 — protects absence path', () => {
    const bd = computeBreakdown([], PATTERNS, SERVED);
    expect(bd.served_fraction).toBeNull();
    expect(bd.total_value).toBe(0);
  });
  it('config-driven: flipping debt→served changes served_fraction', () => {
    const holds = [h({ class_title: 'COM', value_usd: 20 }), h({ class_title: 'NOTE 5% 1/1', value_usd: 80 })];
    expect(computeBreakdown(holds, PATTERNS, SERVED).served_fraction).toBeCloseTo(0.20, 5);
    const servedDebt = SERVED.map(s => s.bucket_key === 'debt' ? { ...s, served: true } : s);
    expect(computeBreakdown(holds, PATTERNS, servedDebt).served_fraction).toBeCloseTo(1.0, 5);
  });
});

describe('isNonServedDominant', () => {
  const set = new Set(['equity', 'option', 'adr', 'etf_trust', 'other']);
  it('debt largest → true', () => expect(isNonServedDominant({ debt: 80, equity: 20 }, set)).toBe(true));
  it('equity largest → false', () => expect(isNonServedDominant({ equity: 80, debt: 20 }, set)).toBe(false));
  it('empty → false', () => expect(isNonServedDominant({}, set)).toBe(false));
});

// ── verdict + ABSENCE ROUTING ─────────────────────────────────────────────────
describe('deriveRelevanceVerdict — bands', () => {
  const bd = (holds) => { const b = computeBreakdown(holds, PATTERNS, SERVED); return { ...b, holdingCount: holds.length, config: CONFIG }; };
  const many = (title, n, val) => Array.from({ length: n }, () => h({ class_title: title, value_usd: val }));

  it('high served → relevant/high', () => {
    const v = deriveRelevanceVerdict(bd(many('COM', 15, 100)));
    expect(v.verdict).toBe('relevant'); expect(v.confidence).toBe('high');
  });
  it('moderate served (0.60) → likely_relevant', () => {
    const holds = [...many('COM', 12, 50), ...many('NOTE 5% 1/1', 8, 50)]; // 600/1000 served = 0.60
    expect(deriveRelevanceVerdict(bd(holds)).verdict).toBe('likely_relevant');
  });
  it('served ≤ irrelevant_max AND debt dominant → irrelevant', () => {
    const holds = [...many('COM', 12, 10), ...many('NOTE 5% 1/1', 8, 110)]; // 120/1000 = 0.12, debt dominant
    const v = deriveRelevanceVerdict(bd(holds));
    expect(v.verdict).toBe('irrelevant'); expect(v.reason).toBe('non_served_dominant');
  });
  it('low served (0.35) but ABOVE irrelevant_max → suspect, NOT irrelevant', () => {
    const holds = [...many('COM', 12, 35), ...many('NOTE 5% 1/1', 8, ((65 * 12) / 8))]; // served ~0.35
    expect(deriveRelevanceVerdict(bd(holds)).verdict).toBe('suspect');
  });
  it('config-driven: raising relevant_min flips relevant→likely', () => {
    // 19 equity + 1 debt (each 50) → served 0.95
    const holds = [...many('COM', 19, 50), ...many('NOTE 5% 1/1', 1, 50)];
    expect(deriveRelevanceVerdict(bd(holds)).verdict).toBe('relevant');                       // 0.95 ≥ 0.80
    expect(deriveRelevanceVerdict({ ...bd(holds), config: { ...CONFIG, relevant_min_fraction: 0.99 } }).verdict).toBe('likely_relevant'); // 0.95 < 0.99
  });
});

describe('deriveRelevanceVerdict — ABSENCE ROUTING (never gated)', () => {
  const mk = (holds) => { const b = computeBreakdown(holds, PATTERNS, SERVED); return { ...b, holdingCount: holds.length, config: CONFIG }; };
  it('empty book → unknown (not irrelevant)', () => {
    expect(deriveRelevanceVerdict(mk([])).verdict).toBe('unknown');
  });
  it('3-holding residual book → unknown even at served 1.0 (below min_holdings)', () => {
    const v = deriveRelevanceVerdict(mk(Array.from({ length: 3 }, () => h({ class_title: 'COM', value_usd: 1e6 }))));
    expect(v.verdict).toBe('unknown'); expect(v.reason).toBe('insufficient_holdings');
  });
  it('served_fraction=0-from-no-holdings can NEVER reach the irrelevant band', () => {
    const v = deriveRelevanceVerdict({ served_fraction: null, total_value: 0, holdingCount: 0, byBucket: {}, servedSet: new Set(), config: CONFIG });
    expect(v.verdict).toBe('unknown');
  });
  it('config-driven: lowering min_holdings lets a 3-holding book be evaluated', () => {
    const holds = Array.from({ length: 3 }, () => h({ class_title: 'COM', value_usd: 1e6 }));
    const b = computeBreakdown(holds, PATTERNS, SERVED);
    const v = deriveRelevanceVerdict({ ...b, holdingCount: 3, config: { ...CONFIG, min_holdings: 2 } });
    expect(v.verdict).toBe('relevant');
  });
});

// ── ADV path ──────────────────────────────────────────────────────────────────
describe('deriveAdvRelevance / matchAdvNameFlags', () => {
  it('realty name → suspect (soft, review flag) — NEVER gates', () => {
    const r = deriveAdvRelevance('Blackstone Real Estate Advisors', ADV_FLAGS, CONFIG);
    expect(r.verdict).toBe('suspect'); expect(r.confidence).toBe('low');
    expect(r.flags).toMatchObject({ review: true, adv_name_flag: 'real_estate' });
  });
  it('no name signal → no_signal_adv_default (likely_relevant)', () => {
    expect(deriveAdvRelevance('Meridian Global Advisors', ADV_FLAGS, CONFIG).verdict).toBe('likely_relevant');
  });
  it('config-driven: changing no_signal_adv_default changes the fallback', () => {
    expect(deriveAdvRelevance('Meridian', ADV_FLAGS, { ...CONFIG, no_signal_adv_default: 'unknown' }).verdict).toBe('unknown');
  });
});

// ── possible_hft + verdictAction ──────────────────────────────────────────────
describe('computePossibleHft', () => {
  it('fires: large AUM + tiny book', () => expect(computePossibleHft({ aum: 5e9, holdingCount: 2, config: CONFIG })).toBe(true));
  it('no fire: enough holdings', () => expect(computePossibleHft({ aum: 5e9, holdingCount: 50, config: CONFIG })).toBe(false));
  it('no fire: AUM below threshold', () => expect(computePossibleHft({ aum: 1e8, holdingCount: 0, config: CONFIG })).toBe(false));
  it('config-driven: raising possible_hft_min_aum suppresses it', () => {
    expect(computePossibleHft({ aum: 5e9, holdingCount: 2, config: { ...CONFIG, possible_hft_min_aum: 1e11 } })).toBe(false);
  });
});

describe('verdictAction (from relevance_verdict_actions)', () => {
  it('irrelevant → gate', () => expect(verdictAction('irrelevant', VERDICT_ACTIONS)).toBe('gate'));
  it('unknown → pass (absence never gates)', () => expect(verdictAction('unknown', VERDICT_ACTIONS)).toBe('pass'));
  it('suspect → penalize', () => expect(verdictAction('suspect', VERDICT_ACTIONS)).toBe('penalize'));
  it('config-driven: flipping unknown→gate would gate it', () => {
    const cfg = VERDICT_ACTIONS.map(v => v.verdict === 'unknown' ? { ...v, action: 'gate' } : v);
    expect(verdictAction('unknown', cfg)).toBe('gate');
  });
});

// ── activity metrics ──────────────────────────────────────────────────────────
describe('activity metrics', () => {
  it('positionChurn = symmetric-diff ÷ union', () => {
    const cur = [{ cusip: 'A' }, { cusip: 'B' }, { cusip: 'C' }];
    const pri = [{ cusip: 'A' }, { cusip: 'B' }, { cusip: 'D' }];
    expect(positionChurn(cur, pri)).toBe(50); // {C,D} changed of {A,B,C,D} = 2/4
  });
  it('computeActivityMetrics: first filing null deltas; second computes turnover/churn', () => {
    const f1 = { filing_id: 'f1', period_of_report: '2023-12-31', holdings: [{ cusip: 'A', value_usd: 100, put_call: null }] };
    const f2 = { filing_id: 'f2', period_of_report: '2024-03-31', holdings: [{ cusip: 'A', value_usd: 100 }, { cusip: 'B', value_usd: 100, put_call: 'Put' }] };
    const m = computeActivityMetrics([f2, f1]); // unordered input
    expect(m.f1.turnover_pct).toBeNull();
    expect(m.f1.position_count).toBe(1);
    expect(m.f2.position_count).toBe(2);
    expect(m.f2.position_count_delta).toBe(1);
    expect(m.f2.position_churn_pct).toBe(50);          // {B} added of {A,B}
    expect(m.f2.options_value_fraction).toBe(50);      // 100 of 200 is a Put
    expect(m.f2.turnover_pct).not.toBeNull();
  });
});
