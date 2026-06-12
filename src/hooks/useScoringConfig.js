import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { computeScore } from '../lib/scoring';

// ── Config fetch ──────────────────────────────────────────────────────────────

export function useScoringConfig() {
  return useQuery({
    queryKey: ['scoring-config'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scoring_config')
        .select('*')
        .order('sort_order');
      if (error) throw error;

      const grouped = { enterprise: {}, pro: {}, individual: {} };
      const rows = {};
      for (const row of (data ?? [])) {
        if (grouped[row.tier]) grouped[row.tier][row.criterion_key] = row.weight;
        rows[`${row.tier}:${row.criterion_key}`] = row;
      }
      return { grouped, rows, raw: data ?? [] };
    },
  });
}

// ── Computed score for a single record ───────────────────────────────────────

export function useComputedScore(tier, record) {
  const config = useScoringConfig();

  return useMemo(() => {
    if (!record || config.isLoading || !config.data) {
      return { score: 0, breakdown: [], isLoading: config.isLoading };
    }
    const weights = config.data.grouped[tier] ?? {};
    const { score, breakdown } = computeScore(tier, record, weights);
    return { score, breakdown, isLoading: false };
  }, [tier, record, config.data, config.isLoading]);
}

// ── Upsert weights for a tier ─────────────────────────────────────────────────

export function useUpdateScoringConfig() {
  const qc = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ tier, criteria }) => {
      const userId = session?.user?.id;
      const rows = criteria.map(c => ({
        tier,
        criterion_key: c.criterion_key,
        weight:        c.weight,
        is_active:     c.is_active ?? true,
        updated_by:    userId,
      }));
      const { error } = await supabase
        .from('scoring_config')
        .upsert(rows, { onConflict: 'tier,criterion_key' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scoring-config'] }),
  });
}

// ── Recalculate scores ────────────────────────────────────────────────────────

export function useRecalculateScores() {
  const qc = useQueryClient();
  const [state, setState] = useState({ isRunning: false, progress: 0, total: 0, error: null });

  const run = async ({ tier, mode, weights }) => {
    if (mode === 'new_only') return;
    if (mode === 'scheduled') {
      localStorage.setItem('lime_crm_scheduled_recalc', JSON.stringify({
        tier, scheduledAt: new Date().toISOString(),
      }));
      return;
    }

    setState({ isRunning: true, progress: 0, total: 0, error: null });
    try {
      let records = [];
      let table = '';
      let recordType = '';

      if (tier === 'individual') {
        const { data, error } = await supabase.from('leads').select('*');
        if (error) throw error;
        records = data ?? [];
        table = 'leads'; recordType = 'lead';
      } else if (tier === 'enterprise') {
        const { data, error } = await supabase.from('accounts').select('*').eq('tier', 'enterprise');
        if (error) throw error;
        records = data ?? [];
        table = 'accounts'; recordType = 'account';
      } else {
        const { data, error } = await supabase.from('contacts').select('*').eq('tier', 'pro');
        if (error) throw error;
        records = data ?? [];
        table = 'contacts'; recordType = 'contact';
      }

      setState(s => ({ ...s, total: records.length }));
      const CHUNK = 50;
      const weightSnapshot = weights ?? {};
      const historyRows = [];

      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        for (const record of chunk) {
          const { score } = computeScore(tier, record, weightSnapshot);
          historyRows.push({
            record_type: recordType, record_id: record.id,
            score, weights_snapshot: weightSnapshot, triggered_by: 'weight_change',
          });
          if (table === 'leads' || table === 'contacts') {
            await supabase.from(table).update({ lead_score: score }).eq('id', record.id);
          }
        }
        setState(s => ({ ...s, progress: Math.min(i + CHUNK, records.length) }));
        await new Promise(r => setTimeout(r, 0));
      }

      if (historyRows.length) {
        await supabase.from('score_history').insert(historyRows);
      }

      setState(s => ({ ...s, isRunning: false, progress: s.total }));
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['score-history'] });
    } catch (err) {
      setState(s => ({ ...s, isRunning: false, error: err.message }));
    }
  };

  return { ...state, run };
}

// ── Score history for a record ────────────────────────────────────────────────

export function useScoreHistory(recordType, recordId) {
  return useQuery({
    queryKey: ['score-history', recordType, recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_history')
        .select('*')
        .eq('record_type', recordType)
        .eq('record_id', recordId)
        .order('calculated_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!(recordType && recordId),
  });
}
