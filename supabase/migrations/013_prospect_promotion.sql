-- ============================================================
-- Migration 013: Prospect promotion tracking
-- Adds 'promoted' status and promotion metadata columns to
-- the prospects table so the Convert-to-Account flow can
-- record where and by whom a prospect was promoted.
-- ============================================================

-- ── 1. Add 'promoted' to the prospect_status enum ────────────
ALTER TYPE prospect_status ADD VALUE IF NOT EXISTS 'promoted';

-- ── 2. Add promotion metadata columns ────────────────────────
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS promoted_to_account_id uuid
    REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by   uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 3. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS prospects_promoted_to_account_idx
  ON public.prospects(promoted_to_account_id)
  WHERE promoted_to_account_id IS NOT NULL;
