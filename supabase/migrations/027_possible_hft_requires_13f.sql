-- ============================================================
-- Migration 027: possible_hft_requires_13f_filer knob
-- ============================================================
--
-- Part D backfill showed the possible_hft positive-lead flag firing for 77
-- firms — mostly ordinary large RIAs that simply don't file a 13F (private-fund
-- advisers, sub-$100M in 13F securities, non-US). "No 13F at all" ≠ "flat
-- overnight." The genuine intraday/HFT mismatch is a firm that IS a 13F filer
-- but shows a tiny book.
--
-- This adds a config knob (default TRUE) so the flag only fires for firms that
-- have at least one 13F filing AND a tiny book AND AUM >= possible_hft_min_aum.
-- Set to false to restore the AUM+holdings-only behavior. Config-driven per the
-- standing rule — no inline constant. Idempotent.
-- ============================================================

ALTER TABLE public.asset_class_relevance_config
  ADD COLUMN IF NOT EXISTS possible_hft_requires_13f_filer boolean NOT NULL DEFAULT true;

-- Confirmation: expect one row with the knob = true.
SELECT id, possible_hft_min_aum, min_holdings, possible_hft_requires_13f_filer
FROM public.asset_class_relevance_config;
