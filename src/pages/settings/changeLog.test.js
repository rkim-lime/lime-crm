import { describe, it, expect } from 'vitest';
import { filterChangeLog, distinctValues, describeChange, formatRowKey, formatValue } from './changeLog.js';

const ROWS = [
  { id: 5, table_name: 'matcher_config', action: 'update', column_name: 'stage1_recall_threshold', old_value: 0.3, new_value: 0.35, actor_label: 'Richard Kim', created_at: '2026-07-14T11:00:00Z', row_key: { key: 'stage1_recall_threshold' } },
  { id: 4, table_name: 'segment_name_signals', action: 'insert', column_name: null, old_value: null, new_value: { pattern: 'wealth' }, actor_label: 'Richard Kim', created_at: '2026-07-13T09:00:00Z', row_key: { id: 42 } },
  { id: 3, table_name: 'segment_name_signals', action: 'deactivate', column_name: 'is_active', old_value: true, new_value: false, actor_label: 'postgres', created_at: '2026-07-10T08:00:00Z', row_key: { id: 7 } },
];

describe('filterChangeLog', () => {
  it('no filter → all rows', () => {
    expect(filterChangeLog(ROWS, {})).toHaveLength(3);
  });
  it('by table', () => {
    const r = filterChangeLog(ROWS, { table: 'segment_name_signals' });
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.table_name === 'segment_name_signals')).toBe(true);
  });
  it('by actor', () => {
    expect(filterChangeLog(ROWS, { actor: 'postgres' })).toHaveLength(1);
    expect(filterChangeLog(ROWS, { actor: 'Richard Kim' })).toHaveLength(2);
  });
  it('by date window (since inclusive-ish)', () => {
    expect(filterChangeLog(ROWS, { since: '2026-07-13T00:00:00Z' })).toHaveLength(2);
    expect(filterChangeLog(ROWS, { until: '2026-07-11T00:00:00Z' })).toHaveLength(1);
    expect(filterChangeLog(ROWS, { since: '2026-07-13T00:00:00Z', until: '2026-07-13T23:59:59Z' })).toHaveLength(1);
  });
  it('combined table + actor', () => {
    expect(filterChangeLog(ROWS, { table: 'segment_name_signals', actor: 'postgres' })).toHaveLength(1);
  });
});

describe('distinctValues', () => {
  it('distinct tables sorted', () => {
    expect(distinctValues(ROWS, 'table_name')).toEqual(['matcher_config', 'segment_name_signals']);
  });
  it('distinct actors sorted', () => {
    expect(distinctValues(ROWS, 'actor_label')).toEqual(['Richard Kim', 'postgres']);
  });
});

describe('describeChange', () => {
  it('update shows column + old→new', () => {
    expect(describeChange(ROWS[0])).toBe('stage1_recall_threshold: 0.3 → 0.35');
  });
  it('insert / deactivate', () => {
    expect(describeChange(ROWS[1])).toBe('row inserted');
    expect(describeChange(ROWS[2])).toBe('deactivated');
  });
});

describe('formatting', () => {
  it('formatValue handles null, object, scalar', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue({ pattern: 'x' })).toBe('{"pattern":"x"}');
    expect(formatValue(0.35)).toBe('0.35');
  });
  it('formatRowKey renders jsonb key', () => {
    expect(formatRowKey({ id: 42 })).toBe('id=42');
    expect(formatRowKey({ verdict: 'irrelevant' })).toBe('verdict=irrelevant');
  });
});
