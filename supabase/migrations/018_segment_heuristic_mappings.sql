-- ============================================================
-- Migration 018: Extend segment taxonomy_mappings for the
-- improved 13F name heuristic
-- ============================================================
--
-- The inferSegment() heuristic (computeSignals.js) previously
-- defaulted all unrecognised 13F filer names to 'hedge_fund'.
-- It now returns specific values ('wealth_manager', 'bank',
-- 'insurance', 'family_office', 'asset_manager') or 'other'
-- when no reliable token is found.
--
-- This migration adds the corresponding taxonomy_mappings so
-- the normalization layer has explicit entries for every value
-- the 13F connector can produce. The fallback in
-- deriveSegmentCanonical() already handles unmapped values
-- correctly (uses raw value as-is), so this is supplementary
-- bookkeeping — the normalization behaviour is unchanged.
--
-- All ingest_13f mappings are confidence='low' (name-based).
-- ADV mappings are untouched.
-- ============================================================

INSERT INTO public.taxonomy_mappings
  (taxonomy_id, source, source_value, canonical_value_key, confidence)
SELECT t.id, m.source, m.source_value, m.canonical_value_key, m.confidence
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('ingest_13f', 'wealth_manager', 'wealth_manager', 'low'),
  ('ingest_13f', 'bank',           'bank',           'low'),
  ('ingest_13f', 'insurance',      'insurance',      'low'),
  ('ingest_13f', 'family_office',  'family_office',  'low'),
  ('ingest_13f', 'asset_manager',  'asset_manager',  'low'),
  ('ingest_13f', 'other',          'other',          'low')
) AS m(source, source_value, canonical_value_key, confidence)
WHERE t.taxonomy_key = 'segment'
ON CONFLICT (taxonomy_id, source, source_value) DO NOTHING;

-- Confirmation: expect 15 total segment mappings (9 from 017 + 6 new)
SELECT
  COUNT(*)                                      AS total_segment_mappings,
  COUNT(*) FILTER (WHERE tm.source = 'ingest_13f') AS from_13f,
  COUNT(*) FILTER (WHERE tm.source = 'ingest_adv') AS from_adv
FROM public.taxonomy_mappings tm
JOIN public.taxonomies t ON t.id = tm.taxonomy_id
WHERE t.taxonomy_key = 'segment';
