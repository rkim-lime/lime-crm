-- ============================================================
-- Migration 005b: User access management (run AFTER 005a)
-- ============================================================

-- ── 1. Change default role to 'pending' ──────────────────────
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'pending';

-- ── 2. Add access-management columns to profiles ─────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active       boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_sign_in    timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 3. invitations table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  role        user_role   NOT NULL DEFAULT 'analyst',
  invited_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  token       text        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status      text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','expired','revoked')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 4. RLS on invitations ─────────────────────────────────────
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_select" ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert" ON public.invitations;
DROP POLICY IF EXISTS "invitations_update" ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (is_admin());

CREATE POLICY "invitations_insert" ON public.invitations
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "invitations_update" ON public.invitations
  FOR UPDATE USING (is_admin());

-- ── 5. handle_new_user trigger (updated) ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  assigned_role      user_role   := 'pending';
  invitation_record  RECORD;
  v_invited_by       uuid        := NULL;
  v_invited_at       timestamptz := NULL;
BEGIN
  -- Check for a valid pending invitation matching this email
  SELECT * INTO invitation_record
  FROM public.invitations
  WHERE email = new.email
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY invited_at DESC
  LIMIT 1;

  IF FOUND THEN
    assigned_role := invitation_record.role;
    v_invited_by  := invitation_record.invited_by;
    v_invited_at  := invitation_record.invited_at;

    UPDATE public.invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = invitation_record.id;
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, role,
    invited_by, invited_at
  ) VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    assigned_role,
    v_invited_by,
    v_invited_at
  );

  -- Notify admin of pending user via activity log
  -- TODO: Wire to email provider (Resend/SendGrid) via
  -- Supabase Edge Function to notify admin at SUPERUSER_EMAIL
  IF assigned_role = 'pending' THEN
    INSERT INTO public.activities (type, title, body, created_by)
    VALUES (
      'note',
      'New user pending approval',
      'User ' || new.email || ' signed up and is pending approval.',
      new.id
    );
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. Update profiles RLS policies ──────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR current_user_role() IN (
      'admin','partner','sales','operations','compliance','analyst'
    )
  );

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (is_admin());

-- ── 7. Public RPC to validate an invite token ─────────────────
-- Accessible without authentication (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS TABLE(
  id          uuid,
  email       text,
  role        user_role,
  invited_by  uuid,
  status      text,
  expires_at  timestamptz,
  notes       text
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, email, role, invited_by, status, expires_at, notes
  FROM public.invitations
  WHERE token = p_token;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token TO anon, authenticated;

-- ── 8. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invitations_email_status_idx
  ON public.invitations(email, status);

CREATE INDEX IF NOT EXISTS profiles_role_is_active_idx
  ON public.profiles(role, is_active);

-- ── 9. Ensure admin profile is active ───────────────────────
UPDATE public.profiles
SET role = 'admin', is_active = true
WHERE email = 'rkim@limex.com';

-- ── 10. Confirmation ──────────────────────────────────────────
SELECT
  role,
  COUNT(*) AS count,
  SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active
FROM public.profiles
GROUP BY role
ORDER BY role;
