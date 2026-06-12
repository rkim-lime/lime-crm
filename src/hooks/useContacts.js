import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const FIELDS = 'id,first_name,last_name,email,phone,title,segment,tier,status,lead_score,jurisdiction,kyc_status,aml_status,asset_classes,order_routing,uses_fix,uses_rest_api,source,notes,owner_id,created_at';

async function logActivity(payload) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('activities').insert({
      type: 'note', occurred_at: new Date().toISOString(),
      created_by: user?.id, ...payload,
    });
  } catch { /* best-effort */ }
}

export function useContacts(filters = {}) {
  return useQuery({
    queryKey: ['contacts', filters],
    queryFn: async () => {
      let q = supabase.from('contacts').select(FIELDS).order('last_name');
      if (filters.tier)    q = q.eq('tier', filters.tier);
      if (filters.status)  q = q.eq('status', filters.status);
      if (filters.segment) q = q.eq('segment', filters.segment);
      if (filters.search)  q = q.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useContact(id) {
  return useQuery({
    queryKey: ['contact', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useContactAccounts(contactId) {
  return useQuery({
    queryKey: ['contact-accounts', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_contacts')
        .select('role,is_primary,account:accounts(id,name,segment,tier,status)')
        .eq('contact_id', contactId);
      if (error) throw error;
      return data;
    },
    enabled: !!contactId,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('contacts')
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: 'Contact created', contact_id: data.id });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data, error } = await supabase.from('contacts').update(payload).eq('id', id).select().single();
      if (error) throw error;
      await logActivity({ title: 'Contact updated', contact_id: id });
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', id] });
    },
  });
}

export function useLinkContactToAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, accountId, role = '', isPrimary = false }) => {
      const { error } = await supabase
        .from('account_contacts')
        .insert({ contact_id: contactId, account_id: accountId, role, is_primary: isPrimary });
      if (error) throw error;
    },
    onSuccess: (_, { contactId }) => {
      qc.invalidateQueries({ queryKey: ['contact-accounts', contactId] });
      qc.invalidateQueries({ queryKey: ['account-contacts'] });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.removeQueries({ queryKey: ['contact', id] });
    },
  });
}

export function useArchiveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data, error } = await supabase.from('contacts').update({ status: 'unsubscribed' }).eq('id', id).select().single();
      if (error) throw error;
      await logActivity({ title: 'Contact archived', contact_id: id });
      return data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', id] });
    },
  });
}

export function useContactMetrics(tier) {
  return useQuery({
    queryKey: ['contact-metrics', tier],
    queryFn: async () => {
      let q = supabase.from('contacts').select('id,lead_score,status');
      if (tier) q = q.eq('tier', tier);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const scored = rows.filter(c => c.lead_score != null);
      const avgLeadScore = scored.length
        ? Math.round(scored.reduce((s, c) => s + c.lead_score, 0) / scored.length)
        : 0;
      return { totalCount: rows.length, avgLeadScore };
    },
  });
}

export function useUnlinkContactFromAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, accountId }) => {
      const { error } = await supabase
        .from('account_contacts')
        .delete()
        .eq('contact_id', contactId)
        .eq('account_id', accountId);
      if (error) throw error;
    },
    onSuccess: (_, { contactId }) => {
      qc.invalidateQueries({ queryKey: ['contact-accounts', contactId] });
      qc.invalidateQueries({ queryKey: ['account-contacts'] });
    },
  });
}
