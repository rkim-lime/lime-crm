import { describe, it, expect } from 'vitest';
import {
  jobTypeForSurface, recomputeGroup, isStale, stalenessMessage,
  isRecomputeSuccess, isRecomputeActive,
} from './recompute.js';

describe('recompute mapping — each surface enqueues the right job type', () => {
  it('relevance + segment → backfill_normalize', () => {
    expect(jobTypeForSurface('relevance')).toBe('backfill_normalize');
    expect(jobTypeForSurface('segment')).toBe('backfill_normalize');
  });
  it('fit → backfill_fit_scores', () => {
    expect(jobTypeForSurface('fit')).toBe('backfill_fit_scores');
  });
  it('matcher → null (no prospect recompute)', () => {
    expect(jobTypeForSurface('matcher')).toBeNull();
    expect(recomputeGroup('matcher')).toBeNull();
  });
  it('normalize group owns the segment/relevance config tables', () => {
    const g = recomputeGroup('relevance');
    expect(g.tables).toContain('segment_name_signals');
    expect(g.tables).toContain('asset_class_relevance_config');
    expect(g.jobType).toBe('backfill_normalize');
  });
});

describe('staleness', () => {
  const T0 = '2026-07-14T10:00:00Z';
  const T1 = '2026-07-14T11:00:00Z';

  it('no config change → not stale', () => {
    expect(isStale({ lastChangeAt: null, lastRecomputeAt: T0 })).toBe(false);
  });
  it('change but no recompute yet → stale', () => {
    expect(isStale({ lastChangeAt: T0, lastRecomputeAt: null })).toBe(true);
  });
  it('change newer than last recompute → stale', () => {
    expect(isStale({ lastChangeAt: T1, lastRecomputeAt: T0 })).toBe(true);
  });
  it('recompute newer than last change → fresh (banner clears)', () => {
    expect(isStale({ lastChangeAt: T0, lastRecomputeAt: T1 })).toBe(false);
  });

  it('message pluralizes', () => {
    expect(stalenessMessage(1)).toBe('Config changed — 1 prospect reflect the previous settings.');
    expect(stalenessMessage(42)).toMatch(/42 prospects reflect/);
  });
});

describe('recompute run status helpers', () => {
  it('completed + completed_with_warnings count as success', () => {
    expect(isRecomputeSuccess('completed')).toBe(true);
    expect(isRecomputeSuccess('completed_with_warnings')).toBe(true);
    expect(isRecomputeSuccess('failed')).toBe(false);
    expect(isRecomputeSuccess('cancelled')).toBe(false);
  });
  it('queued + running count as active', () => {
    expect(isRecomputeActive('queued')).toBe(true);
    expect(isRecomputeActive('running')).toBe(true);
    expect(isRecomputeActive('completed')).toBe(false);
  });
});
