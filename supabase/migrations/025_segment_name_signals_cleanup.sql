-- ============================================================
-- Migration 025: Reconcile segment_name_signals (delete-aware seed)
-- ============================================================
--
-- WHY: migration 024 seeds with ON CONFLICT DO UPDATE, which inserts
-- and updates but NEVER deletes. When 024's seed was revised mid-flight
-- (credit/realty firm-type rules dropped, bank pattern tightened) after
-- an earlier version had already run, the removed patterns lingered as
-- orphans:
--     'credit'                            → asset_manager
--     'realty|real\s+estate'              → asset_manager
--     '\bbank\b|\btrust\b|national\s+ass' → bank   (loose, superseded)
-- These misclassified name-only firms (e.g. KA Credit Advisors →
-- asset_manager instead of unknown) and over-matched bare 'trust'.
--
-- THE PATTERN (durable orphan guard): this migration declares the FULL
-- desired row set and reconciles the table to it — upsert every desired
-- row AND delete every row not in the set. Editing a config seed this
-- way makes removals actually propagate to the DB, and is idempotent
-- (re-running converges to exactly the desired set). Use this
-- reconcile shape for future config-seed edits instead of a bare
-- upsert, which cannot express deletions.
--
-- Net effect here: deletes exactly the 3 orphan rows above and leaves
-- the intended 11-row config unchanged (the upserts are no-ops on the
-- already-correct rows; `notes` is intentionally not overwritten).
-- ============================================================

WITH desired (pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order) AS (
  VALUES
    ('wealth',                              'wealth_manager', 'name_signal', true,  'medium', 1),
    ('retirement|\bretire',                 'wealth_manager', 'name_signal', true,  'low',    2),
    ('\bbank\b|trust\s+company|trust\s+bank|national\s+association',
                                            'bank',           'name_signal', true,  'low',    3),
    ('insurance|assurance',                 'insurance',      'name_signal', true,  'low',    4),
    ('pension|endowment|foundation',        'pension',        'name_signal', true,  'low',    5),
    ('family\s+office',                     'family_office',  'name_signal', true,  'low',    6),
    ('broker|dealer|brokerage|securities',  'broker_dealer',  'name_signal', true,  'low',    7),
    ('quant(?:itative)?|systematic|algorithmic', 'quant_fund', 'name_signal', false, 'medium', 8),
    ('prop(?:rietary)?|trading\s+co',       'prop_trading',   'name_signal', false, 'low',    9),
    ('\bhedge\b',                           'hedge_fund',     'fund_name',   false, 'medium', 10),
    ('master\s+fund|feeder\s+fund|offshore\s+fund', 'hedge_fund', 'fund_name', false, 'medium', 11)
),
reconcile AS (
  -- Upsert every desired row (re-assert canonical values; no-op when already correct)
  INSERT INTO public.segment_name_signals
    (pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order, is_active)
  SELECT d.pattern, d.target_segment, d.signal_kind, d.vetoes_hedge_fund, d.confidence, d.sort_order, true
  FROM desired d
  ON CONFLICT (pattern, signal_kind) DO UPDATE SET
    target_segment    = EXCLUDED.target_segment,
    vetoes_hedge_fund = EXCLUDED.vetoes_hedge_fund,
    confidence        = EXCLUDED.confidence,
    sort_order        = EXCLUDED.sort_order,
    is_active         = true
  RETURNING 1
)
-- Delete every row NOT in the desired set (the orphan guard)
DELETE FROM public.segment_name_signals s
WHERE (s.pattern, s.signal_kind) NOT IN (SELECT pattern, signal_kind FROM desired);

-- Confirmation: expect exactly 11 rows, no credit / realty / loose-trust patterns.
SELECT pattern, target_segment, signal_kind, vetoes_hedge_fund, confidence, sort_order
FROM public.segment_name_signals
ORDER BY signal_kind, sort_order;
