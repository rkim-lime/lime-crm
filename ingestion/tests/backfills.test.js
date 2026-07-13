/**
 * Unit tests for the recompute backfills (src/engine/backfills.js) and their
 * worker dispatch (runConnector). normalizeFirm / computeFitScore are mocked so
 * we assert the WIRING: recompute:true is preserved, config_snapshot is written,
 * rows_changed counts actually-changed rows (idempotency), and both the CLI and
 * the worker call the same extracted function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const REFS = {
  signalDefs: [{ signal_key: 'x' }], segmentMappings: [{}], sizeBands: [{}], nameSignals: [{}],
  assetPatterns: [], servedBuckets: [], advNameFlags: [], relevanceConfig: {}, verdictActions: [],
};
// normalizeFirm returns this patch; a prospect whose derived cols match it is UNCHANGED.
const PATCH_AM = {
  segment_canonical: 'asset_manager', segment_confidence: 'high', aum_canonical: 1000, aum_basis: '13f_portfolio',
  aum_source: 'sec_13f', aum_as_of: null, size_tier: 'small', signal_completeness: 1,
  asset_class_relevance: 'relevant', asset_class_served_fraction: 0.9, normalized_at: 'NOW',
};

vi.mock('../src/engine/normalize.js', async (orig) => ({
  ...(await orig()),
  loadNormalizationRefs: vi.fn(async () => REFS),
  normalizeFirm: vi.fn(async () => PATCH_AM),
}));

vi.mock('../src/engine/fitScore.js', async (orig) => ({
  ...(await orig()),
  loadFitScoreConfig: vi.fn(async () => ({ weights: { aum_tier: 20 }, segmentTiers: {}, tierRatios: {} })),
  computeFitScore: vi.fn(() => ({ score: 85, breakdown: {} })),
}));

import { runBackfillNormalize, runBackfillFitScores } from '../src/engine/backfills.js';
import { runConnector } from '../src/engine/runConnector.js';
import { normalizeFirm } from '../src/engine/normalize.js';

// ── Compact fake supabase (chainable builder + capture) ──
function makeSupabase({ prospects = [], accounts = [], sources = {}, filings = {}, auditProspects = {} } = {}) {
  const captured = { updates: [], inserts: [] };
  function builder(table) {
    const q = { _table: table, _filters: {}, _op: 'select', _from: 0 };
    q.select = () => q;
    q.eq = (col, val) => { q._filters[col] = val; return q; };
    q.or = () => q;
    q.range = (from) => { q._from = from; return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: table === 'prospect_filings' ? (filings[q._filters.prospect_id] ?? null) : null, error: null });
    q.update = (patch) => { q._op = 'update'; q._patch = patch; return q; };
    q.insert = (row) => { captured.inserts.push({ table, row }); return Promise.resolve({ error: null }); };
    q.then = (resolve) => resolve(resolveMany(q));
    return q;
  }
  function resolveMany(q) {
    if (q._op === 'update') {
      captured.updates.push({ table: q._table, patch: q._patch, filters: q._filters });
      return { data: null, error: null };
    }
    if (q._table === 'prospects') {
      if ('matched_to_account_id' in q._filters) return { data: auditProspects[q._filters.matched_to_account_id] ?? [], error: null };
      return { data: q._from === 0 ? prospects : [], error: null };
    }
    if (q._table === 'accounts') return { data: q._from === 0 ? accounts : [], error: null };
    if (q._table === 'prospect_sources') return { data: sources[q._filters.prospect_id] ?? [], error: null };
    return { data: [], error: null };
  }
  return { client: { from: builder }, captured };
}

const logger = { debug() {}, info() {}, warn() {}, error() {} };
beforeEach(() => vi.clearAllMocks());

describe('runBackfillNormalize', () => {
  const prospect13f = { id: 'p1', firm_name: 'Acme', source: 'sec_13f', ...PATCH_AM };

  it('calls normalizeFirm with { recompute: true } (freeze-fix preserved)', async () => {
    const { client } = makeSupabase({ prospects: [prospect13f], sources: { p1: [{ source: 'sec_13f', signals: {} }] } });
    await runBackfillNormalize({ supabase: client, logger });
    expect(normalizeFirm).toHaveBeenCalled();
    const opts = normalizeFirm.mock.calls[0][4];
    expect(opts).toEqual({ recompute: true });
  });

  it('writes config_snapshot = effective refs when jobRunId is given', async () => {
    const { client, captured } = makeSupabase({ prospects: [prospect13f], sources: { p1: [{ source: 'sec_13f', signals: {} }] } });
    await runBackfillNormalize({ supabase: client, logger, jobRunId: 'run-1' });
    const snap = captured.updates.find(u => u.table === 'job_runs' && u.patch.config_snapshot);
    expect(snap).toBeTruthy();
    expect(snap.patch.config_snapshot).toEqual(REFS);
    expect(snap.filters).toEqual({ id: 'run-1' });
  });

  it('does NOT write config_snapshot without a jobRunId (CLI path)', async () => {
    const { client, captured } = makeSupabase({ prospects: [prospect13f], sources: { p1: [{ source: 'sec_13f', signals: {} }] } });
    await runBackfillNormalize({ supabase: client, logger });
    expect(captured.updates.find(u => u.table === 'job_runs')).toBeUndefined();
  });

  it('rows_changed = 0 when the derived output is identical (idempotent re-run)', async () => {
    const { client } = makeSupabase({ prospects: [prospect13f], sources: { p1: [{ source: 'sec_13f', signals: {} }] } });
    const stats = await runBackfillNormalize({ supabase: client, logger });
    expect(stats.prospectsNormalized).toBe(1);
    expect(stats.rows_changed).toBe(0); // processed 1, changed 0
  });

  it('rows_changed counts a prospect whose derived output actually changed', async () => {
    const stale = { id: 'p2', firm_name: 'Beta', source: 'sec_13f', segment_canonical: 'unknown' /* differs from PATCH_AM */ };
    const { client } = makeSupabase({ prospects: [stale], sources: { p2: [{ source: 'sec_13f', signals: {} }] } });
    const stats = await runBackfillNormalize({ supabase: client, logger });
    expect(stats.rows_changed).toBe(1);
  });
});

describe('runBackfillFitScores', () => {
  const P = (id, fit_score) => ({ id, firm_name: id, source: 'sec_13f', segment_canonical: 'asset_manager', normalized_signals: {}, fit_score });

  it('recomputes via computeFitScore and writes fit_score + a prospect_fit_scores row', async () => {
    const { client, captured } = makeSupabase({ prospects: [P('p1', 50)] });
    await runBackfillFitScores({ supabase: client, logger });
    expect(captured.updates.find(u => u.table === 'prospects' && u.patch.fit_score === 85)).toBeTruthy();
    expect(captured.inserts.find(i => i.table === 'prospect_fit_scores')).toBeTruthy();
  });

  it('rows_changed counts CHANGED scores, not processed (idempotency)', async () => {
    // p1: stored 85 == recomputed 85 → unchanged; p2: stored 50 != 85 → changed
    const { client } = makeSupabase({ prospects: [P('p1', 85), P('p2', 50)] });
    const stats = await runBackfillFitScores({ supabase: client, logger });
    expect(stats.scored).toBe(2);
    expect(stats.rows_changed).toBe(1);
  });

  it('writes config_snapshot = { weights, segmentTiers, tierRatios } with a jobRunId', async () => {
    const { client, captured } = makeSupabase({ prospects: [P('p1', 85)] });
    await runBackfillFitScores({ supabase: client, logger, jobRunId: 'run-2' });
    const snap = captured.updates.find(u => u.table === 'job_runs' && u.patch.config_snapshot);
    expect(snap.patch.config_snapshot).toEqual({ weights: { aum_tier: 20 }, segmentTiers: {}, tierRatios: {} });
  });
});

describe('runConnector dispatch', () => {
  it('backfill_normalize → runBackfillNormalize (reaches normalizeFirm)', async () => {
    const { client } = makeSupabase({ prospects: [{ id: 'p1', firm_name: 'Acme', source: 'sec_13f', ...PATCH_AM }], sources: { p1: [{ source: 'sec_13f', signals: {} }] } });
    const stats = await runConnector('backfill_normalize', {}, { supabase: client, logger, jobRunId: 'run-x' });
    expect(normalizeFirm).toHaveBeenCalled();
    expect(stats).toHaveProperty('prospectsNormalized');
    expect(stats).toHaveProperty('rows_changed');
  });

  it('backfill_fit_scores → runBackfillFitScores (writes fit_score)', async () => {
    const { client, captured } = makeSupabase({ prospects: [{ id: 'p1', firm_name: 'x', source: 'sec_13f', segment_canonical: 'asset_manager', normalized_signals: {}, fit_score: 50 }] });
    const stats = await runConnector('backfill_fit_scores', {}, { supabase: client, logger });
    expect(stats).toHaveProperty('scored');
    expect(captured.updates.find(u => u.table === 'prospects' && u.patch.fit_score === 85)).toBeTruthy();
  });
});

describe('one source, two callers', () => {
  it('both CLI scripts import the extracted fn from src/engine/backfills.js', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const norm = readFileSync(join(here, '../scripts/backfill-normalize.js'), 'utf8');
    const fit = readFileSync(join(here, '../scripts/backfill-fit-scores.js'), 'utf8');
    expect(norm).toMatch(/import\s*\{\s*runBackfillNormalize\s*\}\s*from\s*['"][^'"]*engine\/backfills\.js['"]/);
    expect(fit).toMatch(/import\s*\{\s*runBackfillFitScores\s*\}\s*from\s*['"][^'"]*engine\/backfills\.js['"]/);
    // and the loops are gone from the scripts (thin wrappers only)
    expect(norm).not.toMatch(/backfillProspects|while \(true\)/);
    expect(fit).not.toMatch(/PAGE_SIZE|while \(true\)/);
  });
});
