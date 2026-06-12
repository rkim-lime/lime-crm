import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

const FIELDS = `
  id, contact_id, owner_id, created_by, stage, status,
  source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  referrer_contact_id, asset_classes, uses_rest_api, uses_fix,
  programming_languages, lead_score, funded_amount,
  first_funded_at, first_trade_at, activated_at, churned_at,
  churn_reason, converted_at, converted_to_deal_id, converted_to_tier,
  conversion_notes, notes, tags, created_at, updated_at,
  contact:contacts(id, first_name, last_name, email, phone, tier, segment)
`;

async function logActivity(payload) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('activities').insert({
      type: 'note', occurred_at: new Date().toISOString(),
      created_by: user?.id, ...payload,
    });
  } catch { /* best-effort */ }
}

export function useLeads(filters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      let q = supabase
        .from('leads')
        .select(FIELDS)
        .order('created_at', { ascending: false });
      if (filters.status)  q = q.eq('status', filters.status);
      if (filters.stage)   q = q.eq('stage', filters.stage);
      if (filters.owner)   q = q.eq('owner_id', filters.owner);
      if (filters.source)  q = q.eq('source', filters.source);
      if (filters.contact) q = q.eq('contact_id', filters.contact);
      if (filters.search) {
        // Search via contact name
        q = q.or(
          `contact.first_name.ilike.%${filters.search}%,contact.last_name.ilike.%${filters.search}%`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLead(id) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(FIELDS)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useLeadMetrics() {
  return useQuery({
    queryKey: ['lead-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, stage, status, converted_at, converted_to_deal_id');
      if (error) throw error;
      const rows = data ?? [];

      const totalLeads = rows.filter(r => r.status === 'active').length;

      const byStage = {};
      rows.forEach(r => {
        byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
      });

      const activated    = rows.filter(r => ['activated','funded','first_trade','active'].includes(r.stage)).length;
      const funded       = rows.filter(r => ['funded','first_trade','active'].includes(r.stage)).length;
      const activeTraders = byStage['active'] ?? 0;

      const converted = rows.filter(r => r.status === 'converted').length;
      const churned   = rows.filter(r => r.status === 'churned').length;
      const total     = converted + churned + rows.filter(r => r.status === 'active').length;
      const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const orphanedConversions = rows.filter(
        r => r.status === 'converted' &&
             !r.converted_to_deal_id &&
             r.converted_at &&
             r.converted_at < sevenDaysAgo
      ).length;

      return { totalLeads, byStage, activated, funded, activeTraders, conversionRate, orphanedConversions };
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (payload) => {
      const userId = session?.user?.id;
      const { data, error } = await supabase
        .from('leads')
        .insert({
          ...payload,
          created_by: userId,
          owner_id: payload.owner_id ?? userId,
        })
        .select()
        .single();
      if (error) throw error;
      await logActivity({ title: 'Lead created', contact_id: data.contact_id });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-metrics'] });
    },
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, _prevStage, _prevStatus, ...payload }) => {
      // Auto-set churned_at / clear it on status transitions
      if (payload.status === 'churned' && _prevStatus !== 'churned') {
        payload.churned_at = new Date().toISOString();
      } else if (payload.status === 'active' && _prevStatus === 'churned') {
        payload.churned_at = null;
      }

      const { data, error } = await supabase
        .from('leads')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (_prevStage && payload.stage && _prevStage !== payload.stage) {
        await logActivity({
          title: `Lead stage changed to ${payload.stage}`,
          contact_id: data.contact_id,
          type: 'deal_stage_change',
        });
      } else if (_prevStatus && payload.status && _prevStatus !== payload.status) {
        await logActivity({
          title: `Lead status changed to ${payload.status}`,
          contact_id: data.contact_id,
        });
      }
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['lead-metrics'] });
    },
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, targetTier, createDeal = false, dealData = {}, notes: conversionNotes }) => {
      let dealId = null;

      if (createDeal) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: newDeal, error: dealErr } = await supabase
          .from('deals')
          .insert({
            ...dealData,
            tier: targetTier,
            motion: targetTier,
            created_by: user?.id,
          })
          .select('id,account_id,contact_id')
          .single();
        if (dealErr) throw dealErr;
        dealId = newDeal.id;
      }

      const { data, error } = await supabase
        .from('leads')
        .update({
          status:              'converted',
          converted_at:        new Date().toISOString(),
          converted_to_tier:   targetTier,
          converted_to_deal_id: dealId,
          conversion_notes:    conversionNotes ?? null,
        })
        .eq('id', leadId)
        .select('contact_id')
        .single();
      if (error) throw error;

      await logActivity({
        title: `Lead converted to ${targetTier}`,
        contact_id: data.contact_id,
        type: 'deal_stage_change',
      });

      return { leadId, dealId, targetTier };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', result.leadId] });
      qc.invalidateQueries({ queryKey: ['lead-metrics'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('leads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.removeQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['lead-metrics'] });
    },
  });
}

export function useOrphanedConversions() {
  return useQuery({
    queryKey: ['leads-orphaned'],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('leads')
        .select(FIELDS)
        .eq('status', 'converted')
        .is('converted_to_deal_id', null)
        .lt('converted_at', sevenDaysAgo)
        .order('converted_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
