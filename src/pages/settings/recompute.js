// Recompute mapping + staleness logic (stage C4). Pure — unit-tested, no React,
// no supabase. Which recompute a config surface needs, and whether stored data
// is stale relative to the last recompute.
//
// A config edit only takes effect after the affected data is re-derived. Two
// recompute jobs exist (migration 033 definitions, executed by the C1 worker):
//   backfill_normalize   → re-derives normalized_signals + canonical fields
//                          (segment / asset-class relevance / ICP) for prospects.
//   backfill_fit_scores  → recomputes fit_score.
// Config-driven so adding a surface is a table edit, not new branching.

// Recompute GROUPS: the job that re-derives them, the config tables that dirty
// them, and the prospects timestamp a completed run stamps forward.
export const RECOMPUTE_GROUPS = {
  normalize: {
    jobType: 'backfill_normalize',
    stampColumn: 'normalized_at',
    label: 'normalization (segment / asset-class relevance / ICP)',
    tables: [
      'asset_class_relevance_config',
      'served_asset_classes',
      'relevance_verdict_actions',
      'relevance_adv_name_flags',
      'segment_name_signals',
      'icp_filter_config',
    ],
  },
  fit: {
    jobType: 'backfill_fit_scores',
    stampColumn: 'fit_score_computed_at',
    label: 'fit scores',
    tables: ['fit_tier_ratios', 'scoring_config'],
  },
};

// Which surface maps to which recompute group. matcher edits have NO prospect
// recompute (they change dedup scoring at match time, not a stored backfill) →
// null, no staleness/recompute offered.
const SURFACE_GROUP = {
  relevance: 'normalize',
  segment: 'normalize',
  fit: 'fit',
};

export function recomputeGroup(surface) {
  const key = SURFACE_GROUP[surface];
  return key ? RECOMPUTE_GROUPS[key] : null;
}

export function jobTypeForSurface(surface) {
  return recomputeGroup(surface)?.jobType ?? null;
}

// Job-run statuses that count as a successful recompute (a warned run still
// completed and stamped the data forward).
export const RECOMPUTE_SUCCESS_STATUSES = ['completed', 'completed_with_warnings'];
export function isRecomputeSuccess(status) {
  return RECOMPUTE_SUCCESS_STATUSES.includes(status);
}
export function isRecomputeActive(status) {
  return status === 'queued' || status === 'running';
}

/**
 * Stored data is stale when a config change is newer than the last successful
 * recompute. No change → never stale. A change but no recompute yet → stale.
 */
export function isStale({ lastChangeAt, lastRecomputeAt }) {
  if (!lastChangeAt) return false;
  if (!lastRecomputeAt) return true;
  return new Date(lastChangeAt).getTime() > new Date(lastRecomputeAt).getTime();
}

export function stalenessMessage(affected) {
  const n = affected ?? 0;
  return `Config changed — ${n} prospect${n === 1 ? '' : 's'} reflect the previous settings.`;
}
