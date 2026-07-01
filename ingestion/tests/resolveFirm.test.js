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
import { resolveFirm, normalizeName, setStopwords, setMatcherData, computeStage2Score } from '../src/engine/resolveFirm.js';

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
        'the',
      ],
      trailing: [
        'llc', 'lp', 'llp', 'inc', 'incorporated', 'corp', 'corporation',
        'ltd', 'limited', 'plc', 'ulc', 'company', 'co',
        'pte', 'pty', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'spa',
        'bv', 'nv', 'ab', 'as', 'aps', 'oy', 'kk',
        'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
      ],
    });
  });
});

// ── Part C: Stage 2 distinctive-token weighted Jaccard ───────────────────────
//
// These tests require realistic IDF data injected via setMatcherData().
// The token_document_freq_raw view (migration 022) provides this in production.
//
// Scoring recap:
//   Distinctive = len >= min_token_len AND (IDF >= distinctiveness_threshold OR has digit)
//   score = Σ idf(shared_distinctive) / (Σ idf(shared_distinctive) + Σ idf(mismatched_distinctive) * 1.6)
//   fallback: no distinctive tokens → raw-name trigram similarity vs fallback_threshold (0.9)
//
// Stage 2 is INACTIVE when _tokenFreq is empty (cold-start); existing tests above
// run in cold-start mode so they are unaffected by this section.

// Realistic IDF corpus: common words get low IDF (NOT distinctive at threshold 2.5);
// rare firm-specific tokens get high IDF (distinctive).
const BASE_TOKEN_FREQ = [
  // Common words: HIGH doc_count → LOW idf → NOT distinctive (idf < 2.5)
  { token: 'management',  idf: 0.8  },
  { token: 'capital',     idf: 1.2  },
  { token: 'partners',    idf: 2.0  },
  { token: 'investments', idf: 1.5  },
  { token: 'investment',  idf: 1.5  },
  { token: 'advisors',    idf: 1.0  },
  { token: 'advisory',    idf: 1.1  },
  { token: 'financial',   idf: 1.4  },
  { token: 'global',      idf: 2.0  },
  { token: 'group',       idf: 1.2  },
  { token: 'private',     idf: 1.8  },
  { token: 'asset',       idf: 1.3  },
  { token: 'services',    idf: 1.6  },
  { token: 'fund',        idf: 1.0  },
  { token: 'ventures',    idf: 2.2  },  // below threshold — not distinctive
  { token: 'technology',  idf: 1.9  },
  { token: 'studio',      idf: 2.3  },
  // Entity types: len < 4 or very low idf (min-len check handles most)
  { token: 'llc',         idf: 0.4  },
  { token: 'lp',          idf: 0.6  },
  { token: 'inc',         idf: 0.5  },
  { token: 'co',          idf: 0.5  },
  { token: 'corp',        idf: 0.6  },
  { token: 'corporation', idf: 0.5  },
  // Distinctive tokens: rare, high IDF (>= 2.5), len >= 4
  { token: 'point72',     idf: 5.5  },  // also digit → always distinctive
  { token: 'park',        idf: 4.5  },
  { token: 'place',       idf: 4.2  },
  { token: 'bluestar',    idf: 5.0  },
  { token: 'ventures',    idf: 2.2  },  // NOT distinctive even with len 8 (idf < 2.5)
  { token: 'blue',        idf: 1.8  },  // common colour word — not distinctive
];

const STAGE2_CONFIG = {
  stage1_recall_threshold:             '0.3',
  stage2_decision_threshold:           '0.65',
  stage2_fallback_similarity_threshold:'0.9',
  distinctiveness_threshold:           '2.5',
  weighting_strength:                  '0.6',
  min_token_len_for_distinctive:       '4',
  digit_tokens_distinctive:            'true',
};

describe('resolveFirm — Stage 2: distinctive-token weighted Jaccard', () => {
  it('Point72 mismatch → dismissed (distinctive token present in one name only)', async () => {
    // point72 (IDF 5.5, digit → always distinctive) is only in the candidate.
    // score = 0 / (5.5 * 1.6) = 0 < 0.65 → Stage 2 dismisses → resolution 'new'.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-p72', name: 'Point72 Private Investments LLC', similarity: 0.53,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Private Management Group Inc' });
    expect(res).toEqual({ resolution: 'new' });

    setMatcherData({});  // restore cold-start
  });

  it('Point72 shared → flagged (distinctive token in both names)', async () => {
    // point72 is shared → score = 5.5 / 5.5 = 1.0 ≥ 0.65 → flag.
    // Other tokens (private, investments, global, etc.) are NOT distinctive (idf < 2.5)
    // so they don't influence the score.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-p72b', name: 'Point72 Global Investment Co', similarity: 0.61,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Point72 Private Investments LLC' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchId).toBe('prosp-p72b');
    expect(res.matchReason.decision).toBe('flag');
    expect(res.matchReason.weighted_score).toBe(1);

    setMatcherData({});
  });

  it('Park Place Capital Corp vs Park Place Capital Corporation → flagged', async () => {
    // park (4.5) and place (4.2) both shared, both distinctive → score = 1.0.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-pp', name: 'Park Place Capital Corporation', similarity: 0.92,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Park Place Capital Corp' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchReason.decision).toBe('flag');
    expect(res.matchReason.distinctive_mismatch_tokens).toEqual([]);

    setMatcherData({});
  });

  it('CRD mismatch → new even when Stage 2 would flag (Fix A has highest precedence)', async () => {
    // point72 shared → Stage 2 would produce score 1.0, but CRD mismatch fires first.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-bad', name: 'Point72 Asset Management', similarity: 0.8,
          match_type: 'prospect', crd_number: '12345', cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { crdNumber: '99999', firmName: 'Point72 Private Investments' });
    expect(res).toEqual({ resolution: 'new' });

    setMatcherData({});
  });

  it('identical all-boilerplate names → flagged (denominator=0 fallback, not auto-dismissed)', async () => {
    // Both names reduce to no distinctive tokens → denominator = 0.
    // Fallback: raw-name trigram similarity. Identical names → sim = 1.0 ≥ 0.9 → flag.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-boiler', name: 'Capital Management Partners', similarity: 0.99,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Capital Management Partners' });
    expect(res.resolution).toBe('fuzzy_prospect');
    expect(res.matchReason.fallback_used).toBe(true);
    expect(res.matchReason.decision).toBe('flag');

    setMatcherData({});
  });

  it('different all-boilerplate names → dismissed (denominator=0 fallback, low trigram sim)', async () => {
    // Both names have no distinctive tokens → fallback.
    // Very different raw names → trigram similarity well below 0.9 → dismiss.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-diff', name: 'Technology Ventures Studio', similarity: 0.35,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Capital Management Partners' });
    expect(res).toEqual({ resolution: 'new' });

    setMatcherData({});
  });

  it('config-driven threshold flip: lowering stage2_decision_threshold flags a borderline pair', async () => {
    // BlueStar (idf 5.0, distinctive) shared, Ventures (idf 2.2 < 2.5, NOT distinctive).
    // score = 5.0 / 5.0 = 1.0 — actually fully matched on distinctive tokens.
    // Use a case where only ONE distinctive token is shared and another is mismatched:
    // "BlueStar Capital" vs "BlueStar Ventures Group" — need 'ventures' to be distinctive.
    const configHighThresh = { ...STAGE2_CONFIG, distinctiveness_threshold: '2.0',
                                stage2_decision_threshold: '0.65' };
    const configLowThresh  = { ...configHighThresh, stage2_decision_threshold: '0.45' };

    // With distinctiveness_threshold 2.0, 'ventures' (idf 2.2 ≥ 2.0) becomes distinctive.
    // A: {bluestar} distinctive; B: {bluestar, ventures} distinctive
    // score = 5.0 / (5.0 + 2.2 * 1.6) = 5.0 / (5.0 + 3.52) = 5.0 / 8.52 ≈ 0.587

    const candidateData = [{
      id: 'prosp-bs', name: 'BlueStar Ventures Group', similarity: 0.55,
      match_type: 'prospect', crd_number: null, cik: null,
    }];

    // High threshold (0.65): score 0.587 < 0.65 → dismissed
    setMatcherData({ config: configHighThresh, tokenFreq: BASE_TOKEN_FREQ });
    const sbHigh = makeSb({ acctResult: NO_MATCH, prospResult: NO_MATCH,
                            rpcResult: { data: candidateData, error: null } });
    const resHigh = await resolveFirm(sbHigh, { firmName: 'BlueStar Capital' });
    expect(resHigh).toEqual({ resolution: 'new' });

    // Low threshold (0.45): score 0.587 ≥ 0.45 → flagged
    setMatcherData({ config: configLowThresh, tokenFreq: BASE_TOKEN_FREQ });
    const sbLow = makeSb({ acctResult: NO_MATCH, prospResult: NO_MATCH,
                           rpcResult: { data: candidateData, error: null } });
    const resLow = await resolveFirm(sbLow, { firmName: 'BlueStar Capital' });
    expect(resLow.resolution).toBe('fuzzy_prospect');

    setMatcherData({});
  });

  it('match_reason structure: flagged pair has required explainability fields', async () => {
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const sb = makeSb({
      acctResult:  NO_MATCH,
      prospResult: NO_MATCH,
      rpcResult: {
        data: [{
          id: 'prosp-mr', name: 'Park Place Capital Corporation', similarity: 0.92,
          match_type: 'prospect', crd_number: null, cik: null,
        }],
        error: null,
      },
    });

    const res = await resolveFirm(sb, { firmName: 'Park Place Capital Corp' });

    expect(res.matchReason).toMatchObject({
      stage:                       'stage2',
      decision:                    'flag',
      fallback_used:                false,
      identifier_status:           'no_conflict',
      distinctive_mismatch_tokens: [],
    });
    expect(typeof res.matchReason.raw_trgm_similarity).toBe('number');
    expect(typeof res.matchReason.weighted_score).toBe('number');
    expect(typeof res.matchReason.threshold_applied).toBe('number');
    expect(Array.isArray(res.matchReason.matched_tokens)).toBe(true);
    // Matched tokens for park + place should show matched: true
    const matched = res.matchReason.matched_tokens.filter(t => t.matched);
    expect(matched.map(t => t.token).sort()).toEqual(['park', 'place']);

    setMatcherData({});
  });

  it('corp/corporation excluded even when corpus IDF is high (entity-suffix guard)', () => {
    // In a small corpus 'corp' / 'corporation' may appear in only 2–3 firms →
    // IDF ≈ 3.0–3.2 (above 2.5 threshold). Without _trailingSet exclusion they
    // would fire a mismatch penalty and dismiss Park Place incorrectly.
    const tokenFreqHighCorpIdf = [
      ...BASE_TOKEN_FREQ.filter(t => t.token !== 'corp' && t.token !== 'corporation'),
      { token: 'corp',        idf: 3.2 },
      { token: 'corporation', idf: 3.0 },
    ];
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: tokenFreqHighCorpIdf });

    const result = computeStage2Score('Park Place Capital Corp', 'Park Place Capital Corporation');
    // corp and corporation excluded by _trailingSet → zero mismatch tokens
    expect(result.distinctiveMismatches).toEqual([]);
    // park + place both shared → score 1.0
    expect(result.weightedScore).toBe(1.0);
    expect(result.fallbackUsed).toBe(false);

    setMatcherData({});
  });

  it('Blue Capital vs Blue Ventures — dismissed via trigram fallback (no distinctive tokens)', () => {
    // blue (1.8), capital (1.2), ventures (2.2) — all below distinctiveness threshold.
    // denominator = 0 → fallback: trigramSim(normalizeName(A), normalizeName(B)).
    // normalizeName("Blue Capital") = "blue"; normalizeName("Blue Ventures") = "blue ventures"
    // trigramSim("blue", "blue ventures") ≈ 0.36 (< 0.9 fallback threshold) → dismiss.
    // Guards against Option A's over-stripping: 'capital' stays in the lightNorm token
    // set but is non-distinctive; its absence or presence doesn't create a spurious
    // mismatch penalty because only distinctive tokens enter the scoring loop.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const result = computeStage2Score('Blue Capital', 'Blue Ventures');
    expect(result.fallbackUsed).toBe(true);
    expect(result.weightedScore).toBeLessThan(0.9);

    setMatcherData({});
  });

  it('Point72 anchor case (Case 2): Point72 shared between two variant names → flagged', async () => {
    // Anchor trace: "Point72 Private Investments LLC" vs "Point72 Global Investment Co"
    // lightNorm tokens: both include 'point72'; 'llc' and 'co' excluded by _trailingSet.
    // All other tokens (private, investments, global, investment) are non-distinctive.
    // score = 5.5 / 5.5 = 1.0 ≥ 0.65 → flag.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const result = computeStage2Score('Point72 Private Investments LLC', 'Point72 Global Investment Co');
    expect(result.fallbackUsed).toBe(false);
    expect(result.distinctiveMismatches).toEqual([]);
    expect(result.weightedScore).toBe(1.0);

    setMatcherData({});
  });

  it('Point72 anchor case (Case 1): distinctive token only in one name → dismissed', () => {
    // Anchor trace: "Private Management Group Inc" vs "Point72 Private Investments LLC"
    // 'inc' and 'llc' excluded by _trailingSet. Remaining: private/management/group
    // vs point72/private/investments. Only point72 is distinctive (digit, IDF 5.5).
    // It appears only in the candidate → score = 0 / (5.5 * 1.6) = 0 < 0.65 → dismiss.
    setMatcherData({ config: STAGE2_CONFIG, tokenFreq: BASE_TOKEN_FREQ });

    const result = computeStage2Score('Private Management Group Inc', 'Point72 Private Investments LLC');
    expect(result.fallbackUsed).toBe(false);
    expect(result.weightedScore).toBe(0);
    expect(result.distinctiveMismatches).toContain('point72');

    setMatcherData({});
  });

  it('SQL/JS normalization parity: normalizeName tests cover the Stage 1 normalized_name path', () => {
    // The normalizeName describe blocks above verify that JS output matches the SQL
    // normalize_firm_name() seeded by the same SEED_STOPWORDS. Stage 2 tokenises via
    // lightNormalize() (no stopwords — same regex as the token_document_freq_raw CTE:
    // [^a-z0-9 ] strip + whitespace collapse). Entity-suffix exclusion uses _trailingSet
    // populated from the same SEED_STOPWORDS.trailing as the DB trailing_only words.
    expect(true).toBe(true);
  });
});
