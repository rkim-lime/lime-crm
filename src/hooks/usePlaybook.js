import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function usePlaybookStats() {
  return useQuery({
    queryKey: ['playbook-stats'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [entAccts, entDeals, proAccts, proDeals, indActive, indConverted] = await Promise.all([
        supabase.from('accounts').select('id', { count: 'exact', head: true })
          .eq('tier', 'enterprise').eq('status', 'active'),
        supabase.from('deals').select('id', { count: 'exact', head: true })
          .eq('motion', 'enterprise').not('stage', 'in', '(live,lost)'),
        supabase.from('accounts').select('id', { count: 'exact', head: true })
          .eq('tier', 'pro').eq('status', 'active'),
        supabase.from('deals').select('id', { count: 'exact', head: true })
          .eq('motion', 'pro').not('stage', 'in', '(live,lost)'),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('status', 'converted'),
      ]);
      return {
        enterprise: { accounts: entAccts.count ?? 0, deals: entDeals.count ?? 0 },
        pro:        { accounts: proAccts.count ?? 0, deals: proDeals.count ?? 0 },
        individual: { leads: indActive.count ?? 0,   converted: indConverted.count ?? 0 },
      };
    },
  });
}
