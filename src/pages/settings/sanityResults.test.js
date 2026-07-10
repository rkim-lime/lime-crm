import { describe, it, expect } from 'vitest';
import {
  runStatusMeta,
  RUN_STATUS_META,
  sanityDotColor,
  flatStatEntries,
  sanitySummaryParts,
  classifyObserved,
  collectResolution,
  buildObservedTable,
  sortResults,
  looksLikeUuid,
} from './sanityResults';

const PID_A = '9c89b2a7-5e9a-40f7-af8c-b4f442ab8adc';
const PID_B = '11111111-2222-3333-4444-555555555555';
const DEDUP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('runStatusMeta / STATUS_MAP', () => {
  it('renders completed_with_warnings as its own yellow entry, NOT the queued fallback', () => {
    const m = runStatusMeta('completed_with_warnings');
    expect(m).toBe(RUN_STATUS_META.completed_with_warnings);
    expect(m.label).toBe('Completed (warnings)');
    expect(m.color).toBe('#ca8a04');
    expect(m).not.toBe(RUN_STATUS_META.queued);
  });
  it('falls back to queued for a genuinely unknown status', () => {
    expect(runStatusMeta('nonsense')).toBe(RUN_STATUS_META.queued);
  });
});

describe('sanityDotColor (runs-table dot logic)', () => {
  it('red when any fail', () => {
    expect(sanityDotColor({ fail: 1, warn: 0 })).toBe('#dc2626');
    expect(sanityDotColor({ fail: 2, warn: 3 })).toBe('#dc2626'); // fail dominates warn
  });
  it('yellow when warn but no fail', () => {
    expect(sanityDotColor({ fail: 0, warn: 1 })).toBe('#ca8a04');
  });
  it('none when clean or absent', () => {
    expect(sanityDotColor({ fail: 0, warn: 0 })).toBeNull();
    expect(sanityDotColor(null)).toBeNull();
  });
});

describe('flatStatEntries — no [object Object]', () => {
  it('excludes the nested sanity object from the flat tiles', () => {
    const entries = flatStatEntries({ prospects: 5, merges: 2, sanity: { checked: 13, pass: 13 } });
    const keys = entries.map(([k]) => k);
    expect(keys).toContain('prospects');
    expect(keys).toContain('merges');
    expect(keys).not.toContain('sanity');
    // every surviving value is a primitive (never an object → never [object Object])
    for (const [, v] of entries) expect(typeof v).not.toBe('object');
  });
});

describe('sanitySummaryParts', () => {
  it('returns primitive tallies (not [object Object])', () => {
    const parts = sanitySummaryParts({ checked: 13, pass: 12, warn: 0, fail: 1, rows_changed: 4 });
    expect(parts.map((p) => p.key)).toEqual(['checked', 'pass', 'warn', 'fail', 'rows_changed']);
    for (const p of parts) expect(typeof p.value).toBe('number');
  });
  it('omits rows_changed when null', () => {
    const parts = sanitySummaryParts({ checked: 13, pass: 13, warn: 0, fail: 0, rows_changed: null });
    expect(parts.map((p) => p.key)).not.toContain('rows_changed');
  });
});

describe('sortResults', () => {
  it('orders fail → warn → pass', () => {
    const sorted = sortResults([
      { status: 'pass' }, { status: 'fail' }, { status: 'pass' }, { status: 'warn' },
    ]);
    expect(sorted.map((r) => r.status)).toEqual(['fail', 'warn', 'pass', 'pass']);
  });
});

describe('classifyObserved', () => {
  it('drift → drift', () => {
    expect(classifyObserved('drift_stored_matches_derived', { drift: [{}], drift_count: 1 })).toBe('drift');
  });
  it('sample array → table', () => {
    expect(classifyObserved('aum_nonnegative', { negatives: 2, samples: [PID_A] })).toBe('table');
  });
  it('count-only → json fallback', () => {
    expect(classifyObserved('completeness_range', { out_of_range: 3 })).toBe('json');
  });
});

describe('collectResolution — batch ids, no N+1', () => {
  it('gathers prospect ids from drift + id-samples + object samples, dedup separately, de-duped', () => {
    const results = [
      { check_key: 'drift_stored_matches_derived', observed: { drift: [{ prospect_id: PID_A }, { prospect_id: PID_A }] } },
      { check_key: 'aum_nonnegative', observed: { negatives: 1, samples: [PID_B] } },
      { check_key: 'layer3_mirrors_layer2', observed: { samples: [{ id: PID_A, mismatches: ['size_tier'] }] } },
      { check_key: 'source_implies_source_row', observed: { samples: ['ACME CAPITAL'] } }, // firm names, not ids
      { check_key: 'dedup_resolved_has_match_reason', observed: { samples: [DEDUP_ID] } },
    ];
    const { prospectIds, dedupIds } = collectResolution(results);
    expect(prospectIds.sort()).toEqual([PID_A, PID_B].sort()); // PID_A de-duped, firm-name NOT included
    expect(dedupIds).toEqual([DEDUP_ID]);
  });
});

describe('buildObservedTable', () => {
  const firmById = { [PID_A]: 'HHLR ADVISORS, LTD.', [PID_B]: 'ACME CAPITAL' };

  it('drift → [Firm | Signal | Stored → Derived], resolves prospect_id, surfaces undescribed + more', () => {
    const observed = {
      drift: [{ prospect_id: PID_A, signal_key: 'turnover_pct', stored: 162.85, derived: 63.35 }],
      drift_count: 3, undescribed: ['foo_signal'],
    };
    const t = buildObservedTable('drift_stored_matches_derived', observed, { firmById });
    expect(t.columns).toEqual(['Firm', 'Signal', 'Stored → Derived']);
    expect(t.rows[0]).toEqual(['HHLR ADVISORS, LTD.', 'turnover_pct', '162.85 → 63.35']);
    expect(t.more).toBe(2);
    expect(t.note).toContain('foo_signal');
  });

  it('id-sample invariant → [Firm], resolves ids to firm names', () => {
    const t = buildObservedTable('aum_nonnegative', { negatives: 1, samples: [PID_B] }, { firmById });
    expect(t.columns).toEqual(['Firm']);
    expect(t.rows).toEqual([['ACME CAPITAL']]);
  });

  it('object-sample invariant (layer3) → [Firm | mismatches]', () => {
    const observed = { mismatched_rows: 1, samples: [{ id: PID_A, mismatches: ['segment_canonical', 'size_tier'] }] };
    const t = buildObservedTable('layer3_mirrors_layer2', observed, { firmById });
    expect(t.columns).toEqual(['Firm', 'mismatches']);
    expect(t.rows[0][0]).toBe('HHLR ADVISORS, LTD.');
  });

  it('dedup → [Firm(s) | dedup row], resolves via dedupById', () => {
    const dedupById = { [DEDUP_ID]: { id: DEDUP_ID, prospect_id: PID_B, matched_name: 'ACME CAP LLC' } };
    const t = buildObservedTable('dedup_resolved_has_match_reason', { samples: [DEDUP_ID] }, { firmById, dedupById });
    expect(t.columns).toEqual(['Firm(s)', 'Dedup queue row']);
    expect(t.rows[0][0]).toContain('ACME CAPITAL');
    expect(t.rows[0][0]).toContain('ACME CAP LLC');
  });

  it('unknown / count-only shape → null (caller JSON-falls-back, never crashes)', () => {
    expect(buildObservedTable('completeness_range', { out_of_range: 3 })).toBeNull();
    expect(buildObservedTable('no_segment_over_90pct', { top_segment: 'hedge_fund', share: 0.4 })).toBeNull();
    expect(buildObservedTable('anything', undefined)).toBeNull();
  });

  it('unresolved id degrades to a short hash, never throws', () => {
    const t = buildObservedTable('aum_nonnegative', { samples: [PID_A] }, { firmById: {} });
    expect(t.rows[0][0]).toBe('9c89b2a7…');
  });
});

describe('looksLikeUuid', () => {
  it('accepts uuids, rejects names/numbers', () => {
    expect(looksLikeUuid(PID_A)).toBe(true);
    expect(looksLikeUuid('ACME CAPITAL')).toBe(false);
    expect(looksLikeUuid(42)).toBe(false);
  });
});
