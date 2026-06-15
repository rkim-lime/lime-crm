import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const SUPPORTED = ['equities', 'options', 'futures'];

export function useUpsellOpportunities(filters = {}) {
  return useQuery({
    queryKey: ['upsell-opportunities', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select(`
          id, name, segment, tier, status,
          strategy_asset_classes,
          sold_asset_classes,
          sales_owner:sales_owner_id(id, full_name, email)
        `)
        .not('strategy_asset_classes', 'eq', '{}');

      if (error) throw error;

      return (data || [])
        .map(account => {
          const gap = (account.strategy_asset_classes || []).filter(c =>
            SUPPORTED.includes(c) && !(account.sold_asset_classes || []).includes(c)
          );
          return { ...account, gap };
        })
        .filter(account => account.gap.length > 0)
        .filter(account => {
          if (filters.tier && account.tier !== filters.tier) return false;
          if (filters.status && account.status !== filters.status) return false;
          if (filters.gapClass && !account.gap.includes(filters.gapClass)) return false;
          if (filters.salesOwnerId && account.sales_owner?.id !== filters.salesOwnerId) return false;
          return true;
        })
        .sort((a, b) => b.gap.length - a.gap.length);
    },
  });
}

export function useUpsellCount() {
  const { data } = useUpsellOpportunities();
  return data?.length || 0;
}
