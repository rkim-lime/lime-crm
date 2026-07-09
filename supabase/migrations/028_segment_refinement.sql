-- ============================================================
-- Migration 028: Segment refinement (Part A) — fund_type promotion
--                + fit_tier_ratios config
-- ============================================================
--
-- Confirmed against real data: quant_fund=0, prop_trading=0 across 513 firms.
-- Root causes:
--   • the segment name rules for quant/prop were UNANCHORED —
--     'quant(?:itative)?' matched QUANTECH / QUANTCA, 'prop(?:rietary)?'
--     matched PROPERTY / PROPEL (false positives), and the composition path
--     never promoted a hedge_fund base to the quant/prop subtype.
--   • fitScore keyed segment on a hardcoded list ['hedge_fund','quant_fund',
--     'prop_trader'] — note 'prop_trader' vs the taxonomy value 'prop_trading',
--     so prop firms could never score the high-tier ratio (Part B fix).
--
-- This migration is SCHEMA + CONFIG only (the engine lands in Part B).
-- NOTE: declarative reconcile (025-style) is RETIRED for UI-owned config — this
-- uses TARGETED UPDATEs and does NOT clobber the other segment_name_signals rows.
-- Idempotent. Single transaction.
-- ============================================================


-- ── 1. segment_name_signals: allow 'fund_type' + add promote_from ──
--
-- signal_kind 'fund_type' = a fund-subtype name signal evaluated on TWO paths:
--   • Composition path: promote_from is the set of base verdicts eligible for
--     promotion. base ∈ promote_from → refine (promote) base to target; base ∉
--     promote_from → KEEP base and raise a possible_<target> enrichment flag
--     (Part B) — never a demotion.
--   • Empty-clientTypes name path: evaluated as a DIRECT target like ANY other
--     name rule (name_signal / fund_name / fund_type), regardless of
--     promote_from. promote_from governs ONLY the composition-promotion path.

ALTER TABLE public.segment_name_signals
  DROP CONSTRAINT IF EXISTS segment_name_signals_signal_kind_check;
ALTER TABLE public.segment_name_signals
  ADD CONSTRAINT segment_name_signals_signal_kind_check
  CHECK (signal_kind IN ('name_signal','fund_name','fund_type'));

ALTER TABLE public.segment_name_signals
  ADD COLUMN IF NOT EXISTS promote_from text[];

-- Targeted UPDATE of the two subtype rows → anchored patterns + fund_type.
-- Matched by their current (target_segment, signal_kind) identity; the unique
-- key (pattern, signal_kind) has no collision with the new values.
UPDATE public.segment_name_signals
SET pattern      = '\bquant(?:itative)?\b|\bsystematic\b|\balgorithmic\b',
    signal_kind  = 'fund_type',
    promote_from = ARRAY['hedge_fund'],
    notes        = 'quant/systematic — promotes hedge_fund base to quant_fund (anchored: excludes QUANTECH/QUANTCA)'
WHERE target_segment = 'quant_fund' AND signal_kind = 'name_signal';

UPDATE public.segment_name_signals
SET pattern      = '\bprop(?:rietary)?\b|trading\s+co',
    signal_kind  = 'fund_type',
    promote_from = ARRAY['hedge_fund'],
    notes        = 'prop/proprietary — promotes hedge_fund base to prop_trading (anchored: excludes PROPERTY/PROPEL)'
WHERE target_segment = 'prop_trading' AND signal_kind = 'name_signal';


-- ── 2. fit_tier_ratios — taxonomy fit_tier → scoring ratio ─────
-- fitScore maps a segment's taxonomy_values.fit_tier to a ratio via this table
-- (Part B). A NULL tier (e.g. 'other'/'unknown') is NOT a row here — it means
-- ABSTAIN (handled in code: drop filer_type + renormalize), unchanged.
CREATE TABLE IF NOT EXISTS public.fit_tier_ratios (
  tier  text    PRIMARY KEY,
  ratio numeric NOT NULL
);

INSERT INTO public.fit_tier_ratios (tier, ratio) VALUES
  ('high',   1.0),
  ('medium', 0.5),
  ('low',    0.25)
ON CONFLICT (tier) DO NOTHING;


-- ── 3. segment_flags jsonb (mirrors asset_class_flags) ─────────
-- Holds possible_quant_fund / possible_prop_trading enrichment leads set when a
-- fund_type name matches a base outside promote_from.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS segment_flags jsonb;
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS segment_flags jsonb;


-- ── 4. RLS on fit_tier_ratios (authenticated read; service_role writes) ──
ALTER TABLE public.fit_tier_ratios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fit_tier_ratios_select" ON public.fit_tier_ratios;
CREATE POLICY "fit_tier_ratios_select" ON public.fit_tier_ratios
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ── 5. Confirmation ────────────────────────────────────────────
-- Expect: fund_type_rows=2, fit_tier_ratios=3, promote_from_col=1,
-- prospects_segment_flags=1, accounts_segment_flags=1.
SELECT
  (SELECT COUNT(*) FROM public.segment_name_signals WHERE signal_kind='fund_type') AS fund_type_rows,
  (SELECT COUNT(*) FROM public.fit_tier_ratios)                                     AS fit_tier_ratios,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='segment_name_signals' AND column_name='promote_from')        AS promote_from_col,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='prospects' AND column_name='segment_flags')                  AS prospects_segment_flags,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='accounts' AND column_name='segment_flags')                   AS accounts_segment_flags;

-- The two fund_type rows (eyeball anchored patterns + promote_from):
SELECT pattern, target_segment, signal_kind, promote_from, vetoes_hedge_fund
FROM public.segment_name_signals WHERE signal_kind='fund_type' ORDER BY sort_order;

-- fit tier ratios:
SELECT tier, ratio FROM public.fit_tier_ratios ORDER BY ratio DESC;
