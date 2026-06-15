import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const FIELDS = 'id,name,segment,tier,status,kyc_status,aml_status,asset_classes,strategy_asset_classes,sold_asset_classes,order_routing,colo,market_data,hosting,cross_connect,avg_daily_volume_usd,aum_usd,jurisdiction,website,notes,sales_owner_id,service_manager_id,created_at,sales_owner:sales_owner_id(id,full_name,email,avatar_url),service_manager:service_manager_id(id,full_name,email,avatar_url)';

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

export function useAccounts(filters = {}) {
  return useQuery({
    queryKey: ['accounts', filters],
    queryFn: async () => {
      let q = supabase.from('accounts').select(FIELDS).order('name');
      if (filters.tier)     q = q.eq('tier', filters.tier);
      if (filters.status)   q = q.eq('status', filters.status);
      if (filters.segment)  q = q.eq('segment', filters.segment);
      if (filters.search)   q = q.ilike('name', `%${filters.search}%`);
      if (filters.owner)    q = q.eq('sales_owner_id', filters.owner);
      if (filters.myOwner)  q = q.or(`sales_owner_id.eq.${filters.myOwner},service_manager_id.eq.${filters.myOwner}`);
      const { data, error } = await q;
      if (error) throw error;
      return data.map(row => ({ ...row, order_routing: normalizeRouting(row.order_routing) }));
    },
  });
}

export function useAccount(id) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*,sales_owner:sales_owner_id(id,full_name,email,avatar_url),service_manager:service_manager_id(id,full_name,email,avatar_url)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useAccountContacts(accountId) {
  return useQuery({
    queryKey: ['account-contacts', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_contacts')
        .select('role,is_primary,contact:contacts(id,first_name,last_name,email,title,status,lead_score)')
        .eq('account_id', accountId);
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          ...payload,
          created_by: user?.id,
          sales_owner_id: payload.sales_owner_id ?? user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: 'Account created', account_id: data.id });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data, error } = await supabase.from('accounts').update(payload).eq('id', id).select().single();
      if (error) throw error;
      await logActivity({ title: 'Account updated', account_id: id });
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account', id] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.removeQueries({ queryKey: ['account', id] });
    },
  });
}

export function useArchiveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data, error } = await supabase.from('accounts').update({ status: 'inactive' }).eq('id', id).select().single();
      if (error) throw error;
      await logActivity({ title: 'Account archived', account_id: id });
      return data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account', id] });
    },
  });
}
