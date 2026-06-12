import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const FIELDS = 'id,name,stage,motion,tier,estimated_adv_usd,estimated_commission,close_date,probability,asset_classes,order_routing,colo,market_data,hosting,cross_connect,notes,lost_reason,competitor,owner_id,created_at,account_id,contact_id,account:accounts(id,name,segment,tier),contact:contacts(id,first_name,last_name)';

const VALID_ROUTING = ['sor', 'dma', 'commission_free'];
function normalizeRouting(arr) {
  if (!arr?.length) return [];
  return arr.filter(v => VALID_ROUTING.includes(v));
}

async function logActivity(payload) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('activities').insert({
      type: 'note', occurred_at: new Date().toISOString(),
      created_by: user?.id, ...payload,
    });
  } catch { /* best-effort */ }
}

export function useDeals(filters = {}) {
  return useQuery({
    queryKey: ['deals', filters],
    queryFn: async () => {
      let q = supabase.from('deals').select(FIELDS).order('created_at', { ascending: false });
      if (filters.tier)    q = q.eq('tier', filters.tier);
      if (filters.stage)   q = q.eq('stage', filters.stage);
      if (filters.motion)  q = q.eq('motion', filters.motion);
      if (filters.account) q = q.eq('account_id', filters.account);
      if (filters.search)  q = q.ilike('name', `%${filters.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data.map(row => ({ ...row, order_routing: normalizeRouting(row.order_routing) }));
    },
  });
}

export function useDeal(id) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select(`${FIELDS},activities(id,type,title,body,occurred_at)`)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('deals')
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: 'Deal created', deal_id: data.id, account_id: data.account_id });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, _prevStage, ...payload }) => {
      const { data, error } = await supabase.from('deals').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const title = _prevStage && payload.stage && _prevStage !== payload.stage
        ? `Stage changed: ${_prevStage} → ${payload.stage}`
        : 'Deal updated';
      await logActivity({ title, deal_id: id, type: _prevStage !== payload.stage ? 'deal_stage_change' : 'note', account_id: data.account_id });
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
    },
  });
}

export function usePromoteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, newTier }) => {
      const resetStage = newTier === 'individual' ? 'lead_in' : 'prospecting';
      const { data, error } = await supabase
        .from('deals')
        .update({ tier: newTier, stage: resetStage })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: `Deal promoted to ${newTier}`, deal_id: id, type: 'deal_stage_change', account_id: data.account_id });
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('deals').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.removeQueries({ queryKey: ['deal', id] });
    },
  });
}

export function useCloseDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, outcome, notes: closeNotes }) => {
      const { data: existing } = await supabase.from('deals').select('tier,account_id').eq('id', id).single();
      const isIndividual = existing?.tier === 'individual';
      const newStage = outcome === 'live'
        ? (isIndividual ? 'active_trader' : 'live')
        : (isIndividual ? 'dormant' : 'lost');
      const { data, error } = await supabase
        .from('deals')
        .update({ stage: newStage, closed_at: new Date().toISOString(), ...(closeNotes ? { notes: closeNotes } : {}) })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: `Deal ${outcome === 'live' ? 'closed won' : 'closed lost'}`, deal_id: id, type: 'deal_stage_change', account_id: existing?.account_id });
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
    },
  });
}
