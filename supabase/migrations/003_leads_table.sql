-- ============================================================
-- Migration 003: leads table for individual-tier prospects
-- ============================================================

-- ── 1. lead_stage enum ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE lead_stage AS ENUM (
    'visitor', 'lead', 'nurture', 'activated', 'funded',
    'first_trade', 'active', 'dormant', 'churned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. lead_status enum ─────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('active', 'converted', 'churned', 'dormant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. leads table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            uuid NOT NULL REFERENCES public.contacts(id)
                          ON DELETE CASCADE,
  owner_id              uuid REFERENCES public.profiles(id)
                          ON DELETE SET NULL,
  created_by            uuid REFERENCES public.profiles(id)
                          ON DELETE SET NULL,

  -- Lifecycle
  stage                 lead_stage   NOT NULL DEFAULT 'lead',
  status                lead_status  NOT NULL DEFAULT 'active',

  -- Attribution
  source                text,
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  referrer_contact_id   uuid REFERENCES public.contacts(id)
                          ON DELETE SET NULL,

  -- Trading profile
  asset_classes         asset_class[] DEFAULT '{}',
  uses_rest_api         boolean NOT NULL DEFAULT false,
  uses_fix              boolean NOT NULL DEFAULT false,
  programming_languages text[]  DEFAULT '{}',
  lead_score            integer DEFAULT 0
                          CHECK (lead_score >= 0 AND lead_score <= 100),

  -- Milestones
  funded_amount         numeric(15,2),
  first_funded_at       timestamptz,
  first_trade_at        timestamptz,
  activated_at          timestamptz,
  churned_at            timestamptz,
  churn_reason          text,

  -- Conversion
  converted_at          timestamptz,
  converted_to_deal_id  uuid REFERENCES public.deals(id)
                          ON DELETE SET NULL,
  converted_to_tier     client_tier,
  conversion_notes      text,

  -- Meta
  notes                 text,
  tags                  text[]  DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Update account_contacts junction ─────────────────────
ALTER TABLE public.account_contacts
  ADD COLUMN IF NOT EXISTS ownership_pct        numeric(5,2),
  ADD COLUMN IF NOT EXISTS is_beneficial_owner  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_control_person    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kyb_role_verified    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kyb_role_verified_at timestamptz;

-- ── 5. updated_at trigger ───────────────────────────────────
-- Create the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.leads;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 6. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS leads_contact_id_idx          ON public.leads(contact_id);
CREATE INDEX IF NOT EXISTS leads_owner_id_idx            ON public.leads(owner_id);
CREATE INDEX IF NOT EXISTS leads_status_idx              ON public.leads(status);
CREATE INDEX IF NOT EXISTS leads_stage_idx               ON public.leads(stage);
CREATE INDEX IF NOT EXISTS leads_converted_to_deal_id_idx ON public.leads(converted_to_deal_id);
CREATE INDEX IF NOT EXISTS leads_created_by_idx          ON public.leads(created_by);

-- ── 7. RLS ───────────────────────────────────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select" ON public.leads;
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_delete" ON public.leads;

CREATE POLICY "leads_select" ON public.leads FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "leads_insert" ON public.leads FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'sales', 'operations'));

CREATE POLICY "leads_update" ON public.leads FOR UPDATE
  USING (
    is_admin()
    OR (current_user_role() = 'sales' AND owner_id = auth.uid())
    OR current_user_role() = 'operations'
  );

CREATE POLICY "leads_delete" ON public.leads FOR DELETE
  USING (is_admin());

-- ── 8. Migrate existing individual deals → leads ─────────────
DO $$
DECLARE
  deal        RECORD;
  new_stage   lead_stage;
BEGIN
  FOR deal IN
    SELECT * FROM public.deals WHERE motion = 'individual'
  LOOP
    new_stage := CASE deal.stage::text
      WHEN 'visitor'     THEN 'visitor'::lead_stage
      WHEN 'lead'        THEN 'lead'::lead_stage
      WHEN 'nurture'     THEN 'nurture'::lead_stage
      WHEN 'activated'   THEN 'activated'::lead_stage
      WHEN 'funded'      THEN 'funded'::lead_stage
      WHEN 'first_trade' THEN 'first_trade'::lead_stage
      WHEN 'active'      THEN 'active'::lead_stage
      WHEN 'dormant'     THEN 'dormant'::lead_stage
      WHEN 'churned'     THEN 'churned'::lead_stage
      ELSE 'lead'::lead_stage
    END;

    IF deal.contact_id IS NOT NULL THEN
      INSERT INTO public.leads (
        contact_id, owner_id, stage, status,
        asset_classes, notes, created_at
      ) VALUES (
        deal.contact_id,
        deal.owner_id,
        new_stage,
        'active'::lead_status,
        deal.asset_classes,
        deal.notes,
        deal.created_at
      );
    END IF;
  END LOOP;
END $$;

-- Archive migrated individual deals (keep for audit)
UPDATE public.deals
SET   status = 'inactive',
      notes  = COALESCE(notes, '') || ' [Migrated to leads table]'
WHERE motion = 'individual';

-- ── 9. Seed test leads ───────────────────────────────────────
-- Aiko Yamamoto
INSERT INTO public.leads (
  contact_id, stage, status, source, uses_rest_api,
  asset_classes, lead_score, programming_languages
)
SELECT
  id,
  'activated'::lead_stage,
  'active'::lead_status,
  'web_signup',
  true,
  ARRAY['equities','futures']::asset_class[],
  45,
  ARRAY['python','rust']
FROM public.contacts
WHERE email = 'aiko@dev.io'
LIMIT 1;

-- Ben Okafor
INSERT INTO public.leads (
  contact_id, stage, status, source,
  asset_classes, lead_score,
  funded_amount, first_funded_at
)
SELECT
  id,
  'funded'::lead_stage,
  'active'::lead_status,
  'organic_search',
  ARRAY['equities']::asset_class[],
  38,
  25000,
  now() - interval '30 days'
FROM public.contacts
WHERE email = 'ben.okafor@pm.me'
LIMIT 1;

-- Priya Sharma — active lead
INSERT INTO public.leads (
  contact_id, stage, status, source, uses_rest_api,
  asset_classes, lead_score, programming_languages,
  first_funded_at, first_trade_at
)
SELECT
  id,
  'first_trade'::lead_stage,
  'active'::lead_status,
  'referral',
  true,
  ARRAY['equities','options']::asset_class[],
  52,
  ARRAY['python','javascript'],
  now() - interval '45 days',
  now() - interval '20 days'
FROM public.contacts
WHERE email = 'priya@tradecraft.dev'
LIMIT 1;

-- Priya Sharma — orphaned conversion (no linked deal — UAT hygiene)
INSERT INTO public.leads (
  contact_id, status, stage,
  converted_at, converted_to_tier, converted_to_deal_id,
  conversion_notes
)
SELECT
  id,
  'converted'::lead_status,
  'active'::lead_stage,
  now() - interval '10 days',
  'pro'::client_tier,
  NULL,
  'Test orphaned conversion for hygiene UAT'
FROM public.contacts
WHERE email = 'priya@tradecraft.dev'
LIMIT 1;

-- ── 10. Confirm migration results ────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.leads)                                             AS leads_count,
  (SELECT COUNT(*) FROM public.deals WHERE motion = 'individual')                 AS individual_deals_count,
  (SELECT COUNT(*) FROM public.account_contacts WHERE is_beneficial_owner IS NOT NULL) AS ac_rows;
