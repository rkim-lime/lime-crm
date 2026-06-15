-- Migration: 007_ownership.sql
-- Adds sales_owner_id (rename from owner_id), service_manager_id, and deal_team table.

-- 1. Rename owner_id → sales_owner_id on all four tables
ALTER TABLE public.accounts  RENAME COLUMN owner_id TO sales_owner_id;
ALTER TABLE public.deals     RENAME COLUMN owner_id TO sales_owner_id;
ALTER TABLE public.contacts  RENAME COLUMN owner_id TO sales_owner_id;
ALTER TABLE public.leads     RENAME COLUMN owner_id TO sales_owner_id;

-- 2. Add service_manager_id to accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS service_manager_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Create deal_team table
CREATE TABLE IF NOT EXISTS public.deal_team (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id)    ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'Team Member'
                CHECK (role IN (
                  'Team Member',
                  'Senior Relationship Manager',
                  'Technical Sales',
                  'Compliance Liaison',
                  'Operations Lead',
                  'Management Sponsor'
                )),
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE(deal_id, profile_id)
);

-- 4. Enable RLS on deal_team
ALTER TABLE public.deal_team ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_team_select" ON public.deal_team
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "deal_team_insert" ON public.deal_team
  FOR INSERT WITH CHECK (
    current_user_role() IN ('admin','sales','operations')
  );

CREATE POLICY "deal_team_update" ON public.deal_team
  FOR UPDATE USING (
    is_admin() OR added_by = auth.uid()
  );

CREATE POLICY "deal_team_delete" ON public.deal_team
  FOR DELETE USING (
    is_admin()
    OR added_by = auth.uid()
    OR current_user_role() = 'sales'
  );

-- 5. Indexes
CREATE INDEX IF NOT EXISTS ON public.accounts(sales_owner_id);
CREATE INDEX IF NOT EXISTS ON public.accounts(service_manager_id);
CREATE INDEX IF NOT EXISTS ON public.deals(sales_owner_id);
CREATE INDEX IF NOT EXISTS ON public.contacts(sales_owner_id);
CREATE INDEX IF NOT EXISTS ON public.leads(sales_owner_id);
CREATE INDEX IF NOT EXISTS ON public.deal_team(deal_id);
CREATE INDEX IF NOT EXISTS ON public.deal_team(profile_id);

-- 6. Update RLS policies that referenced owner_id

-- Accounts
DROP POLICY IF EXISTS "accounts_update" ON public.accounts;
CREATE POLICY "accounts_update" ON public.accounts
  FOR UPDATE USING (
    is_admin()
    OR current_user_role() = 'operations'
    OR (current_user_role() = 'sales' AND sales_owner_id = auth.uid())
  );

-- Contacts
DROP POLICY IF EXISTS "contacts_update" ON public.contacts;
CREATE POLICY "contacts_update" ON public.contacts
  FOR UPDATE USING (
    is_admin()
    OR current_user_role() = 'operations'
    OR (current_user_role() = 'sales' AND sales_owner_id = auth.uid())
  );

-- Deals
DROP POLICY IF EXISTS "deals_update" ON public.deals;
CREATE POLICY "deals_update" ON public.deals
  FOR UPDATE USING (
    is_admin()
    OR (current_user_role() = 'sales' AND sales_owner_id = auth.uid())
  );

-- Leads
DROP POLICY IF EXISTS "leads_update" ON public.leads;
CREATE POLICY "leads_update" ON public.leads
  FOR UPDATE USING (
    is_admin()
    OR (current_user_role() = 'sales' AND sales_owner_id = auth.uid())
    OR current_user_role() = 'operations'
  );

-- 7. Backfill existing rows with the first admin user
UPDATE public.accounts
SET sales_owner_id = (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1)
WHERE sales_owner_id IS NULL;

UPDATE public.deals
SET sales_owner_id = (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1)
WHERE sales_owner_id IS NULL;

UPDATE public.leads
SET sales_owner_id = (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1)
WHERE sales_owner_id IS NULL;

-- 8. Confirmation query
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'sales_owner_id')    AS acct_sales_owner,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'service_manager_id') AS acct_svc_mgr,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'deals'    AND column_name = 'sales_owner_id')    AS deal_sales_owner,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name = 'deal_team')                                      AS deal_team_table;
-- Expected: 1, 1, 1, 1
