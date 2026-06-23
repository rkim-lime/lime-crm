import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const DEF_FIELDS = `
  id, name, description, job_type, config, is_active, created_at, updated_at,
  schedules:job_schedules(
    id, schedule_type, recurrence, cron_expression,
    hour_of_day, minute_of_hour, day_of_week, day_of_month, timezone,
    is_active, next_run_at, created_at, updated_at
  )
`;

const RUN_FIELDS = `
  id, job_definition_id, status, trigger_source, config_snapshot,
  queued_at, claimed_at, started_at, finished_at,
  log, stats, error_message, claimed_by, created_at,
  definition:job_definition_id(id, name, job_type)
`;

// ── Job Definitions ───────────────────────────────────────────────────────────

export function useJobDefinitions() {
  return useQuery({
    queryKey: ['job_definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_definitions')
        .select(DEF_FIELDS)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useJobDefinition(id) {
  return useQuery({
    queryKey: ['job_definition', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_definitions')
        .select(DEF_FIELDS)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateJobDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, description, job_type, config }) => {
      const { data, error } = await supabase
        .from('job_definitions')
        .insert({ name, description, job_type, config, is_active: true })
        .select(DEF_FIELDS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job_definitions'] }),
  });
}

export function useUpdateJobDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { data, error } = await supabase
        .from('job_definitions')
        .update(patch)
        .eq('id', id)
        .select(DEF_FIELDS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['job_definitions'] });
      qc.invalidateQueries({ queryKey: ['job_definition', data.id] });
    },
  });
}

export function useDeleteJobDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('job_definitions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job_definitions'] }),
  });
}

// ── Job Schedules ─────────────────────────────────────────────────────────────

export function useJobSchedules(definitionId) {
  return useQuery({
    queryKey: ['job_schedules', definitionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_schedules')
        .select('*')
        .eq('job_definition_id', definitionId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!definitionId,
  });
}

export function useUpsertJobSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, job_definition_id, ...fields }) => {
      if (id) {
        const { data, error } = await supabase
          .from('job_schedules')
          .update(fields)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('job_schedules')
        .insert({ job_definition_id, ...fields })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['job_definitions'] });
      qc.invalidateQueries({ queryKey: ['job_schedules', variables.job_definition_id] });
    },
  });
}

export function useDeleteJobSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('job_schedules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job_definitions'] }),
  });
}

// ── Job Runs ──────────────────────────────────────────────────────────────────

export function useJobRuns({ limit = 50, definitionId } = {}) {
  return useQuery({
    queryKey: ['job_runs', { limit, definitionId }],
    queryFn: async () => {
      let q = supabase
        .from('job_runs')
        .select(RUN_FIELDS)
        .order('queued_at', { ascending: false })
        .limit(limit);
      if (definitionId) q = q.eq('job_definition_id', definitionId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: (query) => {
      const runs = query.state.data;
      if (!Array.isArray(runs)) return false;
      return runs.some(r => r.status === 'queued' || r.status === 'running') ? 3000 : false;
    },
  });
}

export function useJobRun(id) {
  return useQuery({
    queryKey: ['job_run', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_runs')
        .select(RUN_FIELDS)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (!run) return false;
      return (run.status === 'queued' || run.status === 'running') ? 3000 : false;
    },
  });
}

export function useTriggerJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ definition }) => {
      const { data, error } = await supabase
        .from('job_runs')
        .insert({
          job_definition_id: definition.id,
          config_snapshot:   definition.config ?? {},
          trigger_source:    'manual',
          status:            'queued',
          queued_at:         new Date().toISOString(),
        })
        .select(RUN_FIELDS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job_runs'] }),
  });
}

export function useCancelJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('job_runs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'queued');
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['job_runs'] });
      qc.invalidateQueries({ queryKey: ['job_run', id] });
    },
  });
}
