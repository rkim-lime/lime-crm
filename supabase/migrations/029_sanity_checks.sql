-- ============================================================
-- Migration 029: Automated post-ingest sanity checks (Part A)
-- ============================================================
--
-- Adds the control plane for post-job sanity checks:
--   • check_definitions — config-driven catalogue of checks (family,
--     severity, scope, per-check params). Editable; new checks are rows.
--   • check_results — one row per (job_run, check) execution.
--   • job_runs gains 'completed_with_warnings' status + git_sha.
--
-- Check families:
--   invariant — an always-true property of the data (fail = corruption).
--   drift     — GENERIC re-derivation: for every tuple in normalized_signals,
--               look up the signal_key's derivation in the registry
--               (signal_definitions), re-derive from ITS OWN declared source's
--               Layer-1 raw inputs (prospect_sources.signals + firm_name), and
--               assert equality. Non-circular (re-derives from raw inputs, not the
--               job's output) and merge-safe (each tuple vs its own source), so it
--               catches bugs a read-back cannot — e.g. the mergeSignal freeze,
--               which hit SIX signals at once. 'drift_readback' is the cheap
--               SECONDARY check (stored == last-written) — a write that didn't land.
--   delta     — a between-runs comparison (distribution shift, config-vs-rows).
--
-- POPULATION SCOPE: the check RUNNER (Part B) filters is_audit_only = false for
-- all population-level checks — structurally, not per-check — so account-match
-- shadow prospects (which legitimately carry no source row and live on the
-- account) can never be counted or false-fail. Do not special-case it per check.
--
-- rows_changed & check tallies live in job_runs.stats.sanity (jsonb sub-object) —
-- NO schema change for those (confirmed).
--
-- This migration is SCHEMA + CONFIG only. The check engine, the executeJob
-- post-job hook, and the UI land in Parts B/C. Idempotent. Single transaction.
-- ============================================================


-- ── 1. check_definitions — config catalogue ───────────────────
CREATE TABLE IF NOT EXISTS public.check_definitions (
  check_key   text    PRIMARY KEY,
  family      text    NOT NULL CHECK (family IN ('invariant','drift','delta')),
  description text    NOT NULL,
  severity    text    NOT NULL CHECK (severity IN ('warn','fail')),
  is_active   boolean NOT NULL DEFAULT true,
  scope_type  text    NOT NULL DEFAULT 'global',   -- 'global' | 'source' | 'segment' | …
  scope_value text    NOT NULL DEFAULT '*',        -- e.g. 'sec_13f' when scope_type='source'
  params      jsonb   NOT NULL DEFAULT '{}',        -- per-check tunable thresholds (standing rule)
  sort_order  integer NOT NULL DEFAULT 0
);


-- ── 2. check_results — one row per (job_run, check) ────────────
-- job_run_id is NULLable: checks can also run after a CLI backfill (not a job_run).
CREATE TABLE IF NOT EXISTS public.check_results (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_run_id  uuid        REFERENCES public.job_runs(id) ON DELETE CASCADE,
  check_key   text        NOT NULL REFERENCES public.check_definitions(check_key) ON DELETE CASCADE,
  status      text        NOT NULL CHECK (status IN ('pass','warn','fail')),
  observed    jsonb,       -- what was found (e.g. {stale: 3, samples: [...]})
  expected    jsonb,       -- what should hold (e.g. {stale: 0})
  row_count   integer,     -- rows implicated (0 on pass)
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS check_results_job_run_idx
  ON public.check_results(job_run_id);
CREATE INDEX IF NOT EXISTS check_results_key_created_idx
  ON public.check_results(check_key, created_at DESC);


-- ── 3. job_runs.status: add 'completed_with_warnings' ─────────
-- text+CHECK (not an enum) → drop & re-add the constraint (migration-028 pattern).
ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_status_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_status_check
  CHECK (status IN ('queued','running','completed','completed_with_warnings','failed','cancelled'));


-- ── 4. job_runs.git_sha ────────────────────────────────────────
ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS git_sha text;


-- ── 5. Seed the check catalogue ────────────────────────────────
INSERT INTO public.check_definitions (check_key, family, severity, description, params, sort_order) VALUES
  -- ── invariants (fail) ──
  ('aum_nonnegative',                    'invariant', 'fail',
   'aum_canonical / estimated_aum_usd are >= 0 (or null); no negative AUM.', '{}', 1),
  ('completeness_range',                 'invariant', 'fail',
   'signal_completeness is within [0,1].', '{}', 2),
  ('served_fraction_range',              'invariant', 'fail',
   'asset_class_served_fraction and per-filing served_fraction are null or within [0,1].', '{}', 3),
  ('layer3_mirrors_layer2',              'invariant', 'fail',
   'Every promoted Layer-3 column equals what the Layer-2 normalized_signals resolve to: segment_canonical, aum_canonical + aum_basis/aum_source/aum_as_of, and size_tier.', '{}', 4),
  ('irrelevant_requires_dominant_nonserved', 'invariant', 'fail',
   'asset_class_relevance=''irrelevant'' only when the breakdown''s largest bucket is a served=false class (never gates on absence).', '{}', 5),
  ('source_implies_source_row',          'invariant', 'fail',
   'A prospect with a source has a matching prospect_sources row. (Audit-only shadows are excluded structurally by the check runner, not here.)', '{}', 6),
  ('dedup_resolved_has_match_reason',    'invariant', 'fail',
   'Every dedup_queue row with a resolved status has a non-null match_reason.', '{}', 7),
  ('config_regex_compiles',              'invariant', 'fail',
   'Every `pattern` in segment_name_signals, asset_class_patterns, and relevance_adv_name_flags compiles as a valid regex. Catches a bad pattern BEFORE it crashes ingest — the risk the Config UI introduces by letting humans edit patterns.', '{}', 8),
  -- ── invariants (warn) ──
  ('no_segment_over_90pct',              'invariant', 'warn',
   'No single segment_canonical value exceeds max_share of the classified (non-null) population.', '{"max_share": 0.90}', 9),
  -- ── drift (fail) ──
  ('drift_stored_matches_derived',       'drift', 'fail',
   'Walk signal_definitions; for each, resolve its derivation.target (a normalized_signals tuple OR a prospects/filing column) and re-derive from stored inputs, then assert the stored value matches. Pass-through tuples compare vs Layer-1 prospect_sources.signals; derived signals call the pure engine fn (by_source for segment_inferred). Covers the 9 tuples + fit_score / asset_class_relevance / served_fraction / options_value_fraction / position_churn (columns/filing-metrics). A signal with NULL/absent derivation → FAIL (coverage hole). skip is reserved for non-re-derivable values (matchReason).', '{}', 10),
  ('drift_readback',                     'drift', 'fail',
   'Secondary: stored value equals the value the job just wrote (catches a write that did not land).', '{}', 11),
  -- ── delta (warn) — between-runs ──
  ('segment_distribution_shift',         'delta', 'warn',
   'segment_canonical distribution shifted more than max_shift_pct of firms vs the prior run.', '{"max_shift_pct": 10}', 12),
  ('delta_config_changed_no_rows_changed','delta', 'warn',
   'A config table changed since the last run but stats.sanity.rows_changed = 0 (a config edit that affected nothing is suspect).', '{}', 13)
ON CONFLICT (check_key) DO NOTHING;


-- ── 6. RLS — authenticated read; writes via service_role (worker) ──
ALTER TABLE public.check_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_results     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "check_definitions_select" ON public.check_definitions;
DROP POLICY IF EXISTS "check_results_select"     ON public.check_results;

CREATE POLICY "check_definitions_select" ON public.check_definitions
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "check_results_select" ON public.check_results
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ── 7. Confirmation ────────────────────────────────────────────
-- Expect: checks=13 (fail=10, warn=3), families invariant=9/drift=2/delta=2,
-- status constraint includes 'completed_with_warnings', git_sha column present.
SELECT
  (SELECT COUNT(*) FROM public.check_definitions)                          AS checks,
  (SELECT COUNT(*) FROM public.check_definitions WHERE severity='fail')    AS fail_checks,
  (SELECT COUNT(*) FROM public.check_definitions WHERE severity='warn')    AS warn_checks,
  (SELECT COUNT(*) FROM public.check_definitions WHERE family='invariant') AS invariant,
  (SELECT COUNT(*) FROM public.check_definitions WHERE family='drift')     AS drift,
  (SELECT COUNT(*) FROM public.check_definitions WHERE family='delta')     AS delta,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='job_runs' AND column_name='git_sha')               AS git_sha_col,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_name='check_results')                                    AS results_tbl;

-- Catalogue dump (eyeball families/severities/params):
SELECT check_key, family, severity, scope_type, params, sort_order
FROM public.check_definitions ORDER BY sort_order;
