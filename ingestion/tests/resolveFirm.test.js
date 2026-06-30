/**
 * Unit tests for engine/resolveFirm.js
 *
 * resolveFirm takes supabase as the first argument, so we inject a fake
 * builder for each test — no module mocking required.
 *
 * Resolution order under test:
 *   1. CIK  → accounts  (account_match)
 *   2. CRD  → accounts  (account_match)
 *   3. CIK  → prospects (prospect_merge)
 *   4. CRD  → prospects (prospect_merge)
 *   5. fuzzy RPC → fuzzy_account | fuzzy_prospect
 *      Fix A: rejected when candidate has a different non-null CRD or CIK
 *   7. no match → new
 */

import { describe, it, expect } from 'vitest';
import { resolveFirm, normalizeName, setStopwords } from '../src/engine/resolveFirm.js';

// ── Fake Supabase builder ─────────────────────────────────────────────────────

/**
 * Build a minimal fake Supabase client.
 *
 * @param {object} opts
 * @param {{ data, error }} opts.acctResult   — returned by accounts queries
 * @param {{ data, error }} opts.prospResult  — returned by prospects queries
 * @param {{ data, error }} opts.rpcResult    — returned by rpc()
 */
function makeSb({
  acctResult  = { data: null,  error: null },
  prospResult = { data: null,  error: null },
  rpcResult   = { data: [],    error: null },
} = {}) {
  const builder = (result) => {
    const b = {
      select:      () => b,
      eq:          () => b,
      maybeSingle: () => Promise.resolve(result),
    };
    return b;
  };
  return {
    from: (table) => builder(table === 'accounts' ? acctResult : prospResult),
    rpc:  ()      => Promise.resolve(rpcResult),
  };
}

const NO_MATCH = { data: null, error: null };

// ── Existing resolution-order tests ──────────────────────────────────────────

describe('resolveFirm', () => {
  it('CIK exact match → account_match', async () => {
    const sb  = makeSb({ acctResult: { data: { id: 'acc-1' }, error: null } });
    const res = await resolveFirm(sb, { cik: 'C001', firmName: 'Test Fund' });
    expect(res).toEqual({ resolution: 'account_match', accountId: 'acc-1' });
  });

  it('CRD exact match → account_match', async () => {
    const sb  = makeSb({ acctResult: { data: { id: 'acc-2' }, error: null } });
    const res = await resolveFirm(sb, { crdNumber: '123456', firmName: 'Test Adviser' });
    expect(res).toEqual({ resolution: 'account_match', accountId: 'acc-2' });
  });

  it('CIK exact match → prospect_merge', async () => {
    const sb  = makeSb({
      acctResult:  NO_MATCH,
      prospResult: { data: { id: 'prosp-1' }, error: null },
    });
    const res = await resolveFirm(sb, { cik: 'C002', firmName: 'Test Fund' });
    expect(res).toEqual({ resolution: 'prospect_merge', prospectId: 'prosp-1' });
  });

  it('CRD exact match → prospect_merge', async () => {
    const sb  = makeSb({
      acctResult:  NO_MATCH,
      prospResult: { data: { id: 'prosp-2' }, error: null },
    });
    const res = await resolveFirm(sb, { crdNumber: '789', firmName: 'Test Adviser' });
    expect(res).toEqual({ resolution: 'prospect_merge', prospectId: 'prosp-2' });
  });

  it('fuzzy match → fuzzy_account', async () => {
    const sb  = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'acc-3', name: 'Test Capital LLC', similarity: 0.87,
                 match_type: 'account', crd_number: null, cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { firmName: 'Test Capital' });
    expect(res.resolution).toBe('fuzzy_account');
    expect(res.matchId).toBe('acc-3');
    expect(res.similarity).toBe(0.87);
  });

  it('fuzzy match → fuzzy_prospect', async () => {
    const sb  = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-3', name: 'Test Partners LP', similarity: 0.75,
                 match_type: 'prospect', crd_number: null, cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { firmName: 'Test Partners' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchId).toBe('prosp-3');
  });

  it('no match → new', async () => {
    const sb  = makeSb(); // all return null/empty
    const res = await resolveFirm(sb, { firmName: 'Completely Unknown Fund' });
    expect(res).toEqual({ resolution: 'new' });
  });

  it('RPC error → graceful fallback to new', async () => {
    const sb  = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult:  { data: null, error: { message: 'function not found' } },
    });
    const res = await resolveFirm(sb, { firmName: 'Any Firm' });
    expect(res).toEqual({ resolution: 'new' });
  });

  it('resolution order: CIK match takes priority over CRD', async () => {
    // Both cik and crdNumber provided; accounts returns a match.
    // CIK is checked first (step 1) so it should win.
    const sb  = makeSb({ acctResult: { data: { id: 'acc-cik' }, error: null } });
    const res = await resolveFirm(sb, {
      cik:       'C999',
      crdNumber: '999',
      firmName:  'Dual-ID Fund',
    });
    expect(res).toEqual({ resolution: 'account_match', accountId: 'acc-cik' });
  });

  it('resolution order: exact match takes priority over fuzzy', async () => {
    // prospect row found by CIK → returns prospect_merge without reaching RPC
    const rpcSpy = { called: false };
    const sb = {
      from: (table) => {
        const result = table === 'accounts'
          ? NO_MATCH
          : { data: { id: 'prosp-exact' }, error: null };
        const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve(result) };
        return b;
      },
      rpc: () => { rpcSpy.called = true; return Promise.resolve({ data: [], error: null }); },
    };
    const res = await resolveFirm(sb, { cik: 'C100', firmName: 'Exact Match Fund' });
    expect(res.resolution).toBe('prospect_merge');
    expect(rpcSpy.called).toBe(false); // fuzzy RPC never called
  });
});

// ── Fix A: identifier-mismatch guard ─────────────────────────────────────────

describe('resolveFirm — Fix A: identifier mismatch blocks fuzzy (different firms)', () => {
  it('CRD mismatch → not matched (Lloyd/MH advisory false-positive pattern)', async () => {
    // Both firms have CRDs that differ → definitively different firms.
    // Similarity 0.67 on "advisory services" overlap must NOT win.
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-mh', name: 'MH Advisory Services', similarity: 0.67,
                 match_type: 'prospect', crd_number: '999888', cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { crdNumber: '111222', firmName: 'Lloyd Advisory Services' });
    expect(res).toEqual({ resolution: 'new' });
  });

  it('CIK mismatch → not matched (PGIM/ESR singapore false-positive pattern)', async () => {
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-esr', name: 'ESR Singapore', similarity: 0.64,
                 match_type: 'prospect', crd_number: null, cik: 'CIK_9999' }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { cik: 'CIK_1111', firmName: 'PGIM Singapore' });
    expect(res).toEqual({ resolution: 'new' });
  });

  it('same CRD → accepted (same firm, variant name)', async () => {
    // CRD matches → this IS the same firm; fuzzy should be accepted
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-apex', name: 'Apex Hedge Fund LP', similarity: 0.91,
                 match_type: 'prospect', crd_number: '111222', cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { crdNumber: '111222', firmName: 'Apex Hedge Fund' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchId).toBe('prosp-apex');
  });

  it('candidate has null CRD → fuzzy accepted (genuine ambiguity)', async () => {
    // Incoming has a CRD but the matched record lacks one (e.g. 13F-only prospect
    // that hasn't been linked to an ADV filing yet). Name similarity stands.
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-ambig', name: 'Apex Hedge Capital', similarity: 0.85,
                 match_type: 'prospect', crd_number: null, cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { crdNumber: '111222', firmName: 'Apex Hedge' });
    expect(res.resolution).toBe('fuzzy_prospect');
  });

  it('incoming has no CRD → fuzzy accepted regardless of candidate CRD', async () => {
    // 13F-sourced firm (CIK only, no CRD) — fuzzy match against ADV prospect
    // that has a CRD. No mismatch to detect; name similarity decides.
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{ id: 'prosp-adv', name: 'Clearbridge Investments LLC', similarity: 0.82,
                 match_type: 'prospect', crd_number: '555111', cik: null }],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { cik: 'CIK_123', firmName: 'Clearbridge' });
    expect(res.resolution).toBe('fuzzy_prospect');
  });

  it('first candidate rejected (CRD mismatch), second candidate accepted', async () => {
    // Top match has a conflicting CRD → skip. Next candidate has no CRD → accept.
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [
          { id: 'prosp-bad', name: 'Bad Match Fund', similarity: 0.9,
            match_type: 'prospect', crd_number: '000001', cik: null },
          { id: 'prosp-ok',  name: 'Good Match Fund', similarity: 0.8,
            match_type: 'prospect', crd_number: null, cik: null },
        ],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { crdNumber: '999999', firmName: 'Good Match Fund' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchId).toBe('prosp-ok');
  });

  it('all candidates rejected (all CRD mismatches) → new', async () => {
    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [
          { id: 'p1', name: 'A Fund', similarity: 0.9, match_type: 'prospect',
            crd_number: '111', cik: null },
          { id: 'p2', name: 'B Fund', similarity: 0.8, match_type: 'prospect',
            crd_number: '222', cik: null },
        ],
        error: null,
      },
    });
    const res = await resolveFirm(sb, { crdNumber: '999', firmName: 'A Fund' });
    expect(res).toEqual({ resolution: 'new' });
  });
});

// ── Fix B+C: normalizeName stopword expansion ─────────────────────────────────
//
// These tests verify that both the industry-descriptor expansion (Fix B) and
// the two-pass punctuation-then-stopwords logic (Fix C) produce the correct
// output. The SQL normalize_firm_name() applies the same logic against the same
// word list seeded by migration 019 — if these JS tests pass AND the migration
// seed matches SEED_STOPWORDS, SQL/JS parity is guaranteed by construction.

describe('normalizeName — stopword expansion and two-pass logic', () => {
  it.each([
    // Fix B: 'advisory' was missing from prior regex (matched advisors/advisers, not advisory)
    ['Lloyd Advisory Services',             'lloyd'],
    ['MH Advisory Services',               'mh'],
    // Fix B: financial + planning
    ['AISA FINANCIAL PLANNING',            'aisa'],
    ['INVESTMENTS & FINANCIAL PLANNING',   ''],       // all tokens stripped
    ['LARSON FINANCIAL GROUP',             'larson'],
    ['FINANCIAL MANAGEMENT ADVISORS',      ''],
    // Fix B: geographic
    ['PGIM (SINGAPORE)',                   'pgim'],   // parens removed by punct pass
    ['ESR SINGAPORE',                      'esr'],
    // Fix B: retirement + plan (word-boundary: 'plan' does NOT match 'planology')
    ['RETIREMENT PLANOLOGY',               'planology'],
    ['ARGENT RETIREMENT PLAN ADVISORS',    'argent'],
    // Fix B: wealth
    ['COASTAL PRIVATE WEALTH MANAGEMENT',  'coastal private'],
    ['PRIVATE WEALTH MANAGEMENT',          'private'],
    // Structural: existing words still stripped
    ['Bluescape Energy Partners LLC',      'bluescape energy'],
    // Two-pass: L.L.C. → punct removal → 'llc' → stopword strip
    ['Apex Capital L.L.C.',               'apex'],
    // Baseline: no stopwords present → name preserved
    ['Clearbridge',                        'clearbridge'],
    // Mixed: quant-style name with no stopwords
    ['Quant Strategies',                   'quant strategies'],
  ])('normalizeName(%s) → "%s"', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe('normalizeName — trailing_only position (migration 020)', () => {
  // Canonical verification cases from the spec
  it.each([
    // Core cases the user asked to verify
    ['ESR SINGAPORE PTE LTD',         'esr'],      // anywhere 'singapore', trailing 'pte'+'ltd'
    ['PGIM (SINGAPORE) PTE. LTD.',    'pgim'],     // punct removal + anywhere + trailing loop
    // Ambiguous token preserved when NOT in trailing position
    ['AB GLOBAL PARTNERS LLC',        'ab global'],  // 'ab' survives; 'partners'→anywhere, trailing 'llc'
    ['SAMSUNG ASSET MANAGEMENT SA',   'samsung'],   // anywhere 'asset'+'management', trailing 'sa'
    // Additional international suffixes
    ['TOKYO SECURITIES KK',           'tokyo securities'],
    ['HELSINKI CAPITAL OY',           'helsinki'],  // anywhere 'capital', trailing 'oy'
    ['AMSTERDAM WEALTH BV',           'amsterdam'], // anywhere 'wealth', trailing 'bv'
    ['ZURICH AG',                     'zurich'],
    ['PARIS SARL',                    'paris'],
    ['OSLO AS',                       'oslo'],
    // When all boilerplate is stripped, the only remaining ambiguous initialism
    // also becomes trailing and is correctly removed:
    ['AS CAPITAL MANAGEMENT AB',      ''],          // capital+management (anywhere), then ab→as→ empty
    // Multiple trailing suffixes peeled one at a time
    ['APEX HEDGE FUND PTE. LTD.',     'apex hedge'], // 'fund' anywhere; trailing 'ltd' then 'pte'
    // llp/plc (new in 020)
    ['WATSON THORNTON LLP',           'watson thornton'],
    ['BARCLAYS WEALTH PLC',           'barclays'],
  ])('normalizeName(%s) → "%s"', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('ambiguous token preserved when a non-stopword follows it', () => {
    // 'as' is trailing_only. When a non-stopword ('offshore') trails it,
    // 'as' is never the last token so it is never stripped.
    expect(normalizeName('AKER AS OFFSHORE')).toBe('aker as offshore');
    // Contrast: when 'as' IS the trailing token, it is stripped.
    expect(normalizeName('AKER AS')).toBe('aker');
    // Similarly for 'ab': trailing → stripped; non-trailing → preserved.
    expect(normalizeName('AB GLOBAL ADVISORS')).toBe('ab global'); // 'advisors' anywhere; 'global' non-stopword remains
  });
});

describe('normalizeName — setStopwords override (Fix C config path)', () => {
  it('custom stopwords respect anywhere/trailing split', () => {
    setStopwords({ anywhere: ['foo'], trailing: ['bar'] });
    expect(normalizeName('Foo Capital Bar')).toBe('capital');     // 'foo' (anywhere) + 'bar' (trailing) both stripped
    expect(normalizeName('Bar Foo Capital')).toBe('bar capital'); // 'foo' stripped; 'bar' not trailing → preserved
    // Restore defaults so subsequent tests are unaffected
    setStopwords({
      anywhere: [
        'capital', 'management', 'advisors', 'advisers', 'advisory', 'partners', 'group',
        'holdings', 'asset', 'investments', 'investment', 'fund', 'funds',
        'financial', 'planning', 'wealth', 'services', 'retirement', 'plan', 'singapore',
      ],
      trailing: [
        'llc', 'lp', 'llp', 'inc', 'incorporated', 'corp', 'corporation',
        'ltd', 'limited', 'plc', 'ulc', 'company', 'co',
        'pte', 'pty', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'spa',
        'bv', 'nv', 'ab', 'as', 'aps', 'oy', 'kk',
      ],
    });
  });
});
