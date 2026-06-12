-- ============================================================
-- Migration 004: scoring_config and score_history tables
-- ============================================================

-- ── 1. scoring_config ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scoring_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier          client_tier NOT NULL,
  criterion_key text        NOT NULL,
  label         text        NOT NULL,
  description   text,
  weight        integer     NOT NULL DEFAULT 0
                  CHECK (weight >= 0 AND weight <= 100),
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE(tier, criterion_key)
);

-- ── 2. score_history ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.score_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type      text NOT NULL
                     CHECK (record_type IN ('lead','contact','account')),
  record_id        uuid NOT NULL,
  score            integer NOT NULL CHECK (score >= 0 AND score <= 100),
  weights_snapshot jsonb   NOT NULL DEFAULT '{}',
  calculated_at    timestamptz NOT NULL DEFAULT now(),
  triggered_by     text NOT NULL DEFAULT 'manual'
                     CHECK (triggered_by IN
                       ('manual','weight_change','record_update','scheduled'))
);

-- ── 3. updated_at trigger on scoring_config ──────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.scoring_config;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.scoring_config
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 4. RLS ───────────────────────────────────────────────────
ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scoring_config_select" ON public.scoring_config;
DROP POLICY IF EXISTS "scoring_config_write"  ON public.scoring_config;
DROP POLICY IF EXISTS "score_history_select"  ON public.score_history;
DROP POLICY IF EXISTS "score_history_insert"  ON public.score_history;

CREATE POLICY "scoring_config_select" ON public.scoring_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "scoring_config_write" ON public.scoring_config
  FOR ALL USING (is_admin());

CREATE POLICY "score_history_select" ON public.score_history
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "score_history_insert" ON public.score_history
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 5. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS scoring_config_tier_active_sort_idx
  ON public.scoring_config(tier, is_active, sort_order);

CREATE INDEX IF NOT EXISTS score_history_record_idx
  ON public.score_history(record_type, record_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS score_history_calculated_at_idx
  ON public.score_history(calculated_at DESC);

-- ── 6. Seed default scoring criteria ─────────────────────────

-- Enterprise (total weight = 100)
INSERT INTO public.scoring_config
  (tier, criterion_key, label, description, weight, sort_order)
VALUES
  ('enterprise','aum_over_100m',
   'AUM > $100M',
   'Account has assets under management over $100M',
   25, 1),
  ('enterprise','adv_over_1m',
   'ADV > $1M',
   'Average daily volume exceeds $1M USD',
   20, 2),
  ('enterprise','fix_version_set',
   'FIX Connectivity',
   'Account has a FIX version configured',
   15, 3),
  ('enterprise','colo_required',
   'Colocation Required',
   'Account requires colocation / hosting infrastructure',
   15, 4),
  ('enterprise','kyc_approved',
   'KYC Approved',
   'Account KYC status is fully approved',
   15, 5),
  ('enterprise','multiple_asset_classes',
   'Multi Asset Class',
   'Account trades more than one asset class',
   10, 6)
ON CONFLICT (tier, criterion_key) DO NOTHING;

-- Pro (total weight = 100)
INSERT INTO public.scoring_config
  (tier, criterion_key, label, description, weight, sort_order)
VALUES
  ('pro','uses_fix',
   'Uses FIX',
   'Contact uses FIX protocol for order routing',
   25, 1),
  ('pro','uses_rest_api',
   'Uses REST API',
   'Contact uses REST API for programmatic trading',
   20, 2),
  ('pro','adv_over_100k',
   'ADV > $100K',
   'Average daily volume exceeds $100K USD',
   20, 3),
  ('pro','multiple_asset_classes',
   'Multi Asset Class',
   'Contact trades more than one asset class',
   15, 4),
  ('pro','kyc_approved',
   'KYC Approved',
   'Contact KYC status is fully approved',
   10, 5),
  ('pro','has_programming_languages',
   'Programmatic Trader',
   'Contact has programming languages on file',
   10, 6)
ON CONFLICT (tier, criterion_key) DO NOTHING;

-- Individual (total weight = 100)
INSERT INTO public.scoring_config
  (tier, criterion_key, label, description, weight, sort_order)
VALUES
  ('individual','stage_funded_or_later',
   'Funded or Later',
   'Lead has reached funded stage or beyond',
   30, 1),
  ('individual','stage_first_trade_or_later',
   'First Trade or Later',
   'Lead has placed at least one trade',
   25, 2),
  ('individual','multiple_asset_classes',
   'Multi Asset Class',
   'Lead trades more than one asset class',
   20, 3),
  ('individual','uses_rest_api',
   'Uses REST API',
   'Lead uses REST API for trading',
   15, 4),
  ('individual','recently_contacted',
   'Recently Contacted',
   'Lead was contacted within the last 30 days',
   10, 5)
ON CONFLICT (tier, criterion_key) DO NOTHING;

-- ── 7. Confirmation query ────────────────────────────────────
SELECT tier, COUNT(*) AS criteria_count, SUM(weight) AS total_weight
FROM public.scoring_config
GROUP BY tier
ORDER BY tier;
-- Each tier should show total_weight = 100
