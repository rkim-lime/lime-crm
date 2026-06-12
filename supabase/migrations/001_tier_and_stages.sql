-- ============================================================
-- Migration 001: client_tier enum, updated account_segment,
--                updated deal_stage, tier columns, seed updates
-- ============================================================

-- ── 1. New client_tier enum ─────────────────────────────────
CREATE TYPE client_tier AS ENUM ('enterprise', 'pro', 'individual');

-- ── 2. Update account_segment (rename → new → drop old) ─────
-- Drop defaults that reference the old enum so the cast doesn't fail
ALTER TABLE accounts  ALTER COLUMN segment DROP DEFAULT;
ALTER TABLE contacts  ALTER COLUMN segment DROP DEFAULT;

ALTER TYPE account_segment RENAME TO account_segment_old;

CREATE TYPE account_segment AS ENUM (
  -- Enterprise
  'hft_firm',
  'hedge_fund',
  'quant_fund',
  'broker_dealer',
  'family_office',
  'prime_broker',
  -- Pro
  'prop_trader',
  'quant_developer',
  'algo_trader',
  -- Individual
  'retail_trader'
);

ALTER TABLE accounts
  ALTER COLUMN segment TYPE account_segment
  USING (CASE segment::text
    WHEN 'hft'           THEN 'hft_firm'::account_segment
    WHEN 'hedge_fund'    THEN 'hedge_fund'::account_segment
    WHEN 'quant_fund'    THEN 'quant_fund'::account_segment
    WHEN 'broker_dealer' THEN 'broker_dealer'::account_segment
    WHEN 'prop_trader'   THEN 'prop_trader'::account_segment
    WHEN 'algo_trader'   THEN 'algo_trader'::account_segment
    WHEN 'dma_user'      THEN 'algo_trader'::account_segment
    WHEN 'retail'        THEN 'retail_trader'::account_segment
    ELSE                      'retail_trader'::account_segment
  END);

ALTER TABLE contacts
  ALTER COLUMN segment TYPE account_segment
  USING (CASE segment::text
    WHEN 'hft'           THEN 'hft_firm'::account_segment
    WHEN 'hedge_fund'    THEN 'hedge_fund'::account_segment
    WHEN 'quant_fund'    THEN 'quant_fund'::account_segment
    WHEN 'broker_dealer' THEN 'broker_dealer'::account_segment
    WHEN 'prop_trader'   THEN 'prop_trader'::account_segment
    WHEN 'algo_trader'   THEN 'algo_trader'::account_segment
    WHEN 'dma_user'      THEN 'algo_trader'::account_segment
    WHEN 'retail'        THEN 'retail_trader'::account_segment
    ELSE                      'retail_trader'::account_segment
  END);

DROP TYPE account_segment_old;

-- ── 3. Convert accounts.tier: account_tier → client_tier ────
-- Drop default first so Postgres doesn't try to cast it automatically
ALTER TABLE accounts ALTER COLUMN tier DROP DEFAULT;

ALTER TABLE accounts
  ALTER COLUMN tier TYPE client_tier
  USING (CASE tier::text
    WHEN 'institutional' THEN 'enterprise'::client_tier
    WHEN 'professional'  THEN 'pro'::client_tier
    WHEN 'retail'        THEN 'individual'::client_tier
    ELSE                      'enterprise'::client_tier
  END);

DROP TYPE account_tier;

-- ── 4. Add tier column to contacts and deals ─────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tier client_tier;
ALTER TABLE deals    ADD COLUMN IF NOT EXISTS tier client_tier;

-- ── 5. Update deal_stage (rename → new → drop old) ───────────
ALTER TABLE deals ALTER COLUMN stage DROP DEFAULT;

ALTER TYPE deal_stage RENAME TO deal_stage_old;

CREATE TYPE deal_stage AS ENUM (
  -- Shared institutional 8-stage pipeline
  'prospecting',
  'qualified',
  'proposal_sent',
  'technical_due_diligence',
  'negotiating',
  'onboarding',
  'closed_won',
  'closed_lost',
  -- Individual 9-stage lifecycle
  'lead_in',
  'engaged',
  'api_demo',
  'kyc_submitted',
  'kyc_approved',
  'funded',
  'first_trade',
  'active_trader',
  'dormant'
);

ALTER TABLE deals
  ALTER COLUMN stage TYPE deal_stage
  USING stage::text::deal_stage;

DROP TYPE deal_stage_old;

-- ── 6. Seed data: derive tiers from segments ─────────────────
UPDATE accounts SET tier = 'enterprise'
  WHERE segment IN ('hft_firm','hedge_fund','quant_fund','broker_dealer','family_office','prime_broker');
UPDATE accounts SET tier = 'pro'
  WHERE segment IN ('prop_trader','quant_developer','algo_trader');
UPDATE accounts SET tier = 'individual'
  WHERE segment = 'retail_trader';

UPDATE contacts SET tier = 'enterprise'
  WHERE segment IN ('hft_firm','hedge_fund','quant_fund','broker_dealer','family_office','prime_broker');
UPDATE contacts SET tier = 'pro'
  WHERE segment IN ('prop_trader','quant_developer','algo_trader');
UPDATE contacts SET tier = 'individual'
  WHERE segment = 'retail_trader';

-- Propagate tier to deals from their linked account
UPDATE deals d
  SET tier = a.tier
  FROM accounts a
  WHERE d.account_id = a.id
    AND a.tier IS NOT NULL;

-- ── 7. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounts_tier ON accounts(tier);
CREATE INDEX IF NOT EXISTS idx_contacts_tier ON contacts(tier);
CREATE INDEX IF NOT EXISTS idx_deals_tier    ON deals(tier);
