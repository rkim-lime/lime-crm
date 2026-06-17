-- ============================================================
-- Migration 010: Prospect Engine — schema + RLS
-- Run migration 011 after this one to seed scoring_config.
-- ============================================================

-- ── 1. Extend score_type enum ─────────────────────────────────
ALTER TYPE score_type ADD VALUE IF NOT EXISTS 'prospect_fit';

-- ── 2. New enums ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE prospect_source AS ENUM ('sec_13f', 'manual', 'referral');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE prospect_status AS ENUM (
    'uncontacted', 'contacted', 'qualified', 'disqualified', 'converted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE prospect_jurisdiction AS ENUM ('us', 'eu', 'uk', 'apac', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. prospects table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospects (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name                text         NOT NULL,
  cik                      text,
  source                   prospect_source NOT NULL DEFAULT 'manual',
  source_url               text,
  status                   prospect_status NOT NULL DEFAULT 'uncontacted',
  jurisdiction             prospect_jurisdiction,
  estimated_aum_usd        bigint,
  position_count           integer,
  portfolio_turnover_pct   numeric(6,2),
  equities_pct             numeric(6,2),
  options_present          boolean      NOT NULL DEFAULT false,
  inferred_segment         text,
  fit_score                integer      CHECK (fit_score BETWEEN 0 AND 100),
  fit_score_computed_at    timestamptz,
  assigned_to              uuid         REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes                    text,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now()
);

-- Unique per (CIK, source) — allows multiple null CIKs for manual prospects
CREATE UNIQUE INDEX IF NOT EXISTS prospects_cik_source_unique
  ON public.prospects(cik, source)
  WHERE cik IS NOT NULL;

-- ── 4. prospect_filings table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_filings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  filing_type      text        NOT NULL,
  accession_no     text        NOT NULL,
  period_of_report date,
  filed_at         date,
  total_value_usd  bigint,
  holding_count    integer,
  source_url       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_filings_accession_no_key UNIQUE (accession_no)
);

-- ── 5. prospect_holdings table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_holdings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  filing_id        uuid        NOT NULL REFERENCES public.prospect_filings(id) ON DELETE CASCADE,
  period_of_report date,
  cusip            text        NOT NULL,
  issuer_name      text,
  value_usd        bigint,
  shares           bigint,
  class_title      text,
  put_call         text        CHECK (put_call IN ('Put','Call')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 6. prospect_fit_scores history table ──────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_fit_scores (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  score        integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
  breakdown    jsonb       NOT NULL DEFAULT '{}',
  computed_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 7. updated_at trigger on prospects ───────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON public.prospects;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 8. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS prospects_source_idx
  ON public.prospects(source);
CREATE INDEX IF NOT EXISTS prospects_status_idx
  ON public.prospects(status);
CREATE INDEX IF NOT EXISTS prospects_fit_score_idx
  ON public.prospects(fit_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS prospects_assigned_to_idx
  ON public.prospects(assigned_to);

CREATE INDEX IF NOT EXISTS prospect_filings_prospect_id_idx
  ON public.prospect_filings(prospect_id);
CREATE INDEX IF NOT EXISTS prospect_filings_period_idx
  ON public.prospect_filings(period_of_report DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS prospect_holdings_prospect_period_idx
  ON public.prospect_holdings(prospect_id, period_of_report DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS prospect_holdings_filing_id_idx
  ON public.prospect_holdings(filing_id);
CREATE INDEX IF NOT EXISTS prospect_holdings_cusip_idx
  ON public.prospect_holdings(cusip);

CREATE INDEX IF NOT EXISTS prospect_fit_scores_prospect_idx
  ON public.prospect_fit_scores(prospect_id, computed_at DESC);

-- ── 9. RLS ────────────────────────────────────────────────────
ALTER TABLE public.prospects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_filings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_fit_scores ENABLE ROW LEVEL SECURITY;

-- prospects: read for all authenticated, write for admins
DROP POLICY IF EXISTS "prospects_select" ON public.prospects;
DROP POLICY IF EXISTS "prospects_insert" ON public.prospects;
DROP POLICY IF EXISTS "prospects_update" ON public.prospects;
DROP POLICY IF EXISTS "prospects_delete" ON public.prospects;

CREATE POLICY "prospects_select" ON public.prospects
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "prospects_insert" ON public.prospects
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "prospects_update" ON public.prospects
  FOR UPDATE USING (is_admin());

CREATE POLICY "prospects_delete" ON public.prospects
  FOR DELETE USING (is_admin());

-- prospect_filings: read-only for authenticated (ingestion uses service_role)
DROP POLICY IF EXISTS "prospect_filings_select" ON public.prospect_filings;
CREATE POLICY "prospect_filings_select" ON public.prospect_filings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- prospect_holdings: read-only for authenticated
DROP POLICY IF EXISTS "prospect_holdings_select" ON public.prospect_holdings;
CREATE POLICY "prospect_holdings_select" ON public.prospect_holdings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- prospect_fit_scores: read-only for authenticated
DROP POLICY IF EXISTS "prospect_fit_scores_select" ON public.prospect_fit_scores;
CREATE POLICY "prospect_fit_scores_select" ON public.prospect_fit_scores
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── 10. Confirmation ──────────────────────────────────────────
SELECT COUNT(*) AS prospect_tables_created
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('prospects','prospect_filings','prospect_holdings','prospect_fit_scores');
