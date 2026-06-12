import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export function usePendingUsers() {
  const { role } = useAuth();

  const query = useQuery({
    queryKey: ['profiles', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, created_at')
        .eq('role', 'pending')
        .eq('is_active', true)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: role === 'admin',
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return {
    pendingUsers: query.data ?? [],
    count:        query.data?.length ?? 0,
    isLoading:    query.isLoading,
  };
}
