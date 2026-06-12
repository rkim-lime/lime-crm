-- ============================================================
-- Migration 002: Infrastructure columns, deal stage renames,
--                deal_motion enum updates
-- ============================================================

-- ── 1. Infrastructure columns for accounts ───────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS colo          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS market_data   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hosting       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cross_connect BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Infrastructure columns for deals ──────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS colo          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS market_data   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hosting       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cross_connect BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Rename deal_stage enum values ─────────────────────────
-- RENAME VALUE is idempotent-safe: if the old value doesn't exist
-- (already renamed in a prior run), Postgres raises invalid_parameter_value
-- which we swallow.
DO $$ BEGIN
  ALTER TYPE deal_stage RENAME VALUE 'proposal_sent' TO 'proposal';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE deal_stage RENAME VALUE 'technical_due_diligence' TO 'legal_compliance';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE deal_stage RENAME VALUE 'closed_won' TO 'live';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE deal_stage RENAME VALUE 'closed_lost' TO 'lost';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

-- ── 4. deal_motion enum: add tier-aligned values ─────────────
-- ADD VALUE raises duplicate_object if value already exists; swallow it.
DO $$ BEGIN
  ALTER TYPE deal_motion ADD VALUE 'enterprise';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE deal_motion ADD VALUE 'pro';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE deal_motion ADD VALUE 'individual';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. Backfill deal motion from tier ────────────────────────
-- Sync motion to match tier for all deals that have a tier.
-- This fixes deals that still carry old motion values.
UPDATE deals
  SET motion = tier::text::deal_motion
  WHERE tier IS NOT NULL;
