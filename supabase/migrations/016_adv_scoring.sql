-- ============================================================
-- Migration 016: ADV connector schema, scoring rebalance, job seed
-- ============================================================
-- Adds:
--   • sec_adv to prospect_source enum (needed for ADV upserts)
--   • crd_number column to prospects + accounts (CRD-based dedup)
--   • Unique index on (crd_number, source) for ADV idempotency
--   • Two new prospect_fit scoring criteria (weight rebalance keeps total = 100)
--   • ADV job definition seed
-- ============================================================

-- ── 1. Extend prospect_source enum ────────────────────────────
-- Must come first; enum value visible after transaction commits.
ALTER TYPE public.prospect_source ADD VALUE IF NOT EXISTS 'sec_adv';

-- ── 2. CRD number columns ──────────────────────────────────────
-- CRD (Central Registration Depository) is the primary identifier
-- for SEC-registered investment advisers (Form ADV filers).

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS crd_number text;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS crd_number text;

-- ── 3. Indexes ────────────────────────────────────────────────
-- Unique index on (crd_number, source) for ADV prospect idempotency.
-- Partial (WHERE NOT NULL) so that multiple null-CRD manual prospects coexist.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_crd_source_unique
  ON public.prospects(crd_number, source)
  WHERE crd_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospects_crd_number_idx
  ON public.prospects(crd_number);

CREATE INDEX IF NOT EXISTS accounts_crd_number_idx
  ON public.accounts(crd_number);

-- ── 4. Rebalance prospect_fit weights (total must stay = 100) ─
--
-- Current distribution:                         New distribution:
--   aum_tier             20                        aum_tier             20
--   portfolio_turnover   25                        portfolio_turnover   25
--   equity_concentration 15                        equity_concentration 15
--   options_present      15                        options_present      15
--   position_count       10  → freed 5             position_count        5
--   filer_type           15  → freed 5             filer_type           10
--   (new) client_type_fit  5                       client_type_fit       5
--   (new) private_fund_adviser 5                   private_fund_adviser  5
--                       ---                                            ---
--                       100                                            100  ✓

UPDATE public.scoring_config
SET weight = 5, updated_at = now()
WHERE score_type = 'prospect_fit' AND criterion_key = 'position_count';

UPDATE public.scoring_config
SET weight = 10, updated_at = now()
WHERE score_type = 'prospect_fit' AND criterion_key = 'filer_type';

-- ── 5. New scoring criteria ────────────────────────────────────
INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description, weight, is_active, sort_order)
VALUES
  ('prospect_fit', 'enterprise', 'client_type_fit',
   'Client Type Fit',
   'Pooled/private fund & institutional clients score higher than retail',
   5, true, 7),
  ('prospect_fit', 'enterprise', 'private_fund_adviser',
   'Private Fund Adviser',
   'Advises private funds (hedge/quant vehicles) per ADV Part 1',
   5, true, 8)
ON CONFLICT (score_type, criterion_key) DO UPDATE
  SET weight     = EXCLUDED.weight,
      label      = EXCLUDED.label,
      description = EXCLUDED.description,
      is_active  = EXCLUDED.is_active,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

-- ── 6. Seed ADV job definition ─────────────────────────────────
INSERT INTO public.job_definitions (name, description, job_type, config)
SELECT
  'ADV — Standard Batch',
  'Ingest SEC Form ADV Part 1 registered investment advisers from the IAPD bulk file',
  'ingest_adv',
  '{"limit": 50}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_definitions WHERE job_type = 'ingest_adv'
);

-- ── 7. Confirmation ────────────────────────────────────────────
-- Expect: fit_criteria=8, total_weight=100, adv_job=1
SELECT
  (SELECT COUNT(*)   FROM public.scoring_config  WHERE score_type = 'prospect_fit')              AS fit_criteria,
  (SELECT SUM(weight) FROM public.scoring_config WHERE score_type = 'prospect_fit' AND is_active) AS total_weight,
  (SELECT COUNT(*)   FROM public.job_definitions WHERE job_type = 'ingest_adv')                  AS adv_job;
