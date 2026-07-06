-- ============================================================
-- Migration 023: Source registry + prospect_channel view
--
-- WHAT THIS ADDS
-- ──────────────
-- 1. source_registry table
--    Maps raw source keys (matching the prospect_source enum) to
--    human display labels and logical channels. Channel is the
--    two-level grouping used for the Prospects filter UI:
--
--      regulatory  → SEC 13F, SEC ADV  (data ingested from regulators)
--      manual      → manually entered prospects
--      referral    → referral-sourced prospects
--
--    The table is the single source of truth for labels. The frontend
--    loads it at startup and falls back to title-casing the raw key for
--    any source_key not yet in the registry — nothing breaks if a new
--    connector is deployed before the registry row is added.
--
-- 2. prospect_channel view
--    Derives each prospect's origin channel and origin source from
--    the chronologically earliest prospect_sources row (first_seen_at).
--    Falls back to prospects.source when no prospect_sources rows exist
--    (e.g., manually entered prospects that bypass upsertSource).
--
--    Shape: prospect_id | channel | origin_source | origin_source_label
--    Join with prospects.id = prospect_channel.prospect_id.
--
-- NOT added here
-- ──────────────
--   web/import channel rows are intentionally omitted — scaffold-only
--   until a real connector using those channels ships.
-- ============================================================

-- ── 1. source_registry ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.source_registry (
  source_key    text         PRIMARY KEY,
  channel       text         NOT NULL,
  display_label text         NOT NULL,
  is_active     boolean      NOT NULL DEFAULT true,
  sort_order    integer
);

COMMENT ON TABLE  public.source_registry IS
  'Maps prospect source keys to display labels and logical channel groups.';
COMMENT ON COLUMN public.source_registry.source_key IS
  'Matches values in the prospect_source enum (sec_13f, sec_adv, manual, referral …).';
COMMENT ON COLUMN public.source_registry.channel IS
  'Coarse grouping used for the two-level filter: regulatory / manual / referral / …';

-- Seed known sources.
-- Do NOT add web/import rows here — they are scaffold-only with no live connectors.
INSERT INTO public.source_registry (source_key, channel, display_label, sort_order) VALUES
  ('sec_13f',  'regulatory', 'SEC 13F',  1),
  ('sec_adv',  'regulatory', 'SEC ADV',  2),
  ('manual',   'manual',     'Manual',   3),
  ('referral', 'referral',   'Referral', 4)
ON CONFLICT (source_key) DO UPDATE SET
  channel       = EXCLUDED.channel,
  display_label = EXCLUDED.display_label,
  sort_order    = EXCLUDED.sort_order;

-- ── 2. RLS for source_registry ───────────────────────────────────────────────
-- Read-only for all authenticated users; writes are admin-only via service_role.

ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "source_registry_select" ON public.source_registry;
CREATE POLICY "source_registry_select" ON public.source_registry
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.source_registry TO authenticated;
GRANT ALL    ON public.source_registry TO service_role;

-- ── 3. prospect_channel view ─────────────────────────────────────────────────
--
-- Derivation logic:
--   a. Find the prospect_sources row with the smallest first_seen_at
--      for this prospect (LATERAL + ORDER BY + LIMIT 1).
--   b. If no prospect_sources row exists (manually entered prospect),
--      fall back to the source column on prospects itself.
--   c. Join the resolved source key to source_registry for channel +
--      display_label.
--   d. If the source key is not in source_registry (future connector,
--      not yet registered), fall back gracefully:
--        channel  = the raw source key
--        label    = title-cased raw key

DROP VIEW IF EXISTS public.prospect_channel;

CREATE VIEW public.prospect_channel AS
SELECT
  p.id                                                            AS prospect_id,

  -- Resolved origin source key (enum → text cast)
  COALESCE(ps_origin.origin_source, p.source::text)              AS origin_source,

  -- Display label: registry first, then title-case fallback
  COALESCE(
    sr.display_label,
    initcap(replace(COALESCE(ps_origin.origin_source, p.source::text), '_', ' '))
  )                                                               AS origin_source_label,

  -- Channel: registry first, then the raw source key as its own channel
  COALESCE(
    sr.channel,
    COALESCE(ps_origin.origin_source, p.source::text)
  )                                                               AS channel

FROM public.prospects p

-- Earliest prospect_sources row per prospect (first_seen_at = true origin)
LEFT JOIN LATERAL (
  SELECT ps.source::text AS origin_source
  FROM public.prospect_sources ps
  WHERE ps.prospect_id = p.id
  ORDER BY ps.first_seen_at ASC
  LIMIT 1
) ps_origin ON true

-- Registry lookup on the resolved source key
LEFT JOIN public.source_registry sr
  ON sr.source_key = COALESCE(ps_origin.origin_source, p.source::text);

COMMENT ON VIEW public.prospect_channel IS
  'Derives each prospect''s origin channel and source from the earliest '
  'prospect_sources row (first_seen_at). Falls back to prospects.source '
  'when no prospect_sources rows exist. Join on prospect_id = prospects.id.';

GRANT SELECT ON public.prospect_channel TO authenticated;
GRANT SELECT ON public.prospect_channel TO service_role;

-- ── 4. Confirmation ──────────────────────────────────────────────────────────

SELECT
  'registry_rows'    AS check,
  COUNT(*)::text     AS value
FROM public.source_registry

UNION ALL

SELECT
  'distinct_channels',
  COUNT(DISTINCT channel)::text
FROM public.source_registry

UNION ALL

SELECT
  'active_sources',
  COUNT(*)::text
FROM public.source_registry
WHERE is_active = true;

-- Sample: up to 10 prospects with their derived channel + origin_source
-- (shows the view working end-to-end; empty if no prospects exist yet)
SELECT
  p.firm_name,
  p.source::text          AS enum_source,
  pc.origin_source,
  pc.origin_source_label,
  pc.channel
FROM public.prospect_channel pc
JOIN public.prospects p ON p.id = pc.prospect_id
WHERE p.is_audit_only = false
ORDER BY p.created_at DESC
LIMIT 10;
