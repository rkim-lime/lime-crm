// Read/write hooks for the tier-1 config surfaces (Config UI, stage C2).
//
// All writes go through the normal authenticated supabase client, so:
//   • the migration-032 admin-write RLS policies gate them (non-admins are
//     rejected — the UI also hides controls for non-admins), and
//   • the config_change_log trigger fires with the editor's JWT (request.jwt.claim.sub
//     → actor_user_id / actor_label). No service_role, no bypass.
//
// Soft-disable only: is_active toggles, never DELETE.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── asset_class_relevance_config (single row, id = 1) ──────────────────────────
export function useRelevanceConfig() {
  return useQuery({
    queryKey: ['relevance_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_class_relevance_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
export function useUpdateRelevanceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates) => {
      const { error } = await supabase
        .from('asset_class_relevance_config')
        .update({ ...updates, updated_at: new Date().toISOString(), updated_by: await currentUserId() })
        .eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relevance_config'] }),
  });
}

// ── matcher_config (key/value rows) ───────────────────────────────────────────
export function useMatcherConfig() {
  return useQuery({
    queryKey: ['matcher_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matcher_config').select('key, value, category, description').order('category').order('key');
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function useUpdateMatcherConfig() {
  const qc = useQueryClient();
  return useMutation({
    // { key, value } — value stored as text; the engine parses it.
    mutationFn: async ({ key, value }) => {
      const { error } = await supabase
        .from('matcher_config').update({ value: String(value) }).eq('key', key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matcher_config'] }),
  });
}

// ── served_asset_classes (toggle served per bucket) ───────────────────────────
export function useServedAssetClasses() {
  return useQuery({
    queryKey: ['served_asset_classes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('served_asset_classes').select('bucket_key, label, served, is_active, sort_order').order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function useUpdateServedAssetClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket_key, patch }) => {
      const { error } = await supabase.from('served_asset_classes').update(patch).eq('bucket_key', bucket_key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['served_asset_classes'] }),
  });
}

// ── relevance_verdict_actions (verdict → action) ──────────────────────────────
export function useVerdictActions() {
  return useQuery({
    queryKey: ['verdict_actions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('relevance_verdict_actions').select('verdict, action, is_active').order('verdict');
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function useUpdateVerdictAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ verdict, patch }) => {
      const { error } = await supabase.from('relevance_verdict_actions').update(patch).eq('verdict', verdict);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdict_actions'] }),
  });
}

// ── segment_name_signals (list; pattern read-only this stage) ─────────────────
export function useSegmentNameSignals() {
  return useQuery({
    queryKey: ['segment_name_signals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('segment_name_signals')
        .select('id, pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order, is_active')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function useUpsertSegmentNameSignal() {
  const qc = useQueryClient();
  return useMutation({
    // { id?, ...fields }: update when id present, else insert a new rule.
    mutationFn: async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('segment_name_signals').update(fields).eq('id', id)
        : supabase.from('segment_name_signals').insert(fields);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segment_name_signals'] }),
  });
}

// ── relevance_adv_name_flags (list; pattern read-only this stage) ─────────────
export function useAdvNameFlags() {
  return useQuery({
    queryKey: ['adv_name_flags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('relevance_adv_name_flags')
        .select('id, pattern, implied_class, verdict, confidence, sort_order, is_active')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function useUpsertAdvNameFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('relevance_adv_name_flags').update(fields).eq('id', id)
        : supabase.from('relevance_adv_name_flags').insert(fields);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adv_name_flags'] }),
  });
}

// ── segment options (taxonomy 'segment' value_keys) for dropdowns ─────────────
export function useSegmentOptions() {
  return useQuery({
    queryKey: ['segment_options'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: tax } = await supabase
        .from('taxonomies').select('id').eq('taxonomy_key', 'segment').maybeSingle();
      if (!tax) return [];
      const { data, error } = await supabase
        .from('taxonomy_values').select('value_key, label').eq('taxonomy_id', tax.id).order('value_key');
      if (error) throw error;
      return data ?? [];
    },
  });
}
