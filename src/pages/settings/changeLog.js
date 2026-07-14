// config_change_log presentation helpers (stage C4). Pure — unit-tested.
// The log is trigger-written and append-only (migration 032): who / what table /
// column / old → new / when. Attribution: actor_label is the admin's profile
// name for UI edits, or the DB role ('postgres') for direct-SQL edits.

/** Client-side filtering over fetched rows — table / actor / date window. */
export function filterChangeLog(rows, { table, actor, since, until } = {}) {
  const sinceT = since ? new Date(since).getTime() : null;
  const untilT = until ? new Date(until).getTime() : null;
  return (rows ?? []).filter((r) => {
    if (table && r.table_name !== table) return false;
    if (actor && (r.actor_label ?? '') !== actor) return false;
    const t = new Date(r.created_at).getTime();
    if (sinceT != null && t < sinceT) return false;
    // `until` is an inclusive day → callers pass an end-of-day/next-day bound.
    if (untilT != null && t > untilT) return false;
    return true;
  });
}

/** Distinct non-empty values of a column, sorted — for filter dropdowns. */
export function distinctValues(rows, key) {
  return [...new Set((rows ?? []).map((r) => r[key]).filter((v) => v != null && v !== ''))].sort();
}

/** Render a jsonb/scalar value compactly for the log table. */
export function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The row's primary key, compactly (row_key jsonb → "k=v, k=v"). */
export function formatRowKey(rowKey) {
  if (rowKey == null || typeof rowKey !== 'object') return formatValue(rowKey);
  return Object.entries(rowKey).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ');
}

/**
 * One-line human description of a change entry.
 *   update  → "stage1_recall_threshold: 0.3 → 0.35"
 *   insert  → "row inserted"
 *   delete  → "row deleted"
 *   activate / deactivate → "activated" / "deactivated"
 */
export function describeChange(r) {
  switch (r.action) {
    case 'update':
      return `${r.column_name}: ${formatValue(r.old_value)} → ${formatValue(r.new_value)}`;
    case 'insert':
      return 'row inserted';
    case 'delete':
      return 'row deleted';
    case 'activate':
      return 'activated';
    case 'deactivate':
      return 'deactivated';
    default:
      return r.action;
  }
}
