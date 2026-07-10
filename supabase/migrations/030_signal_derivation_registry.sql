-- ============================================================
-- Migration 030: signal_definitions.derivation registry (Part B)
-- ============================================================
--
-- The drift check (drift_stored_matches_derived) walks signal_definitions and,
-- per signal, re-derives the stored value from stored inputs and compares.
-- `derivation` (jsonb) tells it HOW:
--
--   { "target": {"tuple":"<key>"},         -- value lives in normalized_signals
--     "kind": "passthrough", "raw_key":"<k>" }   -- compare vs prospect_sources.signals[raw_key]
--
--   { "target": {"tuple":"segment_inferred"},
--     "kind": "derived",
--     "by_source": {"sec_13f":"inferSegment","sec_adv":"deriveAdvSegment"} } -- fn per source
--
--   { "target": {"column":"fit_score"},    -- value lives on prospects
--     "kind": "derived", "fn":"computeFitScore" }
--
--   { "target": {"filing_metric":"served_fraction"},  -- per-filing value
--     "kind": "derived", "fn":"servedFractionFromBreakdown" }  -- from STORED asset_breakdown
--
--   { "kind": "skip", "reason":"..." }     -- reserved: values that CANNOT be re-derived
--                                          -- (matchReason — resolveFirm does candidate-search I/O)
--
-- NON-NEGOTIABLE: a signal_definitions row with NULL/absent derivation makes the
-- drift check FAIL for that signal. An undescribed signal is a coverage hole.
-- Idempotent. Code holds the fn-name → pure-function dispatch map.
-- ============================================================

ALTER TABLE public.signal_definitions
  ADD COLUMN IF NOT EXISTS derivation jsonb;

-- fit_score is drifted but wasn't a registered signal — add it (promoted column).
INSERT INTO public.signal_definitions
  (signal_key, label, data_type, unit, canonical_dimension, comparison_method,
   is_promoted_to_column, producing_sources)
VALUES
  ('fit_score', 'Prospect Fit Score', 'number', null, 'fit', 'numeric', true,
   ARRAY['sec_13f','sec_adv'])
ON CONFLICT (signal_key) DO NOTHING;

-- ── Seed derivation descriptors for every signal ──────────────
UPDATE public.signal_definitions AS s
SET derivation = d.derivation
FROM (VALUES
  -- normalized_signals tuples — pass-through vs Layer-1 raw signals
  ('aum_13f_portfolio',        '{"target":{"tuple":"aum_13f_portfolio"},"kind":"passthrough","raw_key":"estimated_aum_usd"}'::jsonb),
  ('aum_adv_regulatory',       '{"target":{"tuple":"aum_adv_regulatory"},"kind":"passthrough","raw_key":"regulatoryAum"}'::jsonb),
  ('turnover_pct',             '{"target":{"tuple":"turnover_pct"},"kind":"passthrough","raw_key":"portfolio_turnover_pct"}'::jsonb),
  ('equities_pct',             '{"target":{"tuple":"equities_pct"},"kind":"passthrough","raw_key":"equities_pct"}'::jsonb),
  ('options_present',          '{"target":{"tuple":"options_present"},"kind":"passthrough","raw_key":"options_present"}'::jsonb),
  ('position_count',           '{"target":{"tuple":"position_count"},"kind":"passthrough","raw_key":"position_count"}'::jsonb),
  ('client_types',             '{"target":{"tuple":"client_types"},"kind":"passthrough","raw_key":"clientTypes"}'::jsonb),
  ('has_private_fund_clients', '{"target":{"tuple":"has_private_fund_clients"},"kind":"passthrough","raw_key":"advFlags.hasPrivateFundClients"}'::jsonb),
  -- derived tuple — source-dependent fn
  ('segment_inferred',         '{"target":{"tuple":"segment_inferred"},"kind":"derived","by_source":{"sec_13f":"inferSegment","sec_adv":"deriveAdvSegment"}}'::jsonb),
  -- derived prospects columns — re-derive from stored breakdown/inputs + injected config
  ('fit_score',                '{"target":{"column":"fit_score"},"kind":"derived","fn":"computeFitScore"}'::jsonb),
  ('asset_class_relevance',    '{"target":{"column":"asset_class_relevance"},"kind":"derived","fn":"deriveRelevanceVerdict"}'::jsonb),
  -- per-filing metrics — re-derive from the STORED per-filing asset_breakdown / filings
  ('served_asset_fraction',    '{"target":{"filing_metric":"served_fraction"},"kind":"derived","fn":"servedFractionFromBreakdown"}'::jsonb),
  ('options_value_fraction',   '{"target":{"filing_metric":"options_value_fraction"},"kind":"derived","fn":"optionsFractionFromBreakdown"}'::jsonb),
  ('position_churn_pct',       '{"target":{"filing_metric":"position_churn_pct"},"kind":"derived","fn":"positionChurnFromFilings"}'::jsonb)
) AS d(signal_key, derivation)
WHERE s.signal_key = d.signal_key;

-- ── Confirmation ───────────────────────────────────────────────
-- Expect: signals=14, described=14, undescribed=0 (any 0 → coverage hole).
SELECT
  (SELECT COUNT(*) FROM public.signal_definitions)                       AS signals,
  (SELECT COUNT(*) FROM public.signal_definitions WHERE derivation IS NOT NULL) AS described,
  (SELECT COUNT(*) FROM public.signal_definitions WHERE derivation IS NULL)     AS undescribed;

SELECT signal_key, derivation->'target' AS target, derivation->>'kind' AS kind
FROM public.signal_definitions ORDER BY signal_key;
