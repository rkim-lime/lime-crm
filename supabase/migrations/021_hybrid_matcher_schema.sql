-- ============================================================
-- Migration 021: Hybrid matcher schema — Part A
--
-- Adds the data structures needed for Stage 2 TF-IDF re-scoring
-- in the dedup pipeline. No existing data is mutated; the actual
-- re-scoring logic (Part B) is wired in after this migration runs.
--
-- Changes:
--   1. token_document_freq  — materialized view: one row per distinct
--      token appearing in prospects.normalized_name, with its document
--      frequency and pre-computed IDF score.
--   2. recompute_token_freq() — SECURITY DEFINER function to refresh
--      the view after bulk ingests.
--   3. matcher_config  — key/value config table (text + category);
--      seeded with Stage 1 and Stage 2 thresholds and heuristics.
--   4. dedup_queue.match_reason jsonb  — per-decision explainability
--      payload written by Part B.
-- ============================================================

-- ── 1. Token document-frequency materialized view ───────────────
--
-- IDF(token) = ln( (N + 1) / (doc_count + 1) )
--
-- High IDF = rare in corpus = name-distinctive (e.g. "point72").
-- Low IDF  = common in corpus = boilerplate (e.g. "north").
-- The +1 smoothing avoids ln(0) and shrinks the gap between very
-- rare and moderately rare tokens.
--
-- Only non-audit prospects with a non-empty normalized_name enter
-- the corpus — same scope as find_similar_firms(). Tokens shorter
-- than 2 chars are excluded (single-char residue after stripping).
CREATE MATERIALIZED VIEW IF NOT EXISTS public.token_document_freq AS
WITH corpus AS (
  SELECT
    id,
    regexp_split_to_table(normalized_name, '\s+') AS token
  FROM public.prospects
  WHERE is_audit_only = false
    AND normalized_name IS NOT NULL
    AND normalized_name <> ''
),
counts AS (
  SELECT
    token,
    COUNT(DISTINCT id)::integer AS doc_count
  FROM corpus
  WHERE length(token) >= 2
  GROUP BY token
),
total AS (
  SELECT COUNT(*)::integer AS n
  FROM public.prospects
  WHERE is_audit_only = false
    AND normalized_name IS NOT NULL
    AND normalized_name <> ''
)
SELECT
  c.token,
  c.doc_count,
  t.n AS total_docs,
  ln((t.n::numeric + 1) / (c.doc_count + 1)) AS idf
FROM counts c, total t;

-- Unique index is required for REFRESH CONCURRENTLY (used by
-- recompute_token_freq() at runtime, outside a transaction).
CREATE UNIQUE INDEX IF NOT EXISTS token_document_freq_token_idx
  ON public.token_document_freq (token);

GRANT SELECT ON public.token_document_freq TO authenticated;
GRANT SELECT ON public.token_document_freq TO service_role;

-- ── 2. recompute_token_freq() ────────────────────────────────────
--
-- Refreshes the materialized view concurrently (no exclusive lock
-- on readers). Call this from the ingestion pipeline after any
-- bulk ingest. Restricted to service_role — it's a maintenance op,
-- not a user-facing function.
CREATE OR REPLACE FUNCTION public.recompute_token_freq()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.token_document_freq;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_token_freq() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_token_freq() TO service_role;

-- ── 3. matcher_config — config-driven thresholds ────────────────
--
-- All values stored as text; callers cast to numeric/boolean as
-- needed. No enum types — add new categories freely via INSERT.
--
-- Categories:
--   'threshold'  — numeric cut-offs that gate decisions
--   'weight'     — numeric multipliers that shape scores
--   'heuristic'  — boolean flags for token classification rules
--   'cadence'    — scheduling hints (cron expression, not enforced by DB)
CREATE TABLE IF NOT EXISTS public.matcher_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  category    text NOT NULL DEFAULT 'threshold',
  description text
);

ALTER TABLE public.matcher_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matcher_config_select" ON public.matcher_config;
CREATE POLICY "matcher_config_select" ON public.matcher_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "matcher_config_admin" ON public.matcher_config;
CREATE POLICY "matcher_config_admin" ON public.matcher_config
  FOR ALL USING (public.is_admin());

-- Seed defaults. ON CONFLICT DO NOTHING so re-running the migration
-- (e.g. after a rollback) doesn't clobber values already tuned in prod.
INSERT INTO public.matcher_config (key, value, category, description) VALUES
  (
    'stage1_recall_threshold',
    '0.3',
    'threshold',
    'pg_trgm lower bound for candidate generation. Intentionally loose — Stage 2 re-scores and decides. Lowering increases recall at cost of more Stage 2 work.'
  ),
  (
    'stage2_decision_threshold',
    '0.65',
    'threshold',
    'Minimum weighted-similarity score to flag a pair as a potential duplicate. Pairs below this are dismissed as not_duplicate automatically.'
  ),
  (
    'distinctiveness_threshold',
    '2.5',
    'threshold',
    'Minimum IDF value for a token to be treated as name-distinctive. With a 60-prospect corpus ln((N+1)/(df+1)) > 2.5 means the token appears in ≤ ~7 documents.'
  ),
  (
    'weighting_strength',
    '0.6',
    'weight',
    'Fraction of the final score suppressed when a distinctive token appears in one name but not the other. 0 = ignore distinctiveness; 1 = near-zero score on any mismatch.'
  ),
  (
    'min_token_len_for_distinctive',
    '4',
    'heuristic',
    'Tokens shorter than this many characters are never treated as name-distinctive, regardless of IDF. Prevents two-letter abbreviations (ok, ny) from driving mismatch penalties.'
  ),
  (
    'digit_tokens_distinctive',
    'true',
    'heuristic',
    'When true, any token containing a digit (e.g. point72, 4thought, 1847) is always treated as name-distinctive regardless of its IDF or length.'
  ),
  (
    'freq_recompute_cadence',
    '0 2 * * 0',
    'cadence',
    'Suggested cron schedule for recompute_token_freq() — weekly on Sunday at 02:00. Not enforced by the DB; wire into pg_cron or an Edge Function scheduler.'
  )
ON CONFLICT (key) DO NOTHING;

-- ── 4. dedup_queue.match_reason — per-decision explainability ────
--
-- Written by Part B matcher logic. Shape (not enforced by DB):
-- {
--   "stage": "stage2",
--   "raw_trgm_similarity": 0.75,
--   "weighted_score": 0.42,
--   "decision": "dismiss" | "flag",
--   "distinctive_mismatch_tokens": ["point72"],
--   "matched_tokens": [
--     { "token": "park",    "idf": 3.1,  "distinctive": true,  "matched": true },
--     { "token": "place",   "idf": 2.8,  "distinctive": true,  "matched": true }
--   ],
--   "identifier_status": "no_conflict" | "crd_conflict" | "cik_conflict"
-- }
ALTER TABLE public.dedup_queue
  ADD COLUMN IF NOT EXISTS match_reason jsonb;

-- ── 5. Confirmation ──────────────────────────────────────────────
SELECT
  (SELECT COUNT(*)    FROM public.token_document_freq)            AS token_freq_rows,
  (SELECT MAX(idf)    FROM public.token_document_freq)            AS max_idf,
  (SELECT MIN(idf)    FROM public.token_document_freq)            AS min_idf,
  (SELECT COUNT(*)    FROM public.matcher_config)                 AS matcher_config_rows,
  (SELECT column_name FROM information_schema.columns
   WHERE  table_name  = 'dedup_queue'
     AND  column_name = 'match_reason')                           AS match_reason_col_added;
-- Expected:
--   token_freq_rows   > 0    (one row per distinct token in normalized_name corpus)
--   max_idf           high   (tokens appearing in exactly 1 doc have the highest IDF)
--   min_idf           ~0     (tokens appearing in every doc have IDF near 0)
--   matcher_config_rows = 7
--   match_reason_col_added = 'match_reason'
