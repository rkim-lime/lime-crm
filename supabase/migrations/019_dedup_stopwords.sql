-- ============================================================
-- Migration 019: Config-driven name stopwords for dedup
--
-- Fixes three related false-positive problems in fuzzy firm matching:
--
-- A. find_similar_firms now returns crd_number and cik so resolveFirm.js
--    can reject candidates where both firms carry distinct non-null identifiers.
--    Two different CRDs = definitively different firms; pg_trgm name similarity
--    must never override a regulatory-ID mismatch.
--
-- B. normalize_firm_name() gains a two-pass approach (punctuation removal first,
--    then stopwords) and expands the stripped word set with industry descriptors
--    that were producing false positives: advisory, financial, planning, wealth,
--    services, retirement, plan. NOTE: 'advisory' was missing from the prior
--    regex despite 'advisors'/'advisers' being present.
--
-- C. The stopword list is now config-driven: INSERT/UPDATE a row in
--    name_stopwords and both the SQL normalize_firm_name() and the JS
--    normalizeName() pick it up — no code or migration change required.
--    (JS picks it up on process restart via loadStopwords().)
-- ============================================================

-- ── 1. name_stopwords config table ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.name_stopwords (
  word      text    PRIMARY KEY,
  category  text    NOT NULL DEFAULT 'structural'
              CHECK (category IN ('structural', 'industry', 'geographic')),
  enabled   boolean NOT NULL DEFAULT true
);

-- RLS: all authenticated users can read (normalization runs inside queries);
-- only admins can insert, update, or delete.
ALTER TABLE public.name_stopwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "name_stopwords_select" ON public.name_stopwords;
CREATE POLICY "name_stopwords_select" ON public.name_stopwords
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "name_stopwords_admin" ON public.name_stopwords;
CREATE POLICY "name_stopwords_admin" ON public.name_stopwords
  FOR ALL USING (public.is_admin());

-- ── 2. Seed stopword list ────────────────────────────────────────
-- SINGLE SOURCE OF TRUTH for which words are stripped during normalization.
-- The JS SEED_STOPWORDS constant in resolveFirm.js must mirror this list
-- exactly so that SQL and JS normalization produce identical output.
INSERT INTO public.name_stopwords (word, category) VALUES
  -- structural: legal entity types and high-frequency finance terms
  ('llc',          'structural'),
  ('lp',           'structural'),
  ('inc',          'structural'),
  ('incorporated', 'structural'),
  ('corp',         'structural'),
  ('corporation',  'structural'),
  ('ltd',          'structural'),
  ('limited',      'structural'),
  ('capital',      'structural'),
  ('management',   'structural'),
  ('advisors',     'structural'),
  ('advisers',     'structural'),
  ('partners',     'structural'),
  ('group',        'structural'),
  ('holdings',     'structural'),
  ('asset',        'structural'),
  ('investments',  'structural'),
  ('investment',   'structural'),
  ('fund',         'structural'),
  ('funds',        'structural'),
  ('company',      'structural'),
  ('co',           'structural'),
  -- industry: generic descriptors shared across too many distinct advisory firms
  -- 'advisory' was missing from the prior regex despite 'advisors'/'advisers' being present
  ('advisory',     'industry'),
  ('financial',    'industry'),
  ('planning',     'industry'),
  ('wealth',       'industry'),
  ('services',     'industry'),
  ('retirement',   'industry'),
  ('plan',         'industry'),
  -- geographic: boilerplate location tokens — add more rows here as new
  -- false-positive patterns emerge; no code or migration change required
  ('singapore',    'geographic')
ON CONFLICT (word) DO NOTHING;

-- ── 3. Immutable raw normalizer ──────────────────────────────────
-- Accepts the pre-built stopword pattern as an argument so that
-- find_similar_firms (below) can build the pattern once per query call
-- rather than once per candidate row.
--
-- Two-pass logic — must match JS normalizeName() in resolveFirm.js exactly:
--   1. Strip non-alphanumeric/space chars  → handles L.L.C., Inc., & etc.
--   2. Strip whole-word stopwords (\y = word boundary)
--   3. Collapse whitespace runs
CREATE OR REPLACE FUNCTION public.normalize_firm_name_raw(name text, pattern text)
RETURNS text AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
      pattern, '', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$ LANGUAGE sql IMMUTABLE;

-- ── 4. Public normalize_firm_name (reads stopwords from table) ───
-- STABLE (not IMMUTABLE) because it queries name_stopwords.
-- The GIN index on normalized_name is on a stored column — not an expression
-- index — so this volatility change has no effect on index validity.
CREATE OR REPLACE FUNCTION public.normalize_firm_name(name text)
RETURNS text AS $$
DECLARE
  pattern text;
BEGIN
  SELECT '\y(' || string_agg(word, '|' ORDER BY length(word) DESC) || ')\y'
  INTO   pattern
  FROM   public.name_stopwords
  WHERE  enabled = true;
  RETURN public.normalize_firm_name_raw(name, pattern);
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 5. Updated find_similar_firms ────────────────────────────────
-- Changes vs migration 014:
--   • Returns crd_number and cik per candidate (Fix A — lets resolveFirm.js
--     reject candidates with conflicting non-null identifiers).
--   • Builds stopword pattern once per call via CTE (not once per row).
--   • Accounts query uses normalize_firm_name_raw(a.name, pattern) for
--     on-the-fly normalization of the small accounts table.
--   • Prospects query uses pre-stored p.normalized_name (maintained by
--     runConnector.js upserts and the backfill in step 7 below).
--
-- Postgres refuses CREATE OR REPLACE when the RETURNS TABLE column list changes.
-- The original function (migration 014) returned (match_type, id, name, similarity).
-- The new version adds crd_number and cik → must DROP first.
-- No views, triggers, or other functions reference find_similar_firms;
-- it is called only from resolveFirm.js as an RPC. No CASCADE needed.
DROP FUNCTION IF EXISTS public.find_similar_firms(text, numeric);

CREATE FUNCTION public.find_similar_firms(
  search_name text,
  threshold   numeric DEFAULT 0.5
)
RETURNS TABLE(
  match_type  text,
  id          uuid,
  name        text,
  similarity  numeric,
  crd_number  text,
  cik         text
) AS $$
  WITH
    stopwords AS (
      SELECT '\y(' || string_agg(word, '|' ORDER BY length(word) DESC) || ')\y' AS pat
      FROM   public.name_stopwords
      WHERE  enabled = true
    ),
    norm_search AS (
      SELECT public.normalize_firm_name_raw($1, s.pat) AS val
      FROM   stopwords s
    )
  SELECT
    'account'::text,
    a.id,
    a.name,
    similarity(
      public.normalize_firm_name_raw(a.name, s.pat),
      ns.val
    )::numeric,
    a.crd_number,
    a.cik
  FROM   public.accounts a, stopwords s, norm_search ns
  WHERE  similarity(
    public.normalize_firm_name_raw(a.name, s.pat),
    ns.val
  ) > threshold

  UNION ALL

  SELECT
    'prospect'::text,
    p.id,
    p.firm_name,
    similarity(p.normalized_name, ns.val)::numeric,
    p.crd_number,
    p.cik
  FROM   public.prospects p, norm_search ns
  WHERE  p.is_audit_only = false
    AND  p.normalized_name IS NOT NULL
    AND  similarity(p.normalized_name, ns.val) > threshold

  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql STABLE;

-- Re-grant execute after DROP+CREATE (DROP removes any previously inherited grants).
-- The ingestion pipeline uses the service_role key (bypasses grants), but re-granting
-- here keeps the RPC callable from client-side authenticated sessions and matches
-- Supabase's default behaviour for public-schema functions.
GRANT EXECUTE ON FUNCTION public.find_similar_firms(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_firms(text, numeric) TO anon;

-- ── 6. name_similarity helper (used by recheck-dedup-queue.js) ──
CREATE OR REPLACE FUNCTION public.name_similarity(name_a text, name_b text)
RETURNS numeric AS $$
  SELECT similarity(
    public.normalize_firm_name(name_a),
    public.normalize_firm_name(name_b)
  )::numeric;
$$ LANGUAGE sql STABLE;

-- ── 7. Recompute normalized_name with expanded stopword set ─────
-- Existing rows were normalized with the old function. The GIN trigram
-- index on normalized_name is updated automatically by this UPDATE.
UPDATE public.prospects
SET    normalized_name = public.normalize_firm_name(firm_name)
WHERE  firm_name IS NOT NULL;

-- ── 8. Confirmation ──────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.name_stopwords WHERE enabled)              AS stopwords_active,
  (SELECT COUNT(*) FROM public.prospects WHERE normalized_name IS NOT NULL) AS prospects_normalized,
  (SELECT COUNT(*) FROM public.dedup_queue WHERE status = 'pending')      AS dedup_pending;
-- Expected: 30 active stopwords, N normalized prospects, M pending (run recheck-dedup-queue.js next)
