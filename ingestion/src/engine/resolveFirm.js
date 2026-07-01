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
 *   5. Fuzzy name — two-stage hybrid matcher:
 *      Stage 1: pg_trgm on stripped normalized_name (loose recall,
 *               threshold from matcher_config.stage1_recall_threshold)
 *      Fix A:   CRD/CIK mismatch → hard block (highest precedence)
 *      Stage 2: distinctive-token weighted Jaccard on raw names
 *               (IDF from token_document_freq_raw, seeded by migration 022)
 *               Score ≥ stage2_decision_threshold → flag; else dismiss.
 *               Falls back to raw-name trigram similarity when no distinctive
 *               tokens exist on either side (avoids auto-dismissing identical
 *               all-boilerplate names with missing identifiers).
 *      Stage 2 is INACTIVE when token_document_freq_raw is not loaded
 *      (empty corpus); in that state Stage 1 results pass through unchanged.
 *   6. new
 *
 * Results:
 *   { resolution: 'account_match',   accountId }
 *   { resolution: 'prospect_merge',  prospectId }
 *   { resolution: 'fuzzy_account',   matchId, matchName, similarity, matchReason }
 *   { resolution: 'fuzzy_prospect',  matchId, matchName, similarity, matchReason }
 *   { resolution: 'new' }
 *
 * matchReason shape (written to dedup_queue.match_reason by runConnector):
 *   { stage, raw_trgm_similarity, weighted_score, decision, threshold_applied,
 *     fallback_used, distinctive_mismatch_tokens, matched_tokens, identifier_status }
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

// SEED_STOPWORDS mirrors the name_stopwords table (migration 020 seed).
// 'anywhere'      — stripped wherever the word appears in the name
// 'trailing_only' — stripped only when it is the LAST token (entity-type suffixes)
//
// This prevents ambiguous tokens ('sa', 'as', 'ab', 'ag') from being erased
// when they appear as leading initials. E.g.:
//   "SAMSUNG ASSET MANAGEMENT SA"  → 'samsung'  (trailing 'sa' stripped)
//   "AB GLOBAL PARTNERS LLC"       → 'ab global' (leading 'ab' preserved)
const SEED_STOPWORDS = {
  anywhere: [
    // finance / industry descriptors — can appear leading, mid, or trailing
    'capital', 'management', 'advisors', 'advisers', 'advisory', 'partners', 'group',
    'holdings', 'asset', 'investments', 'investment', 'fund', 'funds',
    'financial', 'planning', 'wealth', 'services', 'retirement', 'plan',
    // geographic boilerplate
    'singapore',
    // grammatical particles
    'the',
  ],
  trailing: [
    // English legal entity types
    'llc', 'lp', 'llp', 'inc', 'incorporated', 'corp', 'corporation',
    'ltd', 'limited', 'plc', 'ulc', 'company', 'co',
    // International suffixes (all trailing — some are ambiguous as leading initials)
    'pte', 'pty',                         // Oceania / SE Asia
    'gmbh', 'ag',                         // German-speaking
    'sa', 'sas', 'sarl',                  // French
    'srl', 'spa',                         // Italian / Romanian
    'bv', 'nv',                           // Dutch / Belgian
    'ab',                                 // Swedish
    'as', 'aps',                          // Nordic
    'oy',                                 // Finnish
    'kk',                                 // Japanese
    // Roman numerals: fund/series suffixes (i–x trailing_only)
    // Trailing-only prevents "I Capital Partners" losing its leading 'I',
    // same policy as 'ab', 'as'. Accepted edge case: sole-token 'I' → ''.
    'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
  ],
};

const PUNCT_RE = /[^a-z0-9 ]/g;
const NEVER_MATCH = /(?!)/; // sentinel regex that never matches

function buildAnywhereRegex(words) {
  if (!words.length) return NEVER_MATCH;
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${sorted.join('|')})\\b`, 'gi');
}

function buildTrailingRegex(words) {
  if (!words.length) return NEVER_MATCH;
  // No 'g' flag — applied in a loop, removes one trailing word per pass
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${sorted.join('|')})\\b\\s*$`, 'i');
}

let _anywhereRegex  = buildAnywhereRegex(SEED_STOPWORDS.anywhere);
let _trailingRegex  = buildTrailingRegex(SEED_STOPWORDS.trailing);
let _trailingSet    = new Set(SEED_STOPWORDS.trailing);
let _stopwordsLoaded = false;

/**
 * Override the active stopword lists.
 * Accepts { anywhere: string[], trailing: string[] }.
 * Exported for use in tests and by ensureStopwords().
 */
export function setStopwords({ anywhere = [], trailing = [] } = {}) {
  _anywhereRegex = buildAnywhereRegex(anywhere);
  _trailingRegex = buildTrailingRegex(trailing);
  _trailingSet   = new Set(trailing);
}

/**
 * Load stopwords from the name_stopwords table (idempotent — runs once per
 * process). Falls back silently to SEED_STOPWORDS if the table doesn't exist
 * yet (pre-migration 020) or the query returns no rows.
 */
async function ensureStopwords(supabase) {
  if (_stopwordsLoaded) return;
  _stopwordsLoaded = true; // set before await — prevents concurrent re-entry
  try {
    const result = await supabase
      .from('name_stopwords')
      .select('word, position')
      .eq('enabled', true);
    if (result && !result.error && Array.isArray(result.data) && result.data.length > 0) {
      setStopwords({
        anywhere: result.data.filter(r => r.position === 'anywhere').map(r => r.word),
        trailing: result.data.filter(r => r.position === 'trailing_only').map(r => r.word),
      });
    }
  } catch {
    // Pre-migration or unit-test environment — SEED_STOPWORDS default remains active
  }
}

/**
 * Normalize a firm name for fuzzy comparison.
 *
 * Three-pass logic — must produce output identical to the SQL
 * normalize_firm_name() function (migration 020):
 *   1. lowercase + strip punctuation
 *   2. strip 'anywhere' stopwords (global)
 *   3. collapse spaces
 *   4. loop: strip 'trailing_only' stopwords from end until stable
 *
 * Used by runConnector.js to populate the normalized_name column on upsert.
 */
export function normalizeName(name) {
  if (!name) return '';
  let s = name.toLowerCase().replace(PUNCT_RE, '');
  s = s.replace(_anywhereRegex, '').replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(_trailingRegex, '').trimEnd();
  } while (s !== prev && s !== '');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Stage 2: hybrid IDF matcher ───────────────────────────────────────────────
//
// Metric: Distinctive-Token Weighted Jaccard restricted to tokens flagged as
// name-distinctive (high IDF, min-length, or digit heuristic).
//
//   score = Σ idf(t ∈ shared_distinctive)
//         / (Σ idf(t ∈ shared_distinctive) + Σ idf(t ∈ mismatched_distinctive) × (1 + wStrength))
//
// A distinctive token that appears in one name but not the other amplifies the
// denominator by (1 + weighting_strength), making mismatches hurt more than
// matches help — creating a strong asymmetric signal.
//
// When denominator=0 (both names are pure boilerplate with no distinctive tokens),
// falls back to raw-name trigram similarity vs stage2_fallback_similarity_threshold.
// This catches identical all-boilerplate names ("Capital Management Partners" vs self)
// that should remain flagged for human review.
//
// Stage 2 only activates after token_document_freq_raw is loaded (_tokenFreq.size > 0).
// Before that (cold-start / pre-migration), Stage 1 results pass through unchanged.

const COLD_START_IDF = 3.5;

let _matcherConfig     = {};
let _tokenFreq         = new Map();
let _matcherDataLoaded = false;

/**
 * Override matcher config and token-frequency map.
 * Calling this marks the data as loaded, preventing ensureMatcherData from
 * overwriting it. Used in tests to inject realistic IDF values.
 */
export function setMatcherData({ config = {}, tokenFreq = [] } = {}) {
  _matcherConfig     = config;
  _tokenFreq         = new Map(tokenFreq.map(({ token, idf }) => [token, Number(idf)]));
  _matcherDataLoaded = true;
}

async function ensureMatcherData(supabase) {
  if (_matcherDataLoaded) return;
  _matcherDataLoaded = true;
  try {
    const [cfgResult, freqResult] = await Promise.all([
      supabase.from('matcher_config').select('key, value'),
      supabase.from('token_document_freq_raw').select('token, idf'),
    ]);
    const config = {};
    if (cfgResult && !cfgResult.error && Array.isArray(cfgResult.data)) {
      for (const { key, value } of cfgResult.data) config[key] = value;
    }
    const tokenFreq = [];
    if (freqResult && !freqResult.error && Array.isArray(freqResult.data)) {
      for (const { token, idf } of freqResult.data) tokenFreq.push({ token, idf });
    }
    setMatcherData({ config, tokenFreq });
  } catch {
    setMatcherData({});
  }
}

function numConfig(key, defaultVal) {
  const v = _matcherConfig?.[key];
  return v != null ? Number(v) : defaultVal;
}

function boolConfig(key, defaultVal) {
  const v = _matcherConfig?.[key];
  return v != null ? v === 'true' : defaultVal;
}

function getIdf(token) {
  const stored = _tokenFreq.get(token);
  return stored !== undefined ? stored : COLD_START_IDF;
}

// Lightly normalise for Stage 2 tokenisation: lowercase + punct strip only.
// No stopword removal — preserves second-tier words (capital, ventures, global)
// so their real corpus IDF can weight the comparison.
function lightNormalize(name) {
  if (!name) return '';
  return name.toLowerCase().replace(PUNCT_RE, '').replace(/\s+/g, ' ').trim();
}

function isDistinctive(token, idf) {
  // Entity-type suffixes (trailing stopwords) are NEVER distinctive even when
  // their corpus IDF is high (small corpus, few firms using 'corp'). Without
  // this check "corp" ≠ "corporation" fires a false mismatch penalty.
  if (_trailingSet.has(token)) return false;
  if (token.length < numConfig('min_token_len_for_distinctive', 4)) return false;
  if (boolConfig('digit_tokens_distinctive', true) && /\d/.test(token)) return true;
  return idf >= numConfig('distinctiveness_threshold', 2.5);
}

function trigramSet(s) {
  const padded = `  ${s} `;
  const set = new Set();
  for (let i = 0; i <= padded.length - 3; i++) set.add(padded.slice(i, i + 3));
  return set;
}

function trigramSim(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ta = trigramSet(a);
  const tb = trigramSet(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function computeStage2Score(rawNameA, rawNameB) {
  // Tokenise from lightly-normalised raw names (lowercase + punct only, NO stopword removal).
  // Entity-type suffixes (corp, corporation, llc, …) are excluded from distinctiveness
  // via _trailingSet in isDistinctive(), not by stripping them here. This preserves
  // second-tier words (capital, ventures, global) in the comparison, weighted by their
  // real corpus IDF — common words self-demote without asymmetric over-stripping.
  const lightA  = lightNormalize(rawNameA);
  const lightB  = lightNormalize(rawNameB);
  const tokensA = new Set(lightA ? lightA.split(' ').filter(Boolean) : []);
  const tokensB = new Set(lightB ? lightB.split(' ').filter(Boolean) : []);

  const wStrength      = numConfig('weighting_strength', 0.6);
  let   numerator      = 0;
  let   denominator    = 0;
  const matchedTokens         = [];
  const distinctiveMismatches = [];

  for (const token of new Set([...tokensA, ...tokensB])) {
    const idf         = getIdf(token);
    const distinctive = isDistinctive(token, idf);
    if (!distinctive) continue;

    const inA = tokensA.has(token);
    const inB = tokensB.has(token);

    if (inA && inB) {
      numerator   += idf;
      denominator += idf;
      matchedTokens.push({ token, idf: Math.round(idf * 100) / 100, matched: true });
    } else {
      denominator += idf * (1 + wStrength);
      distinctiveMismatches.push(token);
      matchedTokens.push({ token, idf: Math.round(idf * 100) / 100, matched: false });
    }
  }

  if (denominator === 0) {
    // No distinctive tokens on either side — fall back to Stage-1 normalized-name
    // trigram similarity. normalizeName() strips boilerplate so identical all-
    // boilerplate names (both → "") score 1.0 and stay flagged for human review;
    // different-boilerplate names ("blue capital" vs "blue ventures") score low
    // via the stripped-name comparison and are auto-dismissed.
    return {
      weightedScore:        trigramSim(normalizeName(rawNameA), normalizeName(rawNameB)),
      fallbackUsed:         true,
      matchedTokens,
      distinctiveMismatches,
    };
  }

  return {
    weightedScore:        numerator / denominator,
    fallbackUsed:         false,
    matchedTokens,
    distinctiveMismatches,
  };
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

  // ── Steps 5–6: fuzzy name match via two-stage hybrid matcher ────────────────
  await Promise.all([
    ensureStopwords(supabase),    // idempotent — loads stopwords once per process
    ensureMatcherData(supabase),  // idempotent — loads config + token freq once per process
  ]);

  const stage1Threshold = numConfig('stage1_recall_threshold', 0.5);
  const { data: fuzzyMatches, error: rpcErr } = await supabase
    .rpc('find_similar_firms', { search_name: firmName, threshold: stage1Threshold });

  if (rpcErr) {
    // RPC may not exist yet (migration not applied). Fall through to 'new'.
    return { resolution: 'new' };
  }

  const stage2Active    = _tokenFreq.size > 0;
  const stage2Threshold = numConfig('stage2_decision_threshold', 0.65);
  const fallbackThresh  = numConfig('stage2_fallback_similarity_threshold', 0.9);

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

      // Stage 2: IDF-weighted distinctive-token scoring.
      // Skip Stage 2 when token_document_freq_raw hasn't been loaded yet
      // (pre-migration or DB unavailable) — fall through to Stage 1 result.
      if (stage2Active) {
        const stage2 = computeStage2Score(firmName, candidate.name);
        const thresh  = stage2.fallbackUsed ? fallbackThresh : stage2Threshold;
        const decision = stage2.weightedScore >= thresh ? 'flag' : 'dismiss';

        const identifierStatus =
          (crdNumber && candidate.crd_number && crdNumber === candidate.crd_number) ? 'crd_match'
          : (cik && candidate.cik && cik === candidate.cik) ? 'cik_match'
          : 'no_conflict';

        const matchReason = {
          stage:                       'stage2',
          raw_trgm_similarity:         candidate.similarity,
          weighted_score:              Math.round(stage2.weightedScore * 1000) / 1000,
          decision,
          threshold_applied:           thresh,
          fallback_used:               stage2.fallbackUsed,
          distinctive_mismatch_tokens: stage2.distinctiveMismatches,
          matched_tokens:              stage2.matchedTokens,
          identifier_status:           identifierStatus,
        };

        if (decision === 'dismiss') continue;

        return candidate.match_type === 'account'
          ? { resolution: 'fuzzy_account',  matchId: candidate.id, matchName: candidate.name, similarity: candidate.similarity, matchReason }
          : { resolution: 'fuzzy_prospect', matchId: candidate.id, matchName: candidate.name, similarity: candidate.similarity, matchReason };
      }

      // Cold-start path (Stage 2 inactive): Stage 1 result stands.
      const matchReason = { stage: 'stage1_only', raw_trgm_similarity: candidate.similarity };
      return candidate.match_type === 'account'
        ? { resolution: 'fuzzy_account',  matchId: candidate.id, matchName: candidate.name, similarity: candidate.similarity, matchReason }
        : { resolution: 'fuzzy_prospect', matchId: candidate.id, matchName: candidate.name, similarity: candidate.similarity, matchReason };
    }
    // All candidates rejected (Fix A mismatches or Stage 2 dismissals)
  }

  // ── Step 7: no match ─────────────────────────────────────────
  return { resolution: 'new' };
}
