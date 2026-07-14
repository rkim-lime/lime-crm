// Stored inputs for Config-UI preview (stage C3). Preview never writes; these
// are read-only queries that feed the shared engine's dry-run functions.
//
// Every query PAGINATES (ordered by id) — PostgREST caps a single response at
// 1000 rows, and an un-ordered range silently drops/dupes across pages (the same
// class of bug migration 026's holdings cap hit). Preview counts must be exact.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const PAGE = 1000;

async function fetchAllOrdered(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(supabase).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// ── Relevance re-band inputs: 13F firms with a stored served_fraction ──────────
// Maps to the preview firm shape { id, firm_name, served_fraction, breakdown,
// position_count }. Only firms with a computed served_fraction can be re-banded
// (a threshold change re-bands stored fractions; it does not re-traverse holdings).
export function useRelevancePreviewFirms() {
  return useQuery({
    queryKey: ['preview', 'relevance_firms'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllOrdered((c) =>
        c.from('prospects')
          .select('id, firm_name, asset_class_served_fraction, asset_class_breakdown, position_count')
          .not('asset_class_served_fraction', 'is', null));
      return rows.map((r) => ({
        id: r.id,
        firm_name: r.firm_name,
        served_fraction: r.asset_class_served_fraction,
        breakdown: r.asset_class_breakdown ?? {},
        position_count: r.position_count,
      }));
    },
  });
}

// ── Segment re-derive inputs: ADV firms (name-signal list only governs ADV) ────
// clientTypes + hasPrivateFundClients come from normalized_signals, matching the
// ingestion scoringInput mapping exactly (parity).
export function useSegmentPreviewFirms() {
  return useQuery({
    queryKey: ['preview', 'segment_firms'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllOrdered((c) =>
        c.from('prospects')
          .select('id, firm_name, normalized_signals, segment_canonical')
          .eq('source', 'sec_adv'));
      return rows.map((r) => {
        const ns = r.normalized_signals ?? {};
        return {
          id: r.id,
          firm_name: r.firm_name,
          clientTypes: ns.client_types?.value ?? [],
          hasPrivateFundClients: ns.has_private_fund_clients?.value ?? false,
          current_segment: r.segment_canonical,
        };
      });
    },
  });
}

// ── Firm names for the regex test panel ("matches N of <total>") ──────────────
export function useFirmNames() {
  return useQuery({
    queryKey: ['preview', 'firm_names'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllOrdered((c) => c.from('prospects').select('id, firm_name'));
      return rows.map((r) => r.firm_name).filter(Boolean);
    },
  });
}
