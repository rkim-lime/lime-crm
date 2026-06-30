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

// ── Stopword config (Fix B + C) ───────────────────────────────────────────────
//
// SEED_STOPWORDS is the canonical word list and must stay in sync with the
// name_stopwords table seeded by migration 019. The SQL normalize_firm_name()
// and the JS normalizeName() apply identical two-pass logic against the same
// word list — any change to the name_stopwords table takes effect in SQL
// immediately; the JS picks it up on the next process start via ensureStopwords().
//
// Two-pass normalization (identical in SQL and JS):
//   1. Strip non-alphanumeric/space chars  — handles L.L.C., inc., & etc.
//   2. Strip whole-word stopwords          — removes structural + industry boilerplate
//   3. Collapse whitespace

const SEED_STOPWORDS = [
  // structural: legal entity types and high-frequency finance terms
  'llc', 'lp', 'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'capital', 'management', 'advisors', 'advisers', 'partners', 'group',
  'holdings', 'asset', 'investments', 'investment', 'fund', 'funds', 'company', 'co',
  // industry: generic descriptors shared across too many distinct advisory firms
  // NOTE: 'advisory' was missing from the prior regex despite 'advisors'/'advisers' being present
  'advisory', 'financial', 'planning', 'wealth', 'services', 'retirement', 'plan',
  // geographic: boilerplate location tokens (extend via name_stopwords table — no code change)
  'singapore',
];

const PUNCT_RE = /[^a-z0-9 ]/g;

function buildStopwordsRegex(words) {
  // Sort longest-first so 'incorporated' is tried before 'inc', etc.
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${sorted.join('|')})\\b`, 'gi');
}

let _stopwordsRegex  = buildStopwordsRegex(SEED_STOPWORDS);
let _stopwordsLoaded = false;

/** Override the active stopword list. Exported for use in tests. */
export function setStopwords(words) {
  _stopwordsRegex = buildStopwordsRegex(words);
}

/**
 * Load stopwords from the name_stopwords table (idempotent — runs once per
 * process). Falls back silently to SEED_STOPWORDS if the table doesn't exist
 * yet (pre-migration 019) or the query returns no rows.
 */
async function ensureStopwords(supabase) {
  if (_stopwordsLoaded) return;
  _stopwordsLoaded = true; // set before await — prevents concurrent re-entry
  try {
    const result = await supabase.from('name_stopwords').select('word').eq('enabled', true);
    if (result && !result.error && Array.isArray(result.data) && result.data.length > 0) {
      setStopwords(result.data.map(r => r.word));
    }
  } catch {
    // Pre-migration or unit-test environment — SEED_STOPWORDS default remains active
  }
}

/**
 * Normalize a firm name for fuzzy comparison.
 *
 * Must produce output identical to the SQL normalize_firm_name() function in
 * migration 019: lowercase → strip punct → strip whole-word stopwords → collapse spaces.
 *
 * Used by runConnector.js to populate the normalized_name column on upsert.
 */
export function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(PUNCT_RE, '')
    .replace(_stopwordsRegex, '')
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
  await ensureStopwords(supabase); // idempotent — loads stopwords once per process

  const { data: fuzzyMatches, error: rpcErr } = await supabase
    .rpc('find_similar_firms', { search_name: firmName, threshold: 0.5 });

  if (rpcErr) {
    // RPC may not exist yet (migration not applied). Fall through to 'new'.
    return { resolution: 'new' };
  }

  if (fuzzyMatches?.length) {
    for (const candidate of fuzzyMatches) {
      // Fix A: two distinct non-null CRDs (or CIKs) = definitively different firms.
      // Name similarity must never override a regulatory-ID mismatch.
      // Only reject when BOTH sides carry a non-null identifier that differs —
      // a null on either side means genuine ambiguity, so fuzzy stands.
      const crdMismatch = crdNumber && candidate.crd_number
        && candidate.crd_number !== crdNumber;
      const cikMismatch = cik && candidate.cik
        && candidate.cik !== cik;
      if (crdMismatch || cikMismatch) continue;

      if (candidate.match_type === 'account') {
        return {
          resolution: 'fuzzy_account',
          matchId:    candidate.id,
          matchName:  candidate.name,
          similarity: candidate.similarity,
        };
      }
      return {
        resolution: 'fuzzy_prospect',
        matchId:    candidate.id,
        matchName:  candidate.name,
        similarity: candidate.similarity,
      };
    }
    // All candidates rejected due to identifier mismatches — treat as new
  }

  // ── Step 7: no match ─────────────────────────────────────────
  return { resolution: 'new' };
}
