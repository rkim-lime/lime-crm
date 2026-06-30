-- ============================================================
-- Migration 020: Positional stopword stripping for firm-name dedup
--
-- Adds a 'position' column to name_stopwords with two values:
--   'anywhere'     — word is stripped wherever it appears (industry descriptors
--                    like 'financial', 'advisory', 'wealth' that can lead, trail
--                    or appear mid-name)
--   'trailing_only' — word is stripped only when it is the LAST token in the
--                    normalized name (entity-type suffixes like 'llc', 'pte',
--                    'gmbh' that are always structural suffixes, not name content)
--
-- This prevents ambiguous short tokens ('sa', 'as', 'ab', 'ag') from being
-- stripped when they appear as leading initials rather than trailing suffixes.
-- E.g. "SAMSUNG ASSET MANAGEMENT SA" → 'samsung' (trailing 'sa' stripped)
--      "AB GLOBAL PARTNERS LLC"     → 'ab global' (leading 'ab' preserved)
--
-- Also adds the international corporate-suffix set missing from 019:
--   pte, pty, gmbh, ag, sa, sas, bv, nv, sarl, srl, spa, ab, as,
--   oy, kk, plc, ulc, aps, llp
--
-- normalize_firm_name_raw() signature changes from (text, text) to
-- (text, text, text) to accept two patterns. The old 2-arg overload
-- is dropped at the end of this migration after callers are updated.
-- ============================================================

-- ── 1. Add position column ───────────────────────────────────────
ALTER TABLE public.name_stopwords
  ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT 'anywhere'
    CHECK (position IN ('anywhere', 'trailing_only'));

-- ── 2. Re-classify existing entity-type words as trailing_only ───
-- Pure legal entity markers always live at the end of firm names.
-- Finance/industry descriptors (capital, management, advisors, etc.)
-- stay 'anywhere' — they genuinely appear leading, mid, and trailing.
UPDATE public.name_stopwords
SET    position = 'trailing_only'
WHERE  word IN (
  'llc', 'lp', 'inc', 'incorporated', 'corp', 'corporation',
  'ltd', 'limited', 'company', 'co'
);

-- ── 3. Add international corporate suffixes (all trailing_only) ──
-- Confirm: ltd ✓  limited ✓  lp ✓  (from migration 019 seed)
--          llp ✗  plc ✗  (missing from 019 — added here)
INSERT INTO public.name_stopwords (word, category, position) VALUES
  -- English / Commonwealth
  ('llp',  'structural', 'trailing_only'),
  ('plc',  'structural', 'trailing_only'),
  ('ulc',  'structural', 'trailing_only'),  -- Canada unlimited liability
  -- Oceania
  ('pty',  'structural', 'trailing_only'),  -- Australia / South Africa
  -- Singapore / SE Asia
  ('pte',  'structural', 'trailing_only'),
  -- German-speaking
  ('gmbh', 'structural', 'trailing_only'),
  ('ag',   'structural', 'trailing_only'),  -- Aktiengesellschaft
  -- French
  ('sa',   'structural', 'trailing_only'),  -- Société anonyme  (ambiguous — trailing_only)
  ('sas',  'structural', 'trailing_only'),  -- Société par actions simplifiée
  ('sarl', 'structural', 'trailing_only'),  -- Société à responsabilité limitée
  -- Italian / Romanian
  ('srl',  'structural', 'trailing_only'),
  ('spa',  'structural', 'trailing_only'),  -- Società per azioni
  -- Dutch / Belgian
  ('bv',   'structural', 'trailing_only'),
  ('nv',   'structural', 'trailing_only'),
  -- Swedish
  ('ab',   'structural', 'trailing_only'),  -- Aktiebolag  (ambiguous — trailing_only)
  -- Nordic (Norway / Denmark)
  ('as',   'structural', 'trailing_only'),  -- Aksjeselskap / Aktieselskab (ambiguous — trailing_only)
  ('aps',  'structural', 'trailing_only'),  -- Anpartsselskab (Denmark)
  -- Finnish
  ('oy',   'structural', 'trailing_only'),  -- Osakeyhtiö
  -- Japanese
  ('kk',   'structural', 'trailing_only')   -- Kabushiki Kaisha
ON CONFLICT (word) DO NOTHING;

-- ── 4. New 3-arg normalize_firm_name_raw ────────────────────────
-- Replaces the 2-arg version from migration 019.
-- The old 2-arg overload is dropped at step 8, after callers are updated.
--
-- Applies three passes:
--   1. Strip punctuation         [^a-z0-9 ]
--   2. Strip 'anywhere' words    \y(word)\y globally
--   3. Collapse spaces
--   4. Loop: strip 'trailing_only' words from the end until stable
--
-- The trailing_pattern arg must include the \s*$ anchor so this function
-- can remain IMMUTABLE (pure string logic, no DB access).
CREATE OR REPLACE FUNCTION public.normalize_firm_name_raw(
  name              text,
  anywhere_pattern  text,   -- '\y(word1|word2|...)\y'
  trailing_pattern  text    -- '\y(word1|word2|...)\y\s*$'
)
RETURNS text AS $$
DECLARE
  result text;
  prev   text;
BEGIN
  -- Pass 1: lowercase + strip punctuation
  result := regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g');
  -- Pass 2: strip 'anywhere' stopwords
  result := regexp_replace(result, anywhere_pattern, '', 'g');
  -- Collapse before trailing pass so we have clean token boundaries
  result := trim(regexp_replace(result, '\s+', ' ', 'g'));
  -- Pass 3: iteratively strip trailing-only stopwords
  LOOP
    prev   := result;
    result := rtrim(regexp_replace(result, trailing_pattern, ''));
    EXIT WHEN result = prev OR result = '';
  END LOOP;
  RETURN trim(regexp_replace(result, '\s+', ' ', 'g'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 5. Update normalize_firm_name to use two-pattern approach ───
CREATE OR REPLACE FUNCTION public.normalize_firm_name(name text)
RETURNS text AS $$
DECLARE
  anywhere_pattern text;
  trailing_pattern text;
BEGIN
  SELECT
    '\y(' || COALESCE(
      string_agg(word, '|' ORDER BY length(word) DESC)
        FILTER (WHERE position = 'anywhere'), 'xnomatchx'
    ) || ')\y',
    '\y(' || COALESCE(
      string_agg(word, '|' ORDER BY length(word) DESC)
        FILTER (WHERE position = 'trailing_only'), 'xnomatchx'
    ) || ')\y\s*$'
  INTO anywhere_pattern, trailing_pattern
  FROM public.name_stopwords
  WHERE enabled = true;

  RETURN public.normalize_firm_name_raw(name, anywhere_pattern, trailing_pattern);
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 6. Update find_similar_firms to use two-pattern approach ────
-- Return type unchanged (match_type, id, name, similarity, crd_number, cik)
-- so CREATE OR REPLACE is valid here — no DROP needed.
CREATE OR REPLACE FUNCTION public.find_similar_firms(
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
    patterns AS (
      SELECT
        '\y(' || COALESCE(
          string_agg(word, '|' ORDER BY length(word) DESC)
            FILTER (WHERE position = 'anywhere'), 'xnomatchx'
        ) || ')\y'         AS anywhere_pat,
        '\y(' || COALESCE(
          string_agg(word, '|' ORDER BY length(word) DESC)
            FILTER (WHERE position = 'trailing_only'), 'xnomatchx'
        ) || ')\y\s*$'     AS trailing_pat
      FROM public.name_stopwords
      WHERE enabled = true
    ),
    norm_search AS (
      SELECT public.normalize_firm_name_raw($1, p.anywhere_pat, p.trailing_pat) AS val
      FROM   patterns p
    )
  SELECT
    'account'::text,
    a.id,
    a.name,
    similarity(
      public.normalize_firm_name_raw(a.name, p.anywhere_pat, p.trailing_pat),
      ns.val
    )::numeric,
    a.crd_number,
    a.cik
  FROM   public.accounts a, patterns p, norm_search ns
  WHERE  similarity(
    public.normalize_firm_name_raw(a.name, p.anywhere_pat, p.trailing_pat),
    ns.val
  ) > threshold

  UNION ALL

  SELECT
    'prospect'::text,
    pr.id,
    pr.firm_name,
    similarity(pr.normalized_name, ns.val)::numeric,
    pr.crd_number,
    pr.cik
  FROM   public.prospects pr, norm_search ns
  WHERE  pr.is_audit_only = false
    AND  pr.normalized_name IS NOT NULL
    AND  similarity(pr.normalized_name, ns.val) > threshold

  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql STABLE;

-- ── 7. Rebuild name_similarity helper (body unchanged) ──────────
CREATE OR REPLACE FUNCTION public.name_similarity(name_a text, name_b text)
RETURNS numeric AS $$
  SELECT similarity(
    public.normalize_firm_name(name_a),
    public.normalize_firm_name(name_b)
  )::numeric;
$$ LANGUAGE sql STABLE;

-- ── 8. Drop old 2-arg normalize_firm_name_raw ───────────────────
-- normalize_firm_name and find_similar_firms now call the 3-arg version,
-- so the 2-arg overload has no callers and can be safely dropped.
DROP FUNCTION IF EXISTS public.normalize_firm_name_raw(text, text);

-- ── 9. Recompute normalized_name with trailing-position logic ───
UPDATE public.prospects
SET    normalized_name = public.normalize_firm_name(firm_name)
WHERE  firm_name IS NOT NULL;

-- ── 10. Confirmation ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.name_stopwords WHERE enabled AND position = 'anywhere')      AS anywhere_words,
  (SELECT COUNT(*) FROM public.name_stopwords WHERE enabled AND position = 'trailing_only') AS trailing_words,
  (SELECT COUNT(*) FROM public.prospects WHERE normalized_name IS NOT NULL)                 AS prospects_normalized,
  -- Spot-check the two canonical test cases:
  public.normalize_firm_name('ESR SINGAPORE PTE LTD')          AS esr_test,    -- expect: 'esr'
  public.normalize_firm_name('PGIM (SINGAPORE) PTE. LTD.')     AS pgim_test,   -- expect: 'pgim'
  public.normalize_firm_name('AB GLOBAL PARTNERS LLC')          AS ab_test,     -- expect: 'ab global'
  public.normalize_firm_name('SAMSUNG ASSET MANAGEMENT SA')     AS sa_test;     -- expect: 'samsung'
-- Expected: ~20 anywhere, ~28 trailing, N normalized prospects,
--           esr | pgim | ab global | samsung
