-- Migration 009: User management — full_name on invitations,
-- hard-delete function, updated handle_new_user trigger

-- 1. full_name on invitations (so we can populate profiles pre-signup)
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS full_name text;

-- 2. Hard-delete a user (SECURITY DEFINER — runs as owner, bypasses RLS)
--    Only authenticated admins may call this; the is_admin() guard is a
--    second line of defence after the UI superuser-only check.
CREATE OR REPLACE FUNCTION public.delete_user_completely(
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  -- Deleting auth.users cascades to public.profiles via the FK defined
  -- in the Supabase auth schema.  All other FKs that reference
  -- profiles.id with ON DELETE SET NULL will null out automatically.
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_completely(uuid) TO authenticated;

-- 3. Updated handle_new_user() trigger — prefers invitation full_name,
--    falls back to OAuth / magic-link raw_user_meta_data.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  assigned_role      public.user_role := 'pending';
  invitation_record  RECORD;
  v_invited_by       uuid        := NULL;
  v_invited_at       timestamptz := NULL;
  v_full_name        text;
BEGIN
  SELECT * INTO invitation_record
  FROM public.invitations
  WHERE email      = new.email
    AND status     = 'pending'
    AND expires_at > now()
  ORDER BY invited_at DESC
  LIMIT 1;

  IF FOUND THEN
    assigned_role := invitation_record.role;
    v_invited_by  := invitation_record.invited_by;
    v_invited_at  := invitation_record.invited_at;
    v_full_name   := invitation_record.full_name;

    UPDATE public.invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = invitation_record.id;
  END IF;

  -- Prefer invitation name; fall back to OAuth / magic-link metadata
  IF v_full_name IS NULL THEN
    v_full_name := new.raw_user_meta_data->>'full_name';
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, role,
    invited_by, invited_at
  ) VALUES (
    new.id,
    new.email,
    v_full_name,
    new.raw_user_meta_data->>'avatar_url',
    assigned_role,
    v_invited_by,
    v_invited_at
  );

  IF assigned_role = 'pending' THEN
    INSERT INTO public.activities (type, title, body, created_by)
    VALUES (
      'note',
      'New user pending approval',
      'User ' || new.email || ' signed up and is pending approval.',
      NULL
    );
  END IF;

  RETURN new;
END;
$function$;

-- 4. Verification query (run manually to confirm)
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'invitations' AND column_name = 'full_name') AS inv_full_name,
--   (SELECT COUNT(*) FROM pg_proc
--    WHERE proname = 'delete_user_completely') AS delete_fn;
-- Expected: 1, 1
