-- ============================================================
-- Migration 032: Config UI foundation (schema/RLS only — Part A)
-- ============================================================
--
-- Lays the schema + governance groundwork for the Config UI (per
-- CONFIG_UI_BUILD.md). NO engine or UI code here. Single transaction, idempotent.
--
-- What this migration does:
--   1. is_active on the 5 config tables that lack it (soft-disable; engine filters).
--   2. scope_type/scope_value on every config table that lacks them (Seam 2:
--      sentinels 'global'/'*', NOT NULL — never NULL, or a unique index would let
--      duplicate globals through).
--   3. Extend the natural-key UNIQUE indexes on the rule-list tables to include scope.
--   4. Admin-write RLS on the 9 SELECT-only config tables — FOR ALL with BOTH
--      USING and WITH CHECK written explicitly (the existing matcher_config /
--      icp_filter_config policies omit WITH CHECK; that implicit USING->WITH CHECK
--      copy is a latent hole — we don't repeat it).
--   5. config_change_log — append-only, TRIGGER-written (captures API, direct-SQL,
--      and migration edits alike), INSERT/SELECT-only, unforgeable and unmodifiable.
--   6. Recompute job types: backfill_normalize / backfill_fit_scores (worker wiring
--      lands in a later part; this only makes the types valid so the UI can enqueue).
--
-- ── STOP-RECONCILING NOTE (governance) ──────────────────────────────────────
-- These config tables are now UI-owned. Future migrations must seed them with
-- ON CONFLICT DO NOTHING and NEVER clobber live rows. The declarative-reconcile
-- pattern (migration 025) is RETIRED for UI-owned config: once a human can edit a
-- row, a reconcile becomes a mechanism for silently destroying that edit. Shipped
-- defaults remain immutably recorded in git (the migration files); restore-to-default
-- is served by config_change_log (v1) and, later, config_revisions.
--
-- ── Judgment calls (flagged for review; see Part A summary) ──────────────────
--   • Natural-key scoping is applied to the tables whose human key is a NON-PK
--     UNIQUE index (segment_name_signals, asset_class_patterns,
--     relevance_adv_name_flags, size_tier_config). The four lookup tables whose
--     key IS a single-column PRIMARY KEY (served_asset_classes,
--     relevance_verdict_actions, fit_tier_ratios, matcher_config) get the scope
--     COLUMNS now but keep their single-column PK — a per-jurisdiction variant
--     there needs a cheap PK swap later (no column backfill, since the columns
--     already exist). matcher_config is the most likely first candidate.
--   • check_definitions keeps its check_key PK unchanged — check_results has an
--     inbound FK to it (a composite-PK swap would break that FK). It already
--     carries scope_type/scope_value from migration 029.
--   • 'delete' is added to the change-log action CHECK: the doc lists
--     insert|update|deactivate|activate, but the trigger also fires on hard DELETE
--     and a complete audit trail must record it. Soft-disable is still the norm.
-- ============================================================

BEGIN;

-- ── 1. is_active on the tables that lack it ─────────────────────────────────
ALTER TABLE public.served_asset_classes         ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.relevance_verdict_actions     ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.asset_class_relevance_config  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.fit_tier_ratios               ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.size_tier_config              ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ── 2. scope_type / scope_value on every config table that lacks them ───────
-- Sentinels 'global'/'*' (NOT NULL). check_definitions already has them (029).
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'scoring_config','matcher_config','icp_filter_config',
    'segment_name_signals','served_asset_classes','asset_class_patterns',
    'relevance_adv_name_flags','asset_class_relevance_config',
    'relevance_verdict_actions','fit_tier_ratios','size_tier_config'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS scope_type  text NOT NULL DEFAULT ''global''', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS scope_value text NOT NULL DEFAULT ''*''',     t);
  END LOOP;
END
$do$;

-- ── 3. Extend natural-key UNIQUE indexes on the rule-list tables (+ scope) ───
-- Inline UNIQUE constraints get deterministic names; drop-by-name IF EXISTS is safe.
-- Both the old auto-name AND the new name are dropped first, so this is re-runnable.
ALTER TABLE public.segment_name_signals     DROP CONSTRAINT IF EXISTS segment_name_signals_pattern_signal_kind_key,
                                            DROP CONSTRAINT IF EXISTS segment_name_signals_natural_key;
ALTER TABLE public.segment_name_signals     ADD  CONSTRAINT segment_name_signals_natural_key
  UNIQUE (pattern, signal_kind, scope_type, scope_value);

ALTER TABLE public.asset_class_patterns     DROP CONSTRAINT IF EXISTS asset_class_patterns_pattern_pattern_kind_key,
                                            DROP CONSTRAINT IF EXISTS asset_class_patterns_natural_key;
ALTER TABLE public.asset_class_patterns     ADD  CONSTRAINT asset_class_patterns_natural_key
  UNIQUE (pattern, pattern_kind, scope_type, scope_value);

ALTER TABLE public.relevance_adv_name_flags DROP CONSTRAINT IF EXISTS relevance_adv_name_flags_pattern_key,
                                            DROP CONSTRAINT IF EXISTS relevance_adv_name_flags_natural_key;
ALTER TABLE public.relevance_adv_name_flags ADD  CONSTRAINT relevance_adv_name_flags_natural_key
  UNIQUE (pattern, scope_type, scope_value);

ALTER TABLE public.size_tier_config         DROP CONSTRAINT IF EXISTS size_tier_config_tier_key_key,
                                            DROP CONSTRAINT IF EXISTS size_tier_config_natural_key;
ALTER TABLE public.size_tier_config         ADD  CONSTRAINT size_tier_config_natural_key
  UNIQUE (tier_key, scope_type, scope_value);

-- ── 4. Admin-write RLS on the 9 SELECT-only config tables ───────────────────
-- Existing "<table>_select" (authenticated read) policies are LEFT INTACT; RLS is
-- permissive (OR'd), so this only adds INSERT/UPDATE/DELETE gated to admins.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'segment_name_signals','served_asset_classes','asset_class_patterns',
    'relevance_adv_name_flags','asset_class_relevance_config',
    'relevance_verdict_actions','fit_tier_ratios','size_tier_config','check_definitions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated ' ||
      'USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_write', t);
  END LOOP;
END
$do$;

-- ── 5. config_change_log — append-only audit trail ──────────────────────────
CREATE TABLE IF NOT EXISTS public.config_change_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name    text        NOT NULL,
  row_key       jsonb       NOT NULL,   -- the changed row's primary-key columns
  action        text        NOT NULL CHECK (action IN ('insert','update','deactivate','activate','delete')),
  column_name   text,                   -- set on UPDATE (one row per changed column); NULL on insert/delete
  old_value     jsonb,
  new_value     jsonb,
  actor_user_id uuid,                   -- from the request JWT when present
  actor_label   text,                   -- profile name/email, or DB role for direct-SQL edits
  created_at    timestamptz NOT NULL DEFAULT now(),
  note          text
);
CREATE INDEX IF NOT EXISTS config_change_log_table_created_idx ON public.config_change_log(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS config_change_log_actor_idx         ON public.config_change_log(actor_user_id);

-- RLS: SELECT for admins; NO insert/update/delete policy for API roles. The
-- SECURITY DEFINER trigger below (owner, bypasses RLS) is the ONLY writer, so the
-- log is unforgeable via the API and — with no UPDATE/DELETE policy plus the
-- REVOKEs — unmodifiable by anyone short of a superuser/DBA. An audit trail an
-- admin can edit is not an audit trail.
ALTER TABLE public.config_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS config_change_log_select ON public.config_change_log;
CREATE POLICY config_change_log_select ON public.config_change_log
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT  SELECT                     ON public.config_change_log TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.config_change_log FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE   ON public.config_change_log FROM service_role;

-- ── 6. Trigger function — generic, actor-aware, column-level ────────────────
-- SECURITY DEFINER so the log write ALWAYS lands (API admin edit, service_role
-- worker, direct SQL editor, or migration) and cannot be forged/blocked by the
-- editor's own RLS. search_path pinned. Actor capture reads the request JWT
-- (old `request.jwt.claim.sub` GUC or new `request.jwt.claims` JSON) and, for a
-- JWT-less direct connection, falls back to a migration-set label or the DB role.
CREATE OR REPLACE FUNCTION public.log_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor_id    uuid;
  v_actor_label text;
  v_action      text;
  v_old         jsonb;
  v_new         jsonb;
  v_row         jsonb;
  v_key         jsonb;
  v_pk_cols     text[];
  v_col         text;
BEGIN
  -- actor (fully exception-safe: a malformed claim must never fail a config write)
  BEGIN
    v_actor_id := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor_id := NULL;
  END;
  IF v_actor_id IS NULL THEN
    BEGIN
      v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
    EXCEPTION WHEN others THEN
      v_actor_id := NULL;
    END;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    v_actor_label := coalesce(
      (SELECT coalesce(full_name, email) FROM public.profiles WHERE id = v_actor_id),
      v_actor_id::text);
  ELSE
    -- No JWT → direct DB connection. A migration may self-label with
    --   SET LOCAL app.actor_label = 'migration';
    -- otherwise fall back to the DB role ('postgres'/'supabase_admin' for the SQL editor).
    v_actor_label := coalesce(nullif(current_setting('app.actor_label', true), ''), current_user);
  END IF;

  -- primary-key columns of THIS table (adapts to composite PKs automatically).
  -- pg_constraint.conkey is a real smallint[] (unnest-safe, unlike indkey/int2vector).
  SELECT array_agg(a.attname ORDER BY x.ord)
    INTO v_pk_cols
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum
  WHERE c.conrelid = TG_RELID AND c.contype = 'p';

  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_row := coalesce(v_new, v_old);

  IF v_pk_cols IS NULL THEN
    v_key := v_row;                       -- fallback: table has no PK (shouldn't happen here)
  ELSE
    SELECT jsonb_object_agg(k, v_row -> k) INTO v_key FROM unnest(v_pk_cols) AS k;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.config_change_log
      (table_name, row_key, action, column_name, old_value, new_value, actor_user_id, actor_label)
    VALUES (TG_TABLE_NAME, v_key, 'insert', NULL, NULL, v_new, v_actor_id, v_actor_label);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.config_change_log
      (table_name, row_key, action, column_name, old_value, new_value, actor_user_id, actor_label)
    VALUES (TG_TABLE_NAME, v_key, 'delete', NULL, v_old, NULL, v_actor_id, v_actor_label);
    RETURN OLD;

  ELSE  -- UPDATE: classify from an is_active transition, then log per changed column
    v_action := 'update';
    IF (v_old ? 'is_active') AND (v_new ? 'is_active')
       AND (v_old -> 'is_active') IS DISTINCT FROM (v_new -> 'is_active') THEN
      v_action := CASE WHEN (v_new ->> 'is_active')::boolean THEN 'activate' ELSE 'deactivate' END;
    END IF;

    FOR v_col IN SELECT jsonb_object_keys(v_new) LOOP
      -- Skip audit/stamp columns: they change on every write (scoring_config has a
      -- BEFORE-UPDATE set_updated_at trigger; icp_filter_config /
      -- asset_class_relevance_config set updated_at/updated_by in the app payload).
      -- Logging them would flood the very table we read to answer "who changed what".
      CONTINUE WHEN v_col IN ('updated_at','updated_by','created_at','created_by');
      IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
        INSERT INTO public.config_change_log
          (table_name, row_key, action, column_name, old_value, new_value, actor_user_id, actor_label)
        VALUES (TG_TABLE_NAME, v_key, v_action, v_col, v_old -> v_col, v_new -> v_col, v_actor_id, v_actor_label);
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
END
$fn$;

-- ── 7. Attach the trigger to all 12 config tables (created LAST so the DDL
--       above fires nothing) ─────────────────────────────────────────────────
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'scoring_config','matcher_config','icp_filter_config',
    'segment_name_signals','served_asset_classes','asset_class_patterns',
    'relevance_adv_name_flags','asset_class_relevance_config',
    'relevance_verdict_actions','fit_tier_ratios','size_tier_config','check_definitions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_config_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_log_config_change AFTER INSERT OR UPDATE OR DELETE ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.log_config_change()', t);
  END LOOP;
END
$do$;

-- ── 8. Recompute job types (types only; worker handler is a later part) ─────
ALTER TABLE public.job_definitions DROP CONSTRAINT IF EXISTS job_definitions_job_type_check;
ALTER TABLE public.job_definitions ADD  CONSTRAINT job_definitions_job_type_check
  CHECK (job_type IN ('ingest_13f','ingest_13h','ingest_adv','backfill_normalize','backfill_fit_scores'));

COMMIT;

-- ── 9. Confirmation ─────────────────────────────────────────────────────────
-- Expect: admin_write=9, change_log_tbl=1, change_log_select=1, change_log_write=0,
--         config_triggers=12, tables_with_scope=12, newly_isactive=5, job_types_added=1
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd='ALL'
     AND qual LIKE '%is_admin%' AND with_check LIKE '%is_admin%'
     AND tablename IN ('segment_name_signals','served_asset_classes','asset_class_patterns',
                       'relevance_adv_name_flags','asset_class_relevance_config','relevance_verdict_actions',
                       'fit_tier_ratios','size_tier_config','check_definitions'))                AS admin_write,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='config_change_log')                            AS change_log_tbl,
  (SELECT count(*) FROM pg_policies WHERE tablename='config_change_log' AND cmd='SELECT')        AS change_log_select,
  (SELECT count(*) FROM pg_policies WHERE tablename='config_change_log'
     AND cmd IN ('INSERT','UPDATE','DELETE'))                                                    AS change_log_write,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_log_config_change' AND NOT tgisinternal)    AS config_triggers,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND column_name='scope_type'
     AND table_name IN ('scoring_config','matcher_config','icp_filter_config','segment_name_signals',
                        'served_asset_classes','asset_class_patterns','relevance_adv_name_flags',
                        'asset_class_relevance_config','relevance_verdict_actions','fit_tier_ratios',
                        'size_tier_config','check_definitions'))                                 AS tables_with_scope,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND column_name='is_active'
     AND table_name IN ('served_asset_classes','relevance_verdict_actions','asset_class_relevance_config',
                        'fit_tier_ratios','size_tier_config'))                                   AS newly_isactive,
  (SELECT count(*) FROM pg_constraint WHERE conname='job_definitions_job_type_check'
     AND pg_get_constraintdef(oid) LIKE '%backfill_normalize%'
     AND pg_get_constraintdef(oid) LIKE '%backfill_fit_scores%')                                 AS job_types_added;
