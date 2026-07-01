/**
 * Unit tests for scripts/recheck-dedup-queue.js
 *
 * Verifies that match_reason is persisted in every code path — the key
 * gap before this fix was that Fix A and Fix B wrote status updates without
 * match_reason, and the Stage 2 flag path wrote neither status nor reason.
 *
 * A fake supabase client is injected; no real DB required.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { recheckDedupQueue }               from '../scripts/recheck-dedup-queue.js';
import { setMatcherData }                  from '../src/engine/resolveFirm.js';

// ── Fake supabase builder ─────────────────────────────────────────────────────
//
// Returns a chainable builder whose select() result can be:
//   - awaited directly (for tables with no chained eq/in)
//   - chained with .eq() or .in() before await
// All update() calls are captured in sb._updateCalls.

function makeRecheckSb({
  entries     = [],
  prospects   = [],
  accounts    = [],
  similarity  = 0.99,
  configData  = [],
  freqData    = [],
} = {}) {
  const updateCalls = [];

  function chainable(defaultResult, methods = {}) {
    // Make it both await-able (for direct `await from(...).select(...)`) AND
    // chainable (for `.eq()`/`.in()` after select).
    return Object.assign(
      { then: (res, rej) => Promise.resolve(defaultResult).then(res, rej) },
      methods,
    );
  }

  return {
    _updateCalls: updateCalls,
    from: (table) => ({
      select: () => chainable(
        // Direct-await result (matcher tables have no trailing .eq()/.in())
        table === 'matcher_config'            ? { data: configData, error: null }
        : table === 'token_document_freq_raw' ? { data: freqData,  error: null }
        : { data: [], error: null },
        {
          // dedup_queue pending fetch
          eq: (_col, _val) => Promise.resolve(
            table === 'dedup_queue' ? { data: entries, error: null } : { data: [], error: null }
          ),
          // batch ID fetches (prospects / accounts)
          in: (_col, ids) => Promise.resolve(
            table === 'prospects' ? { data: prospects.filter(p => ids.includes(p.id)), error: null }
            : table === 'accounts' ? { data: accounts.filter(a => ids.includes(a.id)), error: null }
            : { data: [], error: null }
          ),
        }
      ),
      update: (payload) => ({
        eq: (_col, _val) => {
          updateCalls.push({ ...payload });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: () => Promise.resolve({ data: similarity, error: null }),
  };
}

// Minimal matcher_config rows mirroring STAGE2_CONFIG in resolveFirm.test.js
const BASE_CONFIG_DATA = [
  { key: 'stage1_recall_threshold',              value: '0.3'  },
  { key: 'stage2_decision_threshold',            value: '0.65' },
  { key: 'stage2_fallback_similarity_threshold', value: '0.9'  },
  { key: 'distinctiveness_threshold',            value: '2.5'  },
  { key: 'weighting_strength',                   value: '0.6'  },
  { key: 'min_token_len_for_distinctive',        value: '4'    },
  { key: 'digit_tokens_distinctive',             value: 'true' },
];

afterEach(() => setMatcherData({})); // reset to cold-start between tests

// ── Fix A ─────────────────────────────────────────────────────────────────────

describe('recheckDedupQueue — Fix A match_reason persistence', () => {
  it('CRD mismatch: match_reason has stage=fix_a and the two conflicting CRDs', async () => {
    const entries = [{
      id: 'dq-1', prospect_id: 'p-1', match_type: 'prospect',
      matched_prospect_id: 'p-2', matched_account_id: null,
      similarity: 0.75, matched_name: 'Alpha Capital LLC',
    }];
    const prospects = [
      { id: 'p-1', firm_name: 'Alpha Capital',     crd_number: '111', cik: null },
      { id: 'p-2', firm_name: 'Alpha Capital LLC', crd_number: '999', cik: null },
    ];

    const sb = makeRecheckSb({ entries, prospects });
    await recheckDedupQueue(sb);

    expect(sb._updateCalls).toHaveLength(1);
    const update = sb._updateCalls[0];
    expect(update.status).toBe('not_duplicate');
    expect(update.match_reason).not.toBeNull();
    expect(update.match_reason.stage).toBe('fix_a');
    expect(update.match_reason.decision).toBe('dismiss');
    expect(update.match_reason.reason).toBe('identifier_mismatch');
    expect(update.match_reason.crd_a).toBe('111');
    expect(update.match_reason.crd_b).toBe('999');
  });

  it('CIK mismatch: match_reason has cik_a and cik_b (no crd fields)', async () => {
    const entries = [{
      id: 'dq-2', prospect_id: 'p-3', match_type: 'prospect',
      matched_prospect_id: 'p-4', matched_account_id: null,
      similarity: 0.65, matched_name: 'Beta Advisors',
    }];
    const prospects = [
      { id: 'p-3', firm_name: 'Beta Advisory',  crd_number: null, cik: 'CIK_111' },
      { id: 'p-4', firm_name: 'Beta Advisors',  crd_number: null, cik: 'CIK_999' },
    ];

    const sb = makeRecheckSb({ entries, prospects });
    await recheckDedupQueue(sb);

    const reason = sb._updateCalls[0].match_reason;
    expect(reason.stage).toBe('fix_a');
    expect(reason.cik_a).toBe('CIK_111');
    expect(reason.cik_b).toBe('CIK_999');
    expect(reason.crd_a).toBeUndefined();
  });
});

// ── Fix B ─────────────────────────────────────────────────────────────────────

describe('recheckDedupQueue — Fix B match_reason persistence', () => {
  it('below-threshold similarity: match_reason has stage=fix_b with score and threshold', async () => {
    const entries = [{
      id: 'dq-3', prospect_id: 'p-5', match_type: 'prospect',
      matched_prospect_id: 'p-6', matched_account_id: null,
      similarity: 0.42, matched_name: 'Gamma Wealth',
    }];
    const prospects = [
      { id: 'p-5', firm_name: 'Gamma Capital',  crd_number: null, cik: null },
      { id: 'p-6', firm_name: 'Gamma Wealth',   crd_number: null, cik: null },
    ];

    // similarity = 0.42 < FIX_B_THRESHOLD (0.5) → Fix B fires
    const sb = makeRecheckSb({ entries, prospects, similarity: 0.42 });
    await recheckDedupQueue(sb);

    expect(sb._updateCalls).toHaveLength(1);
    const update = sb._updateCalls[0];
    expect(update.status).toBe('not_duplicate');
    const reason = update.match_reason;
    expect(reason.stage).toBe('fix_b');
    expect(reason.decision).toBe('dismiss');
    expect(reason.similarity).toBeCloseTo(0.42);
    expect(reason.threshold).toBe(0.5);
  });
});

// ── Fix C ─────────────────────────────────────────────────────────────────────

describe('recheckDedupQueue — Fix C match_reason persistence', () => {
  it('Stage 2 flag: match_reason persisted on pending row WITHOUT changing status', async () => {
    // point72 (IDF 5.5, digit → always distinctive) is shared → score 1.0 → flag.
    const entries = [{
      id: 'dq-4', prospect_id: 'p-7', match_type: 'prospect',
      matched_prospect_id: 'p-8', matched_account_id: null,
      similarity: 0.72, matched_name: 'Point72 Global',
    }];
    const prospects = [
      { id: 'p-7', firm_name: 'Point72 Asset Management', crd_number: null, cik: null },
      { id: 'p-8', firm_name: 'Point72 Global',           crd_number: null, cik: null },
    ];
    const freqData = [
      { token: 'point72',    idf: 5.5 },
      { token: 'asset',      idf: 1.3 },
      { token: 'management', idf: 0.8 },
      { token: 'global',     idf: 2.0 },
    ];

    const sb = makeRecheckSb({
      entries, prospects, similarity: 0.72,
      configData: BASE_CONFIG_DATA, freqData,
    });
    await recheckDedupQueue(sb);

    expect(sb._updateCalls).toHaveLength(1);
    const update = sb._updateCalls[0];
    // Status MUST NOT be set — row stays pending
    expect(update.status).toBeUndefined();
    const reason = update.match_reason;
    expect(reason).not.toBeNull();
    expect(reason.stage).toBe('stage2_recheck');
    expect(reason.decision).toBe('flag');
    expect(typeof reason.weighted_score).toBe('number');
    expect(reason.weighted_score).toBeGreaterThanOrEqual(0.65);
    expect(Array.isArray(reason.matched_tokens)).toBe(true);
    expect(Array.isArray(reason.distinctive_mismatch_tokens)).toBe(true);
  });

  it('Stage 2 dismiss: match_reason includes decision=dismiss and status is set', async () => {
    // point72 only in candidate → score 0 → dismiss.
    const entries = [{
      id: 'dq-5', prospect_id: 'p-9', match_type: 'prospect',
      matched_prospect_id: 'p-10', matched_account_id: null,
      similarity: 0.53, matched_name: 'Point72 Private Investments LLC',
    }];
    const prospects = [
      { id: 'p-9',  firm_name: 'Private Management Group Inc',    crd_number: null, cik: null },
      { id: 'p-10', firm_name: 'Point72 Private Investments LLC', crd_number: null, cik: null },
    ];
    const freqData = [
      { token: 'point72',     idf: 5.5 },
      { token: 'private',     idf: 1.8 },
      { token: 'management',  idf: 0.8 },
      { token: 'group',       idf: 1.2 },
      { token: 'investments', idf: 1.5 },
    ];

    const sb = makeRecheckSb({
      entries, prospects, similarity: 0.53,
      configData: BASE_CONFIG_DATA, freqData,
    });
    await recheckDedupQueue(sb);

    expect(sb._updateCalls).toHaveLength(1);
    const update = sb._updateCalls[0];
    expect(update.status).toBe('not_duplicate');
    const reason = update.match_reason;
    expect(reason.stage).toBe('stage2_recheck');
    expect(reason.decision).toBe('dismiss');
    expect(reason.weighted_score).toBe(0);
    expect(reason.distinctive_mismatch_tokens).toContain('point72');
  });
});
