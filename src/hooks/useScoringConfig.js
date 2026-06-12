import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { computeScore } from '../lib/scoring';

const SCORE_TYPES = ['lead','deal','contact_health','account_health'];

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

      const criteria    = { lead: [], deal: [], contact_health: [], account_health: [] };
      const weightsOnly = { lead: {}, deal: {}, contact_health: {}, account_health: {} };

      for (const row of (data ?? [])) {
        const st = row.score_type;
        if (!SCORE_TYPES.includes(st)) continue;
        criteria[st].push(row);
        if (row.is_active) weightsOnly[st][row.criterion_key] = row.weight;
      }

      return { criteria, weightsOnly, raw: data ?? [] };
    },
  });
}

// ── Computed score for a single record ───────────────────────────────────────

export function useComputedScore(scoreType, record, extraParams) {
  const config = useScoringConfig();

  return useMemo(() => {
    if (!record || config.isLoading || !config.data) {
      return { score: 0, availableScore: 0, breakdown: [], isLoading: config.isLoading };
    }
    const weights = config.data.weightsOnly[scoreType] ?? {};
    const { score, availableScore, breakdown } = computeScore(scoreType, record, weights, extraParams ?? {});
    return { score, availableScore, breakdown, isLoading: false };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreType, record, config.data, config.isLoading, extraParams]);
}

// ── Upsert weights for a score type ──────────────────────────────────────────

export function useUpdateScoringConfig() {
  const qc = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ scoreType, criteria }) => {
      const userId = session?.user?.id;
      const now = new Date().toISOString();
      const rows = criteria.map(c => ({
        score_type:           scoreType,
        tier:                 c.tier ?? 'enterprise',
        criterion_key:        c.criterion_key,
        label:                c.label,
        description:          c.description,
        weight:               c.weight,
        is_active:            c.is_active ?? true,
        sort_order:           c.sort_order,
        requires_integration: c.requires_integration ?? false,
        integration_label:    c.integration_label ?? null,
        updated_by:           userId,
        updated_at:           now,
      }));
      const { error } = await supabase
        .from('scoring_config')
        .upsert(rows, { onConflict: 'score_type,criterion_key' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scoring-config'] }),
  });
}

// ── Recalculate scores ────────────────────────────────────────────────────────

export function useRecalculateScores() {
  const qc = useQueryClient();
  const [state, setState] = useState({ isRunning: false, progress: 0, total: 0, error: null });

  const run = async ({ scoreType, mode, weights }) => {
    if (mode === 'new_only') return;
    if (mode === 'scheduled') {
      localStorage.setItem('lime_crm_scheduled_recalc', JSON.stringify({
        scoreType, scheduledAt: new Date().toISOString(),
      }));
      return;
    }

    setState({ isRunning: true, progress: 0, total: 0, error: null });
    try {
      let records = [];
      let table = '';
      let recordType = '';
      let scoreCol = '';
      let extraParamsMap = {};

      if (scoreType === 'lead') {
        const { data, error } = await supabase.from('leads').select('*');
        if (error) throw error;
        records = data ?? []; table = 'leads'; recordType = 'lead'; scoreCol = 'lead_score';

      } else if (scoreType === 'deal') {
        const { data, error } = await supabase
          .from('deals')
          .select('*,account:accounts(id,aum_usd,kyc_status,avg_daily_volume_usd,asset_classes,status)');
        if (error) throw error;
        records = data ?? []; table = 'deals'; recordType = 'deal'; scoreCol = 'deal_score';

      } else if (scoreType === 'contact_health') {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .eq('tier', 'individual');
        if (error) throw error;
        records = data ?? []; table = 'contacts'; recordType = 'contact'; scoreCol = 'contact_health_score';

      } else if (scoreType === 'account_health') {
        const [accountsRes, tasksRes, activitiesRes] = await Promise.all([
          supabase.from('accounts').select('*').eq('tier', 'enterprise'),
          supabase.from('tasks').select('id,account_id,status,due_date'),
          supabase.from('activities').select('id,account_id,occurred_at').order('occurred_at', { ascending: false }),
        ]);
        if (accountsRes.error) throw accountsRes.error;
        records = accountsRes.data ?? []; table = 'accounts'; recordType = 'account'; scoreCol = null;

        const now = new Date();
        for (const acc of records) {
          const accTasks = (tasksRes.data ?? []).filter(t => t.account_id === acc.id);
          const accActs  = (activitiesRes.data ?? []).filter(a => a.account_id === acc.id);
          const hasOverdueTasks = accTasks.some(
            t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < now
          );
          const latestAct = accActs[0];
          const daysSinceActivity = latestAct
            ? Math.floor((now - new Date(latestAct.occurred_at)) / 86_400_000)
            : null;
          extraParamsMap[acc.id] = { hasOverdueTasks, daysSinceActivity };
        }
      }

      setState(s => ({ ...s, total: records.length }));
      const CHUNK = 50;
      const historyRows = [];

      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        for (const record of chunk) {
          const extraParams = extraParamsMap[record.id] ?? {};
          const { score } = computeScore(scoreType, record, weights ?? {}, extraParams);
          historyRows.push({
            record_type: recordType, record_id: record.id,
            score, weights_snapshot: weights ?? {}, triggered_by: 'weight_change',
          });
          if (scoreCol) {
            await supabase.from(table).update({ [scoreCol]: score }).eq('id', record.id);
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
      qc.invalidateQueries({ queryKey: ['deals'] });
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
