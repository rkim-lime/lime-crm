import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const TEAM_FIELDS = 'id,deal_id,profile_id,role,added_at,added_by,profile:profile_id(id,full_name,email,avatar_url,role)';

export function useDealTeam(dealId) {
  return useQuery({
    queryKey: ['deal-team', dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_team')
        .select(TEAM_FIELDS)
        .eq('deal_id', dealId)
        .order('added_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!dealId,
  });
}

export function useAddDealTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deal_id, profile_id, role = 'Team Member' }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('deal_team')
        .insert({ deal_id, profile_id, role, added_by: user?.id })
        .select(TEAM_FIELDS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => qc.invalidateQueries({ queryKey: ['deal-team', data.deal_id] }),
  });
}

export function useRemoveDealTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, deal_id }) => {
      const { error } = await supabase.from('deal_team').delete().eq('id', id);
      if (error) throw error;
      return { deal_id };
    },
    onSuccess: (result) => qc.invalidateQueries({ queryKey: ['deal-team', result.deal_id] }),
  });
}

export function useUpdateDealTeamRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, deal_id, role }) => {
      const { data, error } = await supabase
        .from('deal_team')
        .update({ role })
        .eq('id', id)
        .select(TEAM_FIELDS)
        .single();
      if (error) throw error;
      return { ...data, deal_id };
    },
    onSuccess: (result) => qc.invalidateQueries({ queryKey: ['deal-team', result.deal_id] }),
  });
}
