-- ============================================================
-- Migration 033: seed recompute (backfill) job definitions
-- ============================================================
--
-- Part A (032) made 'backfill_normalize' / 'backfill_fit_scores' valid
-- job_definitions.job_type values; Part C1 wired the worker to EXECUTE them
-- (runConnector dispatch → runBackfillNormalize / runBackfillFitScores).
--
-- job_runs has no job_type column and executeJob derives job_type from the
-- DEFINITION, so a recompute must be enqueued against a definition. These two
-- give the Config UI's [Recompute now] button (and a manual enqueue) a target.
--
-- Idempotent: seeded only when absent (NOT EXISTS), so a re-run — or a later
-- human edit to name/description/is_active via the UI — is never clobbered.
-- Consistent with 032's stop-reconcile note for UI-owned config.
-- ============================================================

INSERT INTO public.job_definitions (name, description, job_type, config, is_active)
SELECT 'Recompute — Normalization',
       'Re-derive normalized_signals + canonical fields (segment / AUM / size tier / asset-class relevance) for all prospects and accounts from stored data. Config-injected and idempotent; recompute is authoritative (overwrites dated incumbents).',
       'backfill_normalize', '{}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.job_definitions WHERE job_type = 'backfill_normalize');

INSERT INTO public.job_definitions (name, description, job_type, config, is_active)
SELECT 'Recompute — Fit Scores',
       'Recompute fit_score for all prospects with the current weights + segment tiers (the same computeFitScore the connectors use). Idempotent.',
       'backfill_fit_scores', '{}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.job_definitions WHERE job_type = 'backfill_fit_scores');

-- Confirmation: expect exactly two backfill definitions.
SELECT job_type, name, is_active
FROM public.job_definitions
WHERE job_type IN ('backfill_normalize', 'backfill_fit_scores')
ORDER BY job_type;
