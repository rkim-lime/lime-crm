import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export const SUPERUSER_EMAIL = import.meta.env.VITE_SUPERUSER_EMAIL || '';

export function isSuperuser(email) {
  return !!(email && SUPERUSER_EMAIL &&
    email.toLowerCase() === SUPERUSER_EMAIL.toLowerCase());
}
