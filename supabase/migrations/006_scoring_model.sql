-- ============================================================
-- Migration 006: Complete scoring model revamp
-- ============================================================

-- ── 1. score_type enum ────────────────────────────────────────
CREATE TYPE score_type AS ENUM ('lead','deal','contact_health','account_health');

-- ── 2. Add new columns to scoring_config ─────────────────────
ALTER TABLE public.scoring_config
  ADD COLUMN IF NOT EXISTS score_type            score_type,
  ADD COLUMN IF NOT EXISTS requires_integration  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS integration_label     text;

-- ── 3. Migrate existing rows ──────────────────────────────────
UPDATE public.scoring_config
  SET score_type = 'lead'
  WHERE tier = 'individual';

-- Remove old enterprise/pro rows — replaced by purpose-built deal criteria below
DELETE FROM public.scoring_config
  WHERE tier IN ('enterprise', 'pro');

-- ── 4. Make score_type NOT NULL ───────────────────────────────
ALTER TABLE public.scoring_config
  ALTER COLUMN score_type SET NOT NULL;

-- ── 5. Swap unique constraint ─────────────────────────────────
ALTER TABLE public.scoring_config
  DROP CONSTRAINT IF EXISTS scoring_config_tier_criterion_key_key;

ALTER TABLE public.scoring_config
  ADD CONSTRAINT scoring_config_score_type_criterion_key_key
    UNIQUE (score_type, criterion_key);

-- ── 6. deal_score on deals ────────────────────────────────────
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS deal_score integer
    CHECK (deal_score BETWEEN 0 AND 100);

-- ── 7. contact_health_score on contacts ──────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS contact_health_score integer
    CHECK (contact_health_score BETWEEN 0 AND 100);

-- ── 8. Update score_history record_type check ─────────────────
ALTER TABLE public.score_history
  DROP CONSTRAINT IF EXISTS score_history_record_type_check;

ALTER TABLE public.score_history
  ADD CONSTRAINT score_history_record_type_check
    CHECK (record_type IN ('lead','deal','contact','account'));

-- ── 9. Seed deal criteria ─────────────────────────────────────
INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description, weight, is_active, sort_order)
VALUES
  ('deal','enterprise','probability_over_50','Probability > 50%',
    'Win probability is above 50%',20,true,1),
  ('deal','enterprise','aum_over_100m','AUM > $100M',
    'Account manages more than $100M AUM',25,true,2),
  ('deal','enterprise','kyc_approved','KYC Approved',
    'Account has passed KYC verification',20,true,3),
  ('deal','enterprise','technical_requirements','Technical Requirements Met',
    'Colocation, hosting, or DMA routing confirmed',15,true,4),
  ('deal','enterprise','close_date_90_days','Close Date ≤ 90 Days',
    'Expected close date is within 90 days',10,true,5),
  ('deal','enterprise','multiple_asset_classes','Multi Asset Class',
    'Deal covers more than one asset class',10,true,6)
ON CONFLICT (score_type, criterion_key) DO NOTHING;

-- ── 10. Seed contact_health criteria ─────────────────────────
INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description,
   weight, is_active, sort_order, requires_integration, integration_label)
VALUES
  ('contact_health','individual','multi_asset','Multi Asset Class',
    'Contact trades across multiple asset classes',
    20,true,1,false,null),
  ('contact_health','individual','recently_engaged','Recently Engaged',
    'Contact had activity in the last 60 days',
    20,true,2,false,null),
  ('contact_health','individual','uses_api','Uses REST or FIX API',
    'Contact uses REST API or FIX connectivity',
    15,true,3,false,null),
  ('contact_health','individual','trading_frequency','High Trading Frequency',
    'Contact trades more than twice per week',
    25,true,4,true,'Trading system'),
  ('contact_health','individual','account_equity','Funded Account > $10K',
    'Account equity is over $10,000',
    20,true,5,true,'Clearing system')
ON CONFLICT (score_type, criterion_key) DO NOTHING;

-- ── 11. Seed account_health criteria ─────────────────────────
INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description,
   weight, is_active, sort_order, requires_integration, integration_label)
VALUES
  ('account_health','enterprise','recent_activity','Recent Activity',
    'Activity logged within the last 30 days',
    20,true,1,false,null),
  ('account_health','enterprise','no_overdue_tasks','No Overdue Tasks',
    'No open tasks have passed their due date',
    15,true,2,false,null),
  ('account_health','enterprise','multi_asset','Multi Asset Class',
    'Account trades across multiple asset classes',
    10,true,3,false,null),
  ('account_health','enterprise','fully_onboarded','Fully Onboarded',
    'KYC approved and account is active',
    10,true,4,false,null),
  ('account_health','enterprise','adv_vs_expected','ADV vs Expected',
    'Actual ADV within 20% of expected ADV',
    25,true,5,true,'Trading system'),
  ('account_health','enterprise','no_support_issues','No Open Support Issues',
    'No unresolved support tickets',
    20,true,6,true,'Support system')
ON CONFLICT (score_type, criterion_key) DO NOTHING;

-- ── 12. Update indexes ────────────────────────────────────────
DROP INDEX IF EXISTS idx_scoring_config_tier;
CREATE INDEX IF NOT EXISTS idx_scoring_config_score_type
  ON public.scoring_config(score_type);

-- ── 13. Confirmation ──────────────────────────────────────────
SELECT
  score_type,
  COUNT(*)                   AS criteria_count,
  SUM(weight)                AS total_weight,
  SUM(CASE WHEN requires_integration THEN weight ELSE 0 END) AS integration_weight
FROM public.scoring_config
GROUP BY score_type
ORDER BY score_type;
