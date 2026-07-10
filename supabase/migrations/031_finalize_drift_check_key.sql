-- ============================================================
-- Migration 031: finalize the drift check_key
-- ============================================================
--
-- An intermediate 029 seeded the drift check as 'drift_layer1_to_layer2', but
-- the shipped engine implements 'drift_stored_matches_derived' (the broadened
-- tuple+column walker). A DB stuck on the old key makes the runner fail that
-- check as "no implementation" (the self-guard). This renames it in place.
--
-- Idempotent: on a fresh DB (029 already seeds the final key) the WHERE matches
-- nothing → no-op. Safe — no check_results reference the old key yet.
-- ============================================================

UPDATE public.check_definitions
SET check_key   = 'drift_stored_matches_derived',
    description = 'Walk signal_definitions; for each, resolve derivation.target (a normalized_signals tuple OR a prospects/filing column) and re-derive from stored inputs, then assert the stored value matches. Pass-through tuples compare vs Layer-1 prospect_sources.signals; derived signals call the pure engine fn (by_source for segment_inferred). Covers the 9 tuples + fit_score / asset_class_relevance / served_fraction / options_value_fraction / position_churn. A signal with NULL/absent derivation → FAIL (coverage hole). skip is reserved for non-re-derivable values (matchReason).'
WHERE check_key = 'drift_layer1_to_layer2';

-- Confirmation: expect exactly one drift row, named drift_stored_matches_derived.
SELECT check_key, family, severity FROM public.check_definitions WHERE family = 'drift' ORDER BY sort_order;
