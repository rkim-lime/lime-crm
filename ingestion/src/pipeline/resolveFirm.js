/**
 * Firm resolution: before inserting a new prospect, determine whether
 * the firm already exists as an Account (CIK match or fuzzy name) or
 * as an existing Prospect (CIK match or fuzzy name).
 *
 * Resolution results:
 *   { resolution: 'account_match',   accountId }
 *   { resolution: 'prospect_merge',  prospectId }
 *   { resolution: 'fuzzy_account',   matchId, matchName, similarity }
 *   { resolution: 'fuzzy_prospect',  matchId, matchName, similarity }
 *   { resolution: 'new' }
 */

const SUFFIXES =
  /\b(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|incorporated|corp|corporation|ltd|limited|capital|management|advisors|advisers|partners|group|holdings|asset|investments|investment|fund|funds|company|co)\b|[^a-z0-9 ]/g;

export function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function resolveFirm(supabase, { cik, firmName }) {
  // ── Step 1: exact CIK match against accounts ────────────────
  const { data: acctByCik } = await supabase
    .from('accounts')
    .select('id, name, cik')
    .eq('cik', cik)
    .maybeSingle();

  if (acctByCik) {
    return { resolution: 'account_match', accountId: acctByCik.id };
  }

  // ── Step 2: exact CIK match against prospects ────────────────
  const { data: prospByCik } = await supabase
    .from('prospects')
    .select('id, firm_name, cik')
    .eq('cik', cik)
    .eq('is_audit_only', false)
    .maybeSingle();

  if (prospByCik) {
    return { resolution: 'prospect_merge', prospectId: prospByCik.id };
  }

  // ── Steps 3–4: fuzzy name match via RPC ──────────────────────
  const { data: fuzzyMatches, error: rpcErr } = await supabase
    .rpc('find_similar_firms', { search_name: firmName, threshold: 0.5 });

  if (rpcErr) {
    // RPC may not exist yet (migration not applied). Fall through to 'new'.
    return { resolution: 'new' };
  }

  if (fuzzyMatches?.length) {
    const top = fuzzyMatches[0];
    if (top.match_type === 'account') {
      return {
        resolution: 'fuzzy_account',
        matchId:    top.id,
        matchName:  top.name,
        similarity: top.similarity,
      };
    }
    return {
      resolution: 'fuzzy_prospect',
      matchId:    top.id,
      matchName:  top.name,
      similarity: top.similarity,
    };
  }

  // ── Step 5: no match ─────────────────────────────────────────
  return { resolution: 'new' };
}
