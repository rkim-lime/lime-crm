import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name,email,role,avatar_url')
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });
}
