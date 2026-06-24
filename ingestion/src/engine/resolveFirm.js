/**
 * Firm resolution: before inserting a new prospect, determine whether
 * the firm already exists as an Account (CIK/CRD match or fuzzy name) or
 * as an existing Prospect (CIK/CRD match or fuzzy name).
 *
 * Resolution order:
 *   1. CIK exact  → accounts  (if signal has cik)
 *   2. CRD exact  → accounts  (if signal has crdNumber — ADV primary key)
 *   3. CIK exact  → prospects (if signal has cik)
 *   4. CRD exact  → prospects (if signal has crdNumber)
 *   5. fuzzy name → accounts  (via find_similar_firms RPC)
 *   6. fuzzy name → prospects
 *   7. new
 *
 * Results:
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

export async function resolveFirm(supabase, { cik, firmName, crdNumber }) {
  // ── Step 1: exact CIK match against accounts ─────────────────
  if (cik) {
    const { data: acctByCik } = await supabase
      .from('accounts')
      .select('id')
      .eq('cik', cik)
      .maybeSingle();
    if (acctByCik) return { resolution: 'account_match', accountId: acctByCik.id };
  }

  // ── Step 2: exact CRD match against accounts ──────────────────
  // Gracefully skips if crd_number column doesn't exist (pre-migration 016)
  if (crdNumber) {
    const { data: acctByCrd, error: crdAcctErr } = await supabase
      .from('accounts')
      .select('id')
      .eq('crd_number', crdNumber)
      .maybeSingle();
    if (!crdAcctErr && acctByCrd) return { resolution: 'account_match', accountId: acctByCrd.id };
  }

  // ── Step 3: exact CIK match against prospects ─────────────────
  if (cik) {
    const { data: prospByCik } = await supabase
      .from('prospects')
      .select('id')
      .eq('cik', cik)
      .eq('is_audit_only', false)
      .maybeSingle();
    if (prospByCik) return { resolution: 'prospect_merge', prospectId: prospByCik.id };
  }

  // ── Step 4: exact CRD match against prospects ─────────────────
  if (crdNumber) {
    const { data: prospByCrd, error: crdPrspErr } = await supabase
      .from('prospects')
      .select('id')
      .eq('crd_number', crdNumber)
      .eq('is_audit_only', false)
      .maybeSingle();
    if (!crdPrspErr && prospByCrd) return { resolution: 'prospect_merge', prospectId: prospByCrd.id };
  }

  // ── Steps 5–6: fuzzy name match via RPC ──────────────────────
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

  // ── Step 7: no match ─────────────────────────────────────────
  return { resolution: 'new' };
}
