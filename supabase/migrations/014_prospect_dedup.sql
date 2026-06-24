-- ============================================================
-- Migration 014: Prospect deduplication, unified multi-source
-- model, account CIK matching, and ICP filtering
-- ============================================================

-- ============================================================
-- RUN THESE ENUM ADDITIONS FIRST, ONE AT A TIME:
-- (PostgreSQL requires enum value commits before they can be
--  referenced in the same transaction.)
-- ============================================================
-- ALTER TYPE prospect_status ADD VALUE IF NOT EXISTS 'matched_to_account';
-- ALTER TYPE prospect_status ADD VALUE IF NOT EXISTS 'possible_duplicate';
-- ============================================================

-- THEN RUN THE REST OF THIS FILE:

-- ── 1. pg_trgm for fuzzy name matching ───────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. CIK + SEC signal columns on accounts ──────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS cik                        text,
  ADD COLUMN IF NOT EXISTS sec_estimated_aum_usd      bigint,
  ADD COLUMN IF NOT EXISTS sec_position_count         integer,
  ADD COLUMN IF NOT EXISTS sec_portfolio_turnover_pct numeric(6,2),
  ADD COLUMN IF NOT EXISTS sec_equities_pct           numeric(5,2),
  ADD COLUMN IF NOT EXISTS sec_options_present        boolean,
  ADD COLUMN IF NOT EXISTS sec_signals_updated_at     timestamptz;

CREATE INDEX IF NOT EXISTS accounts_cik_idx ON public.accounts(cik);

-- ── 3. New columns on prospects ───────────────────────────────
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS matched_to_account_id uuid
    REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_audit_only   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS passes_icp      boolean DEFAULT true;

-- GIN index for trigram fuzzy search on normalized_name
-- (requires pg_trgm, enabled above)
CREATE INDEX IF NOT EXISTS prospects_normalized_name_trgm
  ON public.prospects USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS prospects_passes_icp_idx
  ON public.prospects(passes_icp);

-- ── 4. prospect_sources — per-source provenance ───────────────
CREATE TABLE IF NOT EXISTS public.prospect_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id   uuid NOT NULL
                  REFERENCES public.prospects(id) ON DELETE CASCADE,
  source        prospect_source NOT NULL,
  source_url    text,
  signals       jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prospect_id, source)
);

CREATE INDEX IF NOT EXISTS prospect_sources_prospect_id_idx
  ON public.prospect_sources(prospect_id);

-- ── 5. dedup_queue — fuzzy matches awaiting human review ──────
CREATE TABLE IF NOT EXISTS public.dedup_queue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id          uuid NOT NULL
                         REFERENCES public.prospects(id) ON DELETE CASCADE,
  match_type           text NOT NULL
                         CHECK (match_type IN ('prospect','account')),
  matched_prospect_id  uuid
                         REFERENCES public.prospects(id) ON DELETE CASCADE,
  matched_account_id   uuid
                         REFERENCES public.accounts(id) ON DELETE CASCADE,
  similarity           numeric(4,3),
  matched_name         text,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN
                           ('pending','merged','not_duplicate','dismissed')),
  resolved_by          uuid
                         REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dedup_queue_status_idx
  ON public.dedup_queue(status);
CREATE INDEX IF NOT EXISTS dedup_queue_prospect_id_idx
  ON public.dedup_queue(prospect_id);

-- ── 6. icp_filter_config — single-row ICP thresholds ─────────
CREATE TABLE IF NOT EXISTS public.icp_filter_config (
  id                 integer PRIMARY KEY DEFAULT 1
                       CHECK (id = 1),
  min_aum_usd        bigint       DEFAULT 100000000,
  min_turnover_pct   numeric(5,2) DEFAULT 0,
  excluded_segments  text[]       DEFAULT ARRAY['pension','insurance'],
  min_position_count integer      DEFAULT 0,
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.profiles(id)
);

INSERT INTO public.icp_filter_config (id)
VALUES (1)
ON CONFLICT DO NOTHING;

-- ── 7. normalize_firm_name — strip suffixes, lowercase ────────
CREATE OR REPLACE FUNCTION public.normalize_firm_name(name text)
RETURNS text AS $$
  SELECT trim(regexp_replace(
    lower(name),
    '\y(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|incorporated|corp|corporation'
    '|ltd|limited|capital|management|advisors|advisers|partners|group'
    '|holdings|asset|investments|investment|fund|funds|company|co)\y'
    '|[^a-z0-9 ]',
    '', 'g'
  ));
$$ LANGUAGE sql IMMUTABLE;

-- ── 8. find_similar_firms — trigram RPC ───────────────────────
CREATE OR REPLACE FUNCTION public.find_similar_firms(
  search_name text,
  threshold   numeric DEFAULT 0.5
)
RETURNS TABLE(
  match_type text,
  id         uuid,
  name       text,
  similarity numeric
) AS $$
  SELECT
    'account'::text,
    a.id,
    a.name,
    similarity(
      public.normalize_firm_name(a.name),
      public.normalize_firm_name(search_name)
    )::numeric
  FROM public.accounts a
  WHERE similarity(
    public.normalize_firm_name(a.name),
    public.normalize_firm_name(search_name)
  ) > threshold

  UNION ALL

  SELECT
    'prospect'::text,
    p.id,
    p.firm_name,
    similarity(
      p.normalized_name,
      public.normalize_firm_name(search_name)
    )::numeric
  FROM public.prospects p
  WHERE p.is_audit_only = false
    AND p.normalized_name IS NOT NULL
    AND similarity(
      p.normalized_name,
      public.normalize_firm_name(search_name)
    ) > threshold

  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql STABLE;

-- ── 9. Backfill normalized_name for existing prospects ──────── (renumbered; current_user_role already exists)
UPDATE public.prospects
SET normalized_name = public.normalize_firm_name(firm_name)
WHERE normalized_name IS NULL;

-- ── 10. RLS ───────────────────────────────────────────────────
ALTER TABLE public.prospect_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dedup_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icp_filter_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prospect_sources_select" ON public.prospect_sources;
CREATE POLICY "prospect_sources_select" ON public.prospect_sources
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dedup_queue_select" ON public.dedup_queue;
CREATE POLICY "dedup_queue_select" ON public.dedup_queue
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dedup_queue_update" ON public.dedup_queue;
CREATE POLICY "dedup_queue_update" ON public.dedup_queue
  FOR UPDATE USING (
    public.current_user_role() IN ('admin','sales','operations')
  );

DROP POLICY IF EXISTS "icp_filter_select" ON public.icp_filter_config;
CREATE POLICY "icp_filter_select" ON public.icp_filter_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "icp_filter_update" ON public.icp_filter_config;
CREATE POLICY "icp_filter_update" ON public.icp_filter_config
  FOR ALL USING (is_admin());

-- ── 11. Confirmation ──────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'accounts'
     AND column_name = 'cik')          AS acct_cik,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'prospect_sources') AS sources_tbl,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'dedup_queue')   AS dedup_tbl,
  (SELECT COUNT(*) FROM public.icp_filter_config) AS icp_rows,
  (SELECT COUNT(*) FROM pg_extension
   WHERE extname = 'pg_trgm')          AS trgm;
-- Expected: 1, 1, 1, 1, 1
