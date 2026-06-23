import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Shared fields used by both list and detail queries.
// Promotion columns are intentionally excluded here — they live only in
// DETAIL_EXTRA so a missing migration only breaks the detail query, not the list.
const FIELDS = `
  id, firm_name, cik, source, source_url, status, jurisdiction,
  estimated_aum_usd, position_count, portfolio_turnover_pct,
  equities_pct, options_present, inferred_segment,
  fit_score, fit_score_computed_at, notes, created_at, updated_at,
  assigned_to,
  assignee:assigned_to(id, full_name, email, avatar_url)
`;

const DETAIL_EXTRA = `
  promoted_to_account_id, promoted_at, promoted_by
`;

export function useProspects(filters = {}) {
  return useQuery({
    queryKey: ['prospects', filters],
    queryFn: async () => {
      let q = supabase
        .from('prospects')
        .select(FIELDS)
        .order('fit_score', { ascending: false, nullsFirst: false });
      if (filters.status)  q = q.eq('status', filters.status);
      if (filters.source)  q = q.eq('source', filters.source);
      if (filters.segment) q = q.eq('inferred_segment', filters.segment);
      if (filters.assignee) q = q.eq('assigned_to', filters.assignee);
      if (filters.search)  q = q.ilike('firm_name', `%${filters.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProspect(id) {
  return useQuery({
    queryKey: ['prospect', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select(`
          ${FIELDS},
          ${DETAIL_EXTRA},
          filings:prospect_filings(
            id, filing_type, accession_no, period_of_report,
            filed_at, total_value_usd, holding_count, source_url
          ),
          scores:prospect_fit_scores(
            id, score, breakdown, computed_at
          )
        `)
        .eq('id', id)
        .order('period_of_report', { referencedTable: 'prospect_filings', ascending: false })
        .order('computed_at', { referencedTable: 'prospect_fit_scores', ascending: false })
        .single();
      if (error) {
        console.error('useProspect error:', error);
        throw error;
      }
      return data;
    },
    enabled: !!id,
  });
}

export function useUpdateProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data, error } = await supabase
        .from('prospects')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['prospect', id] });
    },
  });
}

export function useConvertProspectToAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ prospect }) => {
      const { data: { user } } = await supabase.auth.getUser();

      const segmentToTier = {
        hedge_fund:    'enterprise',
        quant_fund:    'enterprise',
        prop_trader:   'pro',
        broker_dealer: 'enterprise',
        pension:       'enterprise',
      };
      const tier = segmentToTier[prospect.inferred_segment] ?? 'enterprise';

      // Build asset class list from ingested signals
      const relevantAssetClasses = ['equities'];
      if (prospect.options_present) relevantAssetClasses.push('options');

      // 1. Create account
      const { data: account, error: accountErr } = await supabase
        .from('accounts')
        .insert({
          name:                    prospect.firm_name,
          tier,
          segment:                 prospect.inferred_segment ?? null,
          aum_usd:                 prospect.estimated_aum_usd ?? null,
          jurisdiction:            prospect.jurisdiction ?? null,
          status:                  'prospect',
          relevant_asset_classes:  relevantAssetClasses,
          sales_owner_id:          prospect.assigned_to ?? user?.id ?? null,
          notes:                   prospect.notes ?? null,
        })
        .select('id, name')
        .single();
      if (accountErr) throw accountErr;

      // 2. Create placeholder primary contact (13F data has no individual names)
      const { data: contact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          first_name:   'Unknown',
          last_name:    'Contact',
          title:        `Primary Contact — ${prospect.firm_name}`,
          segment:      prospect.inferred_segment ?? null,
          jurisdiction: prospect.jurisdiction ?? null,
          owner_id:     prospect.assigned_to ?? user?.id ?? null,
        })
        .select('id')
        .single();
      if (contactErr) throw contactErr;

      // 3. Link contact to account as primary
      const { error: linkErr } = await supabase
        .from('account_contacts')
        .insert({
          account_id:  account.id,
          contact_id:  contact.id,
          role:        'Primary Contact',
          is_primary:  true,
        });
      if (linkErr) throw linkErr;

      // 4. Mark prospect as promoted with full audit trail
      const { error: promoteErr } = await supabase
        .from('prospects')
        .update({
          status:                  'promoted',
          promoted_to_account_id:  account.id,
          promoted_at:             new Date().toISOString(),
          promoted_by:             user?.id ?? null,
        })
        .eq('id', prospect.id);
      if (promoteErr) throw promoteErr;

      return account;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
