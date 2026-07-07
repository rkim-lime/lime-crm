import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const QUEUE_FIELDS = `
  id, status, match_type, similarity, matched_name,
  prospect_id, matched_prospect_id, matched_account_id,
  resolved_at, resolved_by, created_at,
  prospect:prospects!dedup_queue_prospect_id_fkey(
    id, firm_name, estimated_aum_usd, position_count, portfolio_turnover_pct,
    equities_pct, options_present, fit_score, cik, status, inferred_segment, segment_canonical, source
  ),
  matched_prospect:prospects!dedup_queue_matched_prospect_id_fkey(
    id, firm_name, estimated_aum_usd, fit_score, cik, status
  ),
  matched_account:accounts!dedup_queue_matched_account_id_fkey(
    id, name, aum_usd, tier, status, cik
  )
`;

export function useDedupQueue({ status = 'pending', matchType = '' } = {}) {
  return useQuery({
    queryKey: ['dedup_queue', { status, matchType }],
    queryFn: async () => {
      let q = supabase
        .from('dedup_queue')
        .select(QUEUE_FIELDS)
        .order('created_at', { ascending: false });
      if (status)    q = q.eq('status', status);
      if (matchType) q = q.eq('match_type', matchType);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDedupQueueCount() {
  return useQuery({
    queryKey: ['dedup_count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('dedup_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}

export function useResolveDedup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ queueId, resolution, queue }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const flaggedId = queue.prospect_id;

      if (resolution === 'merged') {
        if (queue.match_type === 'prospect') {
          const survivorId = queue.matched_prospect_id;

          // Move sources — on unique conflict, the survivor's record wins, delete from flagged
          const { error: srcErr } = await supabase
            .from('prospect_sources')
            .update({ prospect_id: survivorId })
            .eq('prospect_id', flaggedId);
          if (srcErr?.code === '23505') {
            await supabase.from('prospect_sources').delete().eq('prospect_id', flaggedId);
          }

          // Move filings + holdings to survivor
          await supabase.from('prospect_filings').update({ prospect_id: survivorId }).eq('prospect_id', flaggedId);
          await supabase.from('prospect_holdings').update({ prospect_id: survivorId }).eq('prospect_id', flaggedId);

          // Archive the flagged prospect
          const { error } = await supabase
            .from('prospects')
            .update({ status: 'duplicate', is_audit_only: true })
            .eq('id', flaggedId);
          if (error) throw error;
        }

        if (queue.match_type === 'account') {
          const accountId = queue.matched_account_id;
          const p = queue.prospect;

          // Update account with latest SEC signals from the flagged prospect
          const accountUpdate = {
            sec_estimated_aum_usd:      p?.estimated_aum_usd      ?? null,
            sec_position_count:          p?.position_count          ?? null,
            sec_portfolio_turnover_pct:  p?.portfolio_turnover_pct  ?? null,
            sec_equities_pct:            p?.equities_pct            ?? null,
            sec_options_present:         p?.options_present         ?? null,
            sec_signals_updated_at:      now,
          };
          // Set CIK only if account doesn't already have one
          if (!queue.matched_account?.cik && p?.cik) accountUpdate.cik = p.cik;

          const { error: acctErr } = await supabase
            .from('accounts')
            .update(accountUpdate)
            .eq('id', accountId);
          if (acctErr) throw acctErr;

          // Archive the flagged prospect and link it to the account
          const { error } = await supabase
            .from('prospects')
            .update({
              status:                  'matched_to_account',
              is_audit_only:           true,
              matched_to_account_id:   accountId,
            })
            .eq('id', flaggedId);
          if (error) throw error;
        }
      }

      if (resolution === 'not_duplicate') {
        // Clear the duplicate flag — prospect becomes a normal new prospect
        const { error } = await supabase
          .from('prospects')
          .update({ status: 'new' })
          .eq('id', flaggedId);
        if (error) throw error;
      }

      // 'dismissed': no side effect on the prospect itself

      // Resolve the queue item
      const { error: qErr } = await supabase
        .from('dedup_queue')
        .update({ status: resolution, resolved_by: user?.id ?? null, resolved_at: now })
        .eq('id', queueId);
      if (qErr) throw qErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dedup_queue'] });
      qc.invalidateQueries({ queryKey: ['dedup_count'] });
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

// ── ICP filter config ─────────────────────────────────────────────────────────

export function useICPConfig() {
  return useQuery({
    queryKey: ['icp_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('icp_filter_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateICPConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('icp_filter_config')
        .upsert({
          id: 1,
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['icp_config'] }),
  });
}
