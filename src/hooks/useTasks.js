import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const FIELDS = 'id,title,description,status,priority,due_date,completed_at,account_id,contact_id,deal_id,assigned_to,created_by,created_at,account:accounts(id,name),contact:contacts(id,first_name,last_name),deal:deals(id,name)';

export function useTasks(filters = {}) {
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: async () => {
      let q = supabase.from('tasks').select(FIELDS).order('due_date', { ascending: true, nullsFirst: false });
      if (filters.status)   q = q.eq('status', filters.status);
      if (filters.priority) q = q.eq('priority', filters.priority);
      if (filters.account)  q = q.eq('account_id', filters.account);
      if (filters.contact)  q = q.eq('contact_id', filters.contact);
      if (filters.deal)     q = q.eq('deal_id', filters.deal);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('tasks')
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data, error } = await supabase.from('tasks').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, currentStatus }) => {
      const done = currentStatus !== 'completed';
      const { data, error } = await supabase
        .from('tasks')
        .update({ status: done ? 'completed' : 'open', completed_at: done ? new Date().toISOString() : null })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
