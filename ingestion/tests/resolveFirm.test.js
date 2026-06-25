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
 *   7. no match → new
 */

import { describe, it, expect } from 'vitest';
import { resolveFirm }          from '../src/engine/resolveFirm.js';

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
      select:     () => b,
      eq:         () => b,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

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
        data: [{ id: 'acc-3', name: 'Test Capital LLC', similarity: 0.87, match_type: 'account' }],
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
        data: [{ id: 'prosp-3', name: 'Test Partners LP', similarity: 0.75, match_type: 'prospect' }],
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
