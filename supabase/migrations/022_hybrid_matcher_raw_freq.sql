-- ============================================================
-- Migration 022: Replace token frequency index with raw-name corpus
--
-- Problem with migration 021: token_document_freq was built over
-- normalized_name (stopwords already stripped). This compressed the
-- IDF range to 3.40–5.54 — every surviving token looks equally
-- distinctive, so IDF can't separate generic from rare tokens.
--
-- Fix: Stage 2 IDF must be computed from LIGHTLY-normalised raw
-- firm names (lowercase + punct strip only, NO stopword removal).
-- This lets 'management', 'capital', 'llc' accumulate high doc_count
-- and earn low IDF naturally — they self-demote without a hardcoded
-- stoplist. Jurisdiction-adaptive: 'gmbh', 'plc', 'pte' earn low IDF
-- automatically if they're common in the corpus.
--
-- Two-view design (one per stage):
--   Stage 1 recall  — pg_trgm GIN on prospects.normalized_name
--                     (unchanged, no frequency view needed here)
--   Stage 2 scoring — token_document_freq_raw, built from raw names
--
-- Also adds Stage 1 stopwords surfaced as noise:
--   'the'      — grammatical particle (anywhere)
--   'i'..'x'   — roman numerals used in fund/series suffixes (trailing_only)
-- ============================================================

-- ── 1. Drop the normalised-name frequency view (built from migration 021) ───
-- Nothing references this view yet — Part B hasn't been built.
DROP MATERIALIZED VIEW  IF EXISTS public.token_document_freq CASCADE;
-- CASCADE drops the unique index token_document_freq_token_idx automatically.

DROP FUNCTION IF EXISTS public.recompute_token_freq();

-- ── 2. Raw-name token frequency view (Stage 2 IDF corpus) ────────────────────
--
-- Light normalisation only: lowercase + strip non-alphanumeric + collapse
-- whitespace. No stopword removal. Both prospects and accounts are included
-- because find_similar_firms() searches both tables.
--
-- IDF(token) = ln( (N+1) / (doc_count+1) )
--   N         = total documents in corpus (all firm names, deduped by id)
--   doc_count = number of distinct firms containing this token
--
-- Expected after this migration:
--   'management' → doc_count high → IDF ≈ 0.5–1.5  (common, ignored by Stage 2)
--   'capital'    → doc_count high → IDF ≈ 0.5–1.5
--   'llc'        → doc_count very high → IDF < 0.5
--   'point72'    → doc_count = 1  → IDF ≈ 5.5      (highly distinctive)
--   IDF range    → wide: ~0 to 5.5+ (vs 3.40–5.54 before)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.token_document_freq_raw AS
WITH
  normed AS (
    -- Prospects: lightly normalise firm_name
    SELECT
      id::text AS doc_id,
      trim(regexp_replace(
        regexp_replace(lower(firm_name), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g'
      )) AS n
    FROM public.prospects
    WHERE firm_name IS NOT NULL
      AND firm_name <> ''
      AND is_audit_only = false

    UNION ALL

    -- Accounts: lightly normalise name
    SELECT
      id::text AS doc_id,
      trim(regexp_replace(
        regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g'
      )) AS n
    FROM public.accounts
    WHERE name IS NOT NULL
      AND name <> ''
  ),
  tokens AS (
    SELECT doc_id, regexp_split_to_table(n, '\s+') AS token
    FROM normed
    WHERE n IS NOT NULL AND n <> ''
  ),
  counts AS (
    SELECT
      token,
      COUNT(DISTINCT doc_id)::integer AS doc_count
    FROM tokens
    WHERE length(token) >= 2
    GROUP BY token
  ),
  total AS (
    SELECT COUNT(DISTINCT doc_id)::integer AS n
    FROM normed
    WHERE n IS NOT NULL AND n <> ''
  )
SELECT
  c.token,
  c.doc_count,
  t.n AS total_docs,
  ln((t.n::numeric + 1) / (c.doc_count + 1)) AS idf
FROM counts c, total t;

-- Unique index required for REFRESH CONCURRENTLY (used by recompute_token_freq()).
CREATE UNIQUE INDEX IF NOT EXISTS token_document_freq_raw_token_idx
  ON public.token_document_freq_raw (token);

GRANT SELECT ON public.token_document_freq_raw TO authenticated;
GRANT SELECT ON public.token_document_freq_raw TO service_role;

-- ── 3. Recompute function (refreshes raw view) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_token_freq()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.token_document_freq_raw;
END;
$$;

REVOKE ALL  ON FUNCTION public.recompute_token_freq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_token_freq() TO service_role;

-- ── 4. Add Stage 1 stopwords ─────────────────────────────────────────────────
--
-- 'the'  — grammatical particle, anywhere
-- Roman numerals i–x — fund/series suffixes, trailing_only.
--   Trailing_only prevents 'I Capital Partners' from losing its leading 'I',
--   just as 'AB', 'AS', 'SA' are preserved mid-name.
--   Accepted edge case: a firm whose ONLY distinctive token is a single
--   roman numeral will normalise to '' (same behaviour as 'AS CAPITAL MANAGEMENT AB').
INSERT INTO public.name_stopwords (word, category, position) VALUES
  ('the',   'structural', 'anywhere'),
  ('i',     'structural', 'trailing_only'),
  ('ii',    'structural', 'trailing_only'),
  ('iii',   'structural', 'trailing_only'),
  ('iv',    'structural', 'trailing_only'),
  ('v',     'structural', 'trailing_only'),
  ('vi',    'structural', 'trailing_only'),
  ('vii',   'structural', 'trailing_only'),
  ('viii',  'structural', 'trailing_only'),
  ('ix',    'structural', 'trailing_only'),
  ('x',     'structural', 'trailing_only')
ON CONFLICT (word) DO NOTHING;

-- ── 5. Recompute Stage 1 normalized_name (new stopwords in effect) ───────────
UPDATE public.prospects
SET    normalized_name = public.normalize_firm_name(firm_name)
WHERE  firm_name IS NOT NULL;

-- ── 6. Confirmation ──────────────────────────────────────────────────────────
SELECT
  -- Raw IDF should now discriminate generic from distinctive tokens
  (SELECT doc_count FROM public.token_document_freq_raw WHERE token = 'management') AS management_doccount,
  (SELECT ROUND(idf::numeric, 2)
                      FROM public.token_document_freq_raw WHERE token = 'management') AS management_idf,
  (SELECT doc_count FROM public.token_document_freq_raw WHERE token = 'capital')    AS capital_doccount,
  (SELECT ROUND(idf::numeric, 2)
                      FROM public.token_document_freq_raw WHERE token = 'capital')    AS capital_idf,
  (SELECT doc_count FROM public.token_document_freq_raw WHERE token = 'llc')        AS llc_doccount,
  (SELECT ROUND(idf::numeric, 2)
                      FROM public.token_document_freq_raw WHERE token = 'llc')        AS llc_idf,
  (SELECT doc_count FROM public.token_document_freq_raw WHERE token = 'point72')    AS point72_doccount,
  (SELECT ROUND(idf::numeric, 2)
                      FROM public.token_document_freq_raw WHERE token = 'point72')    AS point72_idf,
  (SELECT COUNT(*)  FROM public.token_document_freq_raw)                             AS total_raw_tokens,
  (SELECT COUNT(*)  FROM public.name_stopwords WHERE enabled)                        AS stopwords_total;
-- Expected:
--   management_doccount  high  (20+),  management_idf   low  (< 2.0)
--   capital_doccount     high  (20+),  capital_idf      low  (< 2.0)
--   llc_doccount         very high,    llc_idf          very low (< 1.0)
--   point72_doccount     1,            point72_idf      high (≈ 5.5)
--   total_raw_tokens  >> 656  (wider vocabulary without stopword stripping)
--   stopwords_total   = ~41   (30 original + 11 new)
