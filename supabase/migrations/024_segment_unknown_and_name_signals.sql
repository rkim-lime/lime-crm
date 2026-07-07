-- ============================================================
-- Migration 024: Segment taxonomy — canonical labels, 'unknown'
-- value, and data-driven name-signal config for ADV derivation
-- ============================================================
--
-- Context: ADV segment derivation is being revised so that
-- hedge_fund is EARNED (dominant pooled / private-fund composition,
-- or a corroborating fund name), never DEFAULTED. Weak / conflicting
-- / flag-only-with-neutral-name firms resolve to a new 'unknown'
-- segment (an honest null → enrichment queue) instead of a
-- hedge_fund guess. Positive retail evidence (HNW / individuals)
-- resolves to wealth_manager on its own.
--
-- This migration is SCHEMA + CONFIG only. The derivation logic
-- (computeSignals.deriveAdvSegment) and the scoring-neutrality of
-- 'unknown' land in Part B.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- ON CONFLICT DO UPDATE, and value UPDATEs. Safe to re-run. Runs as
-- a single transaction (no enum additions).
-- ============================================================


-- ── 1. taxonomy_values.label (reconcile to canonical strings) ──
--
-- NOTE: the `label` column already exists (added NOT NULL in
-- migration 017, with segment labels seeded). This ADD is a
-- definitional no-op on an existing DB, kept for fresh-DB safety.
-- The UPDATE reconciles the seeded segment labels to the canonical
-- single-source-of-truth strings that Part C renders from. Three
-- labels change from their 017 values:
--   quant_fund    'Quantitative Fund' → 'Quant Fund'
--   broker_dealer 'Broker/Dealer'     → 'Broker-Dealer'
--   pension       'Pension/Endowment' → 'Pension'

ALTER TABLE public.taxonomy_values
  ADD COLUMN IF NOT EXISTS label text;

UPDATE public.taxonomy_values tv
SET label = c.label
FROM (VALUES
  ('hedge_fund',     'Hedge Fund'),
  ('quant_fund',     'Quant Fund'),
  ('prop_trading',   'Prop Trading'),
  ('asset_manager',  'Asset Manager'),
  ('wealth_manager', 'Wealth Manager'),
  ('broker_dealer',  'Broker-Dealer'),
  ('bank',           'Bank'),
  ('pension',        'Pension'),
  ('insurance',      'Insurance'),
  ('family_office',  'Family Office'),
  ('other',          'Other')
) AS c(value_key, label),
     public.taxonomies t
WHERE t.taxonomy_key = 'segment'
  AND tv.taxonomy_id = t.id
  AND tv.value_key   = c.value_key;


-- ── 2. New 'unknown' segment value ────────────────────────────
--
-- Distinct from 'other'. 'other' means "recognised, but none of the
-- listed types"; 'unknown' means "insufficient / conflicting
-- evidence to classify" → enrichment queue.
--
-- fit_tier = NULL — the schema's "not scored" marker (same as
-- 'other'), so 'unknown' reads as NEUTRAL, not low-tier. Part B
-- enforces the abstain semantics in fitScore (the segment prior
-- contributes nothing; the firm is scored on its other signals).
-- sort_order 12 places it after 'other'.

INSERT INTO public.taxonomy_values (taxonomy_id, value_key, label, fit_tier, sort_order)
SELECT t.id, 'unknown', 'Unknown', NULL, 12
FROM public.taxonomies t
WHERE t.taxonomy_key = 'segment'
ON CONFLICT (taxonomy_id, value_key)
DO UPDATE SET label      = EXCLUDED.label,
              fit_tier   = EXCLUDED.fit_tier,
              sort_order = EXCLUDED.sort_order;


-- ── 3. Name-signal config for ADV derivation ──────────────────
--
-- Data-driven lists that Part B's deriveAdvSegment() reads instead
-- of inline regexes:
--
--   • signal_kind = 'name_signal' — a firm-name token that points to
--     a specific segment. When vetoes_hedge_fund = true it is a
--     STRONG NON-HF name (wealth / retirement / insurance / pension /
--     family office / broker-dealer): it both supplies the target
--     segment for empty-clientType firms
--     AND blocks a hedge_fund classification regardless of the
--     private-fund flag or composition (the Part B name VETO).
--     Fund-type names (quant / prop) point to a segment but do NOT
--     veto hedge_fund.
--
--   • signal_kind = 'fund_name' — a token that CORROBORATES hedge_fund
--     (target_segment = 'hedge_fund'). Used only to EARN hedge_fund
--     when clientTypes are empty, or as a tie-break when pooled
--     composition is co-dominant. Deliberately excludes generic
--     tokens like 'capital' / 'partners' (which is why iCapital,
--     Argent, KA do NOT earn hedge_fund from their names).
--
-- `pattern` is a case-insensitive regex fragment matched against the
-- firm name. Seeded with the obvious tokens; tune via INSERT/UPDATE
-- (no code change needed).

CREATE TABLE IF NOT EXISTS public.segment_name_signals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern           text        NOT NULL,   -- case-insensitive regex fragment
  target_segment    text        NOT NULL,   -- taxonomy_values.value_key it points to
  signal_kind       text        NOT NULL
                       CHECK (signal_kind IN ('name_signal','fund_name')),
  vetoes_hedge_fund boolean     NOT NULL DEFAULT false,
  confidence        text        NOT NULL
                       CHECK (confidence IN ('high','medium','low')),
  sort_order        integer     NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  notes             text,
  UNIQUE (pattern, signal_kind)
);

INSERT INTO public.segment_name_signals
  (pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order, notes)
VALUES
  -- Strong non-HF names: supply a target segment AND veto hedge_fund.
  -- NOTE: 'credit' and 'real estate/realty' are deliberately NOT here —
  -- they are asset-class / strategy signals, not firm-type (a credit or
  -- real-estate fund can still be hedge_fund via composition). They are
  -- handled by the asset-class relevance layer as NEGATIVE fit signals.
  ('wealth',                              'wealth_manager', 'name_signal', true,  'medium', 1, 'wealth management'),
  ('retirement|\bretire',                 'wealth_manager', 'name_signal', true,  'low',    2, 'retirement planning advisor'),
  ('\bbank\b|trust\s+company|trust\s+bank|national\s+association',
                                          'bank',           'name_signal', true,  'low',    3, 'bank / trust company / national association'),
  ('insurance|assurance',                 'insurance',      'name_signal', true,  'low',    4, 'insurance carrier'),
  ('pension|endowment|foundation',        'pension',        'name_signal', true,  'low',    5, 'pension / endowment / foundation'),
  ('family\s+office',                     'family_office',  'name_signal', true,  'low',    6, 'family office'),
  ('broker|dealer|brokerage|securities',  'broker_dealer',  'name_signal', true,  'low',    7, 'broker-dealer'),
  -- Fund-type names: positive segment signal, NOT a hedge_fund veto
  ('quant(?:itative)?|systematic|algorithmic', 'quant_fund',   'name_signal', false, 'medium', 8, 'quant / systematic'),
  ('prop(?:rietary)?|trading\s+co',            'prop_trading', 'name_signal', false, 'low',    9, 'proprietary trading'),
  -- Fund-name corroboration → earns hedge_fund
  ('\bhedge\b',                                'hedge_fund',   'fund_name',   false, 'medium', 10, 'explicit hedge fund'),
  ('master\s+fund|feeder\s+fund|offshore\s+fund', 'hedge_fund','fund_name',  false, 'medium', 11, 'pooled fund vehicle naming')
ON CONFLICT (pattern, signal_kind)
DO UPDATE SET target_segment    = EXCLUDED.target_segment,
              vetoes_hedge_fund = EXCLUDED.vetoes_hedge_fund,
              confidence        = EXCLUDED.confidence,
              sort_order        = EXCLUDED.sort_order,
              notes             = EXCLUDED.notes,
              is_active         = true;


-- ── 4. RLS on segment_name_signals ────────────────────────────
-- Config table: read for authenticated users; writes via
-- service_role only (service_role bypasses RLS — the ingestion
-- engine reads it that way). Mirrors the other config/registry
-- tables from migration 017.

ALTER TABLE public.segment_name_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "segment_name_signals_select" ON public.segment_name_signals;

CREATE POLICY "segment_name_signals_select" ON public.segment_name_signals
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ── 5. Confirmation ───────────────────────────────────────────
-- (a) All segment values with canonical labels (incl 'unknown').
--     Expect 12 rows; 'unknown' present with label 'Unknown',
--     fit_tier NULL, sort_order 12.
SELECT tv.value_key, tv.label, tv.fit_tier, tv.sort_order
FROM public.taxonomy_values tv
JOIN public.taxonomies t ON t.id = tv.taxonomy_id
WHERE t.taxonomy_key = 'segment'
ORDER BY tv.sort_order;

-- (b) Name-signal config rows. Expect 11 rows
--     (9 name_signal — 7 vetoing, 2 fund-type non-vetoing — + 2 fund_name).
SELECT pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order
FROM public.segment_name_signals
ORDER BY signal_kind, sort_order;
