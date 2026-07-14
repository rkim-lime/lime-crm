// Config governance hooks (stage C4): the change-log reader, the staleness
// signal (config changed since the last recompute?), and the recompute enqueue.
//
// Recompute reuses the existing job infra verbatim — useTriggerJobRun inserts a
// queued job_run against the migration-033 backfill definition; the C1 worker
// executes it. Nothing new server-side.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useJobDefinitions, useTriggerJobRun } from './useJobs';
import { isStale, isRecomputeSuccess, isRecomputeActive } from '../pages/settings/recompute';

// ── config_change_log reader (admin-only via RLS) ─────────────────────────────
export function useChangeLog({ limit = 500 } = {}) {
  return useQuery({
    queryKey: ['config_change_log', { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('config_change_log')
        .select('id, table_name, row_key, action, column_name, old_value, new_value, actor_user_id, actor_label, created_at, note')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Staleness for one recompute group ─────────────────────────────────────────
// Compares the newest config change to the group's tables against the newest
// successful recompute of the group's job type. Polls while a recompute is in
// flight so the banner flips to "running" then clears automatically on completion.
export function useStaleness(group) {
  return useQuery({
    queryKey: ['staleness', group?.jobType],
    enabled: !!group,
    refetchInterval: (query) => (query.state.data?.active ? 3000 : false),
    queryFn: async () => {
      // 1. Newest config change touching this group's tables.
      const { data: chg, error: e1 } = await supabase
        .from('config_change_log')
        .select('created_at')
        .in('table_name', group.tables)
        .order('created_at', { ascending: false })
        .limit(1);
      if (e1) throw e1;
      const lastChangeAt = chg?.[0]?.created_at ?? null;

      // 2. Recompute runs for this group's job type (via its definitions).
      const { data: defs, error: e2 } = await supabase
        .from('job_definitions')
        .select('id')
        .eq('job_type', group.jobType);
      if (e2) throw e2;
      const defIds = (defs ?? []).map((d) => d.id);

      let lastRecomputeAt = null;
      let active = false;
      let activeRunId = null;
      if (defIds.length) {
        const { data: runs, error: e3 } = await supabase
          .from('job_runs')
          .select('id, status, finished_at')
          .in('job_definition_id', defIds)
          .order('queued_at', { ascending: false })
          .limit(20);
        if (e3) throw e3;
        for (const r of runs ?? []) {
          if (isRecomputeActive(r.status)) { active = true; activeRunId = activeRunId ?? r.id; }
          if (isRecomputeSuccess(r.status) && r.finished_at
            && (!lastRecomputeAt || new Date(r.finished_at) > new Date(lastRecomputeAt))) {
            lastRecomputeAt = r.finished_at;
          }
        }
      }

      const stale = isStale({ lastChangeAt, lastRecomputeAt });

      // 3. How many prospects still carry the pre-change derivation.
      let affected = 0;
      if (stale && lastChangeAt) {
        const { count, error: e4 } = await supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true })
          .or(`${group.stampColumn}.lt.${lastChangeAt},${group.stampColumn}.is.null`);
        if (e4) throw e4;
        affected = count ?? 0;
      }

      return { stale, affected, lastChangeAt, lastRecomputeAt, active, activeRunId };
    },
  });
}

// ── Recompute now — enqueue the group's backfill definition ───────────────────
export function useRecomputeNow(group) {
  const qc = useQueryClient();
  const defs = useJobDefinitions();
  const trigger = useTriggerJobRun();

  const mutation = useMutation({
    mutationFn: async () => {
      const def = (defs.data ?? []).find((d) => d.job_type === group.jobType && d.is_active);
      if (!def) throw new Error(`No active job definition for ${group.jobType} — apply migration 033.`);
      const run = await trigger.mutateAsync({ definition: def });
      return run;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staleness', group?.jobType] });
      qc.invalidateQueries({ queryKey: ['job_runs'] });
    },
  });

  return { run: () => mutation.mutateAsync(), pending: mutation.isPending, error: mutation.error, ready: !!defs.data };
}
