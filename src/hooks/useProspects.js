import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Shared fields used by both list and detail queries.
// Promotion columns are intentionally excluded here — they live only in
// DETAIL_EXTRA so a missing migration only breaks the detail query, not the list.
const FIELDS = `
  id, firm_name, cik, source, source_url, status, jurisdiction,
  estimated_aum_usd, position_count, portfolio_turnover_pct,
  equities_pct, options_present, inferred_segment, segment_canonical,
  fit_score, fit_score_computed_at, passes_icp, is_audit_only,
  asset_class_relevance, asset_class_relevance_override,
  asset_class_served_fraction, asset_class_breakdown, asset_class_flags,
  notes, created_at, updated_at,
  assigned_to,
  assignee:assigned_to(id, full_name, email, avatar_url)
`;

const DETAIL_EXTRA = `
  promoted_to_account_id, promoted_at, promoted_by
`;

// Loads the source_registry table — maps source_key → channel + display_label.
// This is the data-driven replacement for the old PROSPECT_SOURCE_LABELS static map.
// All rows are returned (including inactive) so label resolution works for
// historical prospects whose source was later deactivated.
export function useSourceRegistry() {
  return useQuery({
    queryKey: ['source-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('source_registry')
        .select('source_key, channel, display_label, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

// Loads segment labels from taxonomy_values (the 'segment' taxonomy) — the
// single source of truth for prospect segment display, mirroring
// useSourceRegistry. Ordered by sort_order so filter option lists are stable.
export function useSegmentTaxonomy() {
  return useQuery({
    queryKey: ['segment-taxonomy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxonomy_values')
        .select('value_key, label, sort_order, fit_tier, taxonomies!inner(taxonomy_key)')
        .eq('taxonomies.taxonomy_key', 'segment')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(({ value_key, label, sort_order, fit_tier }) => ({
        value_key, label, sort_order, fit_tier,
      }));
    },
    staleTime: 10 * 60 * 1000,
  });
}

// Loads relevance_verdict_actions (verdict → gate/penalize/pass) so the gate is
// config-driven in the UI — never a hardcoded list of gating verdicts.
export function useRelevanceActions() {
  return useQuery({
    queryKey: ['relevance-verdict-actions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('relevance_verdict_actions')
        .select('verdict, action');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

// Single-row relevance knobs (suspect_penalty, thresholds). Config-driven — the
// UI reads suspect_penalty from here rather than hardcoding a magnitude.
export function useRelevanceConfig() {
  return useQuery({
    queryKey: ['asset-class-relevance-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_class_relevance_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data ?? {};
    },
    staleTime: 10 * 60 * 1000,
  });
}

// Effective verdict = human override (if set) else the auto verdict.
export function effectiveRelevance(p) {
  return p?.asset_class_relevance_override ?? p?.asset_class_relevance ?? null;
}

// Display priority = intrinsic fit_score minus the soft suspect penalty (config)
// for firms whose effective verdict's action is 'penalize'. fit_score itself is
// never mutated — asset-class stays separate from the fit score.
export function displayPriority(p, verdictActions = [], suspectPenalty = 0) {
  const base = p?.fit_score ?? 0;
  const eff = effectiveRelevance(p);
  const action = verdictActions.find(v => v.verdict === eff)?.action;
  return action === 'penalize' ? base - suspectPenalty : base;
}

// Human override of the asset-class verdict — the reversible gate control.
// Pass override=null to clear (revert to the auto verdict).
export function useSetRelevanceOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, override }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('prospects')
        .update({
          asset_class_relevance_override: override,
          asset_class_override_by: override ? (user?.id ?? null) : null,
          asset_class_override_at: override ? new Date().toISOString() : null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['prospect', id] });
    },
  });
}

export function useProspects(filters = {}) {
  return useQuery({
    queryKey: ['prospects', filters],
    queryFn: async () => {
      let q = supabase
        .from('prospects')
        .select(FIELDS)
        .order('fit_score', { ascending: false, nullsFirst: false });

      // Always exclude audit-only records (CIK-matched account shadows)
      q = q.eq('is_audit_only', false);

      // ICP filter — default ON; caller must explicitly pass icpOnly:false to disable
      const icpOnly = filters.icpOnly !== undefined ? filters.icpOnly : true;
      if (icpOnly) q = q.eq('passes_icp', true);

      if (filters.status)               q = q.eq('status', filters.status);
      if (filters.source)               q = q.eq('source', filters.source);
      else if (filters.sources?.length) q = q.in('source', filters.sources);
      // Segment filter maps to segment_canonical (the authoritative, config-driven
      // value). Multi-select via `segments` (array); `hideUnknown` pulls the
      // enrichment-queue firms out of the working view.
      if (filters.segments?.length)     q = q.in('segment_canonical', filters.segments);
      else if (filters.segment)         q = q.eq('segment_canonical', filters.segment);
      if (filters.hideUnknown)          q = q.neq('segment_canonical', 'unknown');
      if (filters.assignee) q = q.eq('assigned_to', filters.assignee);
      if (filters.search)   q = q.ilike('firm_name', `%${filters.search}%`);
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
        prop_trading:  'pro',
        prop_trader:   'pro',
        broker_dealer: 'enterprise',
        pension:       'enterprise',
      };
      // Prefer the authoritative segment_canonical; fall back to the raw connector value.
      const segment = prospect.segment_canonical ?? prospect.inferred_segment ?? null;
      const tier = segmentToTier[segment] ?? 'enterprise';

      // Build asset class list from ingested signals
      const relevantAssetClasses = ['equities'];
      if (prospect.options_present) relevantAssetClasses.push('options');

      // 1. Create account
      const { data: account, error: accountErr } = await supabase
        .from('accounts')
        .insert({
          name:                        prospect.firm_name,
          tier,
          segment:                     segment,
          aum_usd:                     prospect.estimated_aum_usd ?? null,
          jurisdiction:                prospect.jurisdiction ?? null,
          status:                      'prospect',
          relevant_asset_classes:      relevantAssetClasses,
          sales_owner_id:              prospect.assigned_to ?? user?.id ?? null,
          notes:                       prospect.notes ?? null,
          // SEC provenance — critical for ingestion dedup (CIK match)
          cik:                         prospect.cik ?? null,
          sec_estimated_aum_usd:       prospect.estimated_aum_usd ?? null,
          sec_position_count:          prospect.position_count ?? null,
          sec_portfolio_turnover_pct:  prospect.portfolio_turnover_pct ?? null,
          sec_equities_pct:            prospect.equities_pct ?? null,
          sec_options_present:         prospect.options_present ?? null,
          sec_signals_updated_at:      new Date().toISOString(),
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
          segment:      segment,
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
