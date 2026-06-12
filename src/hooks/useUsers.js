import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// ── All profiles (admin only) ─────────────────────────────────

export function useAllProfiles() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ['profiles', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          *,
          invited_by_profile:invited_by(full_name, email),
          deactivated_by_profile:deactivated_by(full_name, email)
        `)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: role === 'admin',
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_active:      false,
          deactivated_at: new Date().toISOString(),
          deactivated_by: session?.user?.id ?? null,
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_active:      true,
          deactivated_at: null,
          deactivated_by: null,
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

// ── Invitations ───────────────────────────────────────────────

export function useAllInvitations() {
  const { role } = useAuth();
  return useQuery({
    queryKey: ['invitations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('*, invited_by_profile:invited_by(full_name, email)')
        .order('invited_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: role === 'admin',
    staleTime: 30_000,
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ email, role, notes }) => {
      const { data, error } = await supabase
        .from('invitations')
        .insert({
          email,
          role,
          notes: notes || null,
          invited_by: session?.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('invitations')
        .update({ status: 'revoked' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}
