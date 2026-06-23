-- ============================================================
-- Migration 015: Job control plane
-- job_definitions, job_schedules, job_runs tables
-- No enum additions — text+CHECK used throughout to avoid
-- the enum-migration ordering friction of prior migrations.
-- Run this entire file in one pass.
-- ============================================================

-- ── 1. job_definitions — reusable task templates ─────────────
CREATE TABLE IF NOT EXISTS public.job_definitions (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL,
  description text,
  job_type    text    NOT NULL DEFAULT 'ingest_13f'
                CHECK (job_type IN ('ingest_13f','ingest_13h','ingest_adv')),
  -- Passed to the pipeline: limit, minAum, sortBy, filerTypes, etc.
  config      jsonb   NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid    REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. job_schedules — when a definition auto-runs ───────────
CREATE TABLE IF NOT EXISTS public.job_schedules (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  job_definition_id uuid    NOT NULL
                      REFERENCES public.job_definitions(id) ON DELETE CASCADE,
  schedule_type     text    NOT NULL DEFAULT 'preset'
                      CHECK (schedule_type IN ('preset','cron')),
  -- Preset fields
  recurrence        text    CHECK (recurrence IN
                      ('daily','weekly','monthly','quarterly')),
  hour_of_day       integer CHECK (hour_of_day BETWEEN 0 AND 23),
  minute_of_hour    integer DEFAULT 0
                      CHECK (minute_of_hour BETWEEN 0 AND 59),
  day_of_week       integer CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month      integer CHECK (day_of_month BETWEEN 1 AND 28),
  timezone          text    NOT NULL DEFAULT 'America/New_York',
  -- Cron field (when schedule_type = 'cron')
  cron_expression   text,
  is_active         boolean NOT NULL DEFAULT true,
  -- Computed by scheduler.js; when it should next fire
  next_run_at       timestamptz,
  last_enqueued_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 3. job_runs — execution history + the live queue ─────────
CREATE TABLE IF NOT EXISTS public.job_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_definition_id uuid REFERENCES public.job_definitions(id)
                      ON DELETE SET NULL,
  schedule_id       uuid REFERENCES public.job_schedules(id)
                      ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN
                      ('queued','running','completed','failed','cancelled')),
  trigger_source    text NOT NULL DEFAULT 'manual'
                      CHECK (trigger_source IN ('manual','scheduled')),
  -- Config frozen at enqueue time (definition may change later)
  config_snapshot   jsonb DEFAULT '{}',
  -- Worker claiming — prevents double-execution
  claimed_by        text,
  claimed_at        timestamptz,
  -- Timing
  queued_at         timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  -- Results (streamed live by worker)
  stats             jsonb DEFAULT '{}',
  log               text,
  error_message     text,
  triggered_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runs_status_queued_at_idx
  ON public.job_runs(status, queued_at);
CREATE INDEX IF NOT EXISTS job_runs_definition_created_idx
  ON public.job_runs(job_definition_id, created_at DESC);

-- ── 4. updated_at triggers ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS handle_updated_at ON public.job_definitions;
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.job_definitions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at ON public.job_schedules;
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.job_schedules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── 5. RLS ────────────────────────────────────────────────────
-- Worker uses service_role key (bypasses RLS) so it can
-- claim and update job_runs rows freely.
ALTER TABLE public.job_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_def_select" ON public.job_definitions;
CREATE POLICY "job_def_select" ON public.job_definitions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "job_def_write" ON public.job_definitions;
CREATE POLICY "job_def_write" ON public.job_definitions
  FOR ALL USING (
    public.current_user_role() IN ('admin','sales','operations')
  );

DROP POLICY IF EXISTS "job_sched_select" ON public.job_schedules;
CREATE POLICY "job_sched_select" ON public.job_schedules
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "job_sched_write" ON public.job_schedules;
CREATE POLICY "job_sched_write" ON public.job_schedules
  FOR ALL USING (
    public.current_user_role() IN ('admin','sales','operations')
  );

DROP POLICY IF EXISTS "job_runs_select" ON public.job_runs;
CREATE POLICY "job_runs_select" ON public.job_runs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "job_runs_insert" ON public.job_runs;
CREATE POLICY "job_runs_insert" ON public.job_runs
  FOR INSERT WITH CHECK (
    public.current_user_role() IN ('admin','sales','operations')
  );

DROP POLICY IF EXISTS "job_runs_update" ON public.job_runs;
CREATE POLICY "job_runs_update" ON public.job_runs
  FOR UPDATE USING (
    public.current_user_role() IN ('admin','sales','operations')
  );

-- ── 6. Seed default job definition ────────────────────────────
INSERT INTO public.job_definitions (name, description, job_type, config)
SELECT
  '13F — Standard Batch',
  'Ingest recent 13F filings, default batch size',
  'ingest_13f',
  '{"limit": 50}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_definitions WHERE job_type = 'ingest_13f'
);

-- ── 7. Confirmation ───────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = 'job_definitions')  AS defs,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = 'job_schedules')    AS schedules,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = 'job_runs')         AS runs,
  (SELECT COUNT(*) FROM public.job_definitions) AS seeded_defs;
-- Expected: 1, 1, 1, 1
