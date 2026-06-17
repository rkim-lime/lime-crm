-- ============================================================
-- Migration 010: Prospect Engine — schema, RLS, scoring seed
-- ============================================================
-- NOTE: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as INSERTs that reference the new value.
-- If applying via `supabase db push`, add the line below at
-- the very top of this file:
--   -- supabase disable transaction
-- If applying via the Supabase dashboard SQL editor, each
-- statement commits implicitly — no change needed.
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

-- ── 10. Scoring config seed ───────────────────────────────────
-- NOTE: This INSERT references the 'prospect_fit' enum value
-- added above. If running via `supabase db push`, this will
-- fail unless the file uses `-- supabase disable transaction`.
-- If it fails, run this block separately after migration 010.
INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description, weight, is_active, sort_order)
VALUES
  ('prospect_fit','enterprise','aum_tier',
   'AUM Tier',
   'Estimated AUM: ≥$500M = full credit, ≥$100M = half, <$100M = quarter',
   20, true, 1),
  ('prospect_fit','enterprise','portfolio_turnover',
   'Portfolio Turnover',
   'Quarterly turnover ≥50% = full, ≥25% = half, <25% = quarter (null = half)',
   25, true, 2),
  ('prospect_fit','enterprise','equity_concentration',
   'Equity Concentration',
   'Non-option equity as % of AUM: ≥70% = full, ≥40% = half, <40% = quarter',
   15, true, 3),
  ('prospect_fit','enterprise','options_present',
   'Options Trading',
   'Firm holds put/call options in the 13F filing',
   15, true, 4),
  ('prospect_fit','enterprise','position_count',
   'Position Count',
   'Number of disclosed positions: ≥100 = full, ≥50 = half, <50 = quarter',
   10, true, 5),
  ('prospect_fit','enterprise','filer_type',
   'Filer Type / Segment',
   'hedge_fund/quant_fund/prop_trader = full, pension = quarter, other = half',
   15, true, 6)
ON CONFLICT (score_type, criterion_key) DO NOTHING;

-- ── 11. Confirmation ──────────────────────────────────────────
SELECT
  score_type,
  COUNT(*)     AS criteria_count,
  SUM(weight)  AS total_weight
FROM public.scoring_config
WHERE score_type = 'prospect_fit'
GROUP BY score_type;
