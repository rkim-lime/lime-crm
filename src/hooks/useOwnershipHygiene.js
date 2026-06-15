import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useDealsWithoutOwner() {
  return useQuery({
    queryKey: ['ownership-hygiene', 'deals-no-owner'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('id,name,stage,tier,created_at,account:accounts(id,name)')
        .is('sales_owner_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAccountsWithoutOwner() {
  return useQuery({
    queryKey: ['ownership-hygiene', 'accounts-no-owner'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id,name,tier,segment,status,created_at')
        .is('sales_owner_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAccountsNeedingServiceManager() {
  return useQuery({
    queryKey: ['ownership-hygiene', 'accounts-no-sm'],
    queryFn: async () => {
      // Active accounts OR accounts linked to onboarding/live deals
      const { data: activeAccounts, error: e1 } = await supabase
        .from('accounts')
        .select('id,name,tier,segment,status,created_at,sales_owner:sales_owner_id(id,full_name,email)')
        .is('service_manager_id', null)
        .eq('status', 'active');
      if (e1) throw e1;

      const { data: dealsData, error: e2 } = await supabase
        .from('deals')
        .select('account_id,stage')
        .in('stage', ['onboarding', 'live'])
        .not('account_id', 'is', null);
      if (e2) throw e2;

      const dealAccountIds = [...new Set((dealsData ?? []).map(d => d.account_id))];
      const activeIds = new Set((activeAccounts ?? []).map(a => a.id));

      // Fetch accounts linked to onboarding/live deals that aren't already included
      const extraIds = dealAccountIds.filter(id => !activeIds.has(id));
      let extraAccounts = [];
      if (extraIds.length > 0) {
        const { data: extra, error: e3 } = await supabase
          .from('accounts')
          .select('id,name,tier,segment,status,created_at,sales_owner:sales_owner_id(id,full_name,email)')
          .is('service_manager_id', null)
          .in('id', extraIds);
        if (e3) throw e3;
        extraAccounts = extra ?? [];
      }

      // Attach the relevant deal stage to each account for display
      const dealStageMap = {};
      for (const d of dealsData ?? []) {
        if (!dealStageMap[d.account_id]) dealStageMap[d.account_id] = d.stage;
      }

      const combined = [...(activeAccounts ?? []), ...extraAccounts];
      return combined.map(a => ({ ...a, deal_stage: dealStageMap[a.id] ?? null }));
    },
  });
}

export function useLeadsWithoutOwner() {
  return useQuery({
    queryKey: ['ownership-hygiene', 'leads-no-owner'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id,stage,source,created_at,contact:contact_id(id,first_name,last_name,email)')
        .is('sales_owner_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useOwnershipHygieneCount() {
  return useQuery({
    queryKey: ['ownership-hygiene', 'count'],
    queryFn: async () => {
      const [d, a, sm, l] = await Promise.all([
        supabase.from('deals').select('id', { count: 'exact', head: true }).is('sales_owner_id', null),
        supabase.from('accounts').select('id', { count: 'exact', head: true }).is('sales_owner_id', null),
        supabase.from('accounts').select('id', { count: 'exact', head: true }).is('service_manager_id', null).eq('status', 'active'),
        supabase.from('leads').select('id', { count: 'exact', head: true }).is('sales_owner_id', null),
      ]);
      if (d.error) throw d.error;
      if (a.error) throw a.error;
      if (sm.error) throw sm.error;
      if (l.error) throw l.error;
      return (d.count ?? 0) + (a.count ?? 0) + (sm.count ?? 0) + (l.count ?? 0);
    },
    staleTime: 60_000,
  });
}
