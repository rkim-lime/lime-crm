import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const FIELDS = 'id,type,title,body,occurred_at,account_id,contact_id,deal_id,task_id,created_by,account:accounts(id,name),contact:contacts(id,first_name,last_name),deal:deals(id,name)';

export function useActivities(filters = {}) {
  return useQuery({
    queryKey: ['activities', filters],
    queryFn: async () => {
      let q = supabase.from('activities').select(FIELDS).order('occurred_at', { ascending: false }).limit(filters.limit ?? 50);
      if (filters.account) q = q.eq('account_id', filters.account);
      if (filters.contact) q = q.eq('contact_id', filters.contact);
      if (filters.deal)    q = q.eq('deal_id', filters.deal);
      if (filters.type)    q = q.eq('type', filters.type);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.from('activities').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
  });
}
