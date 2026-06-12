import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSuperuser as checkSuperuser } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession]             = useState(undefined); // undefined = loading
  const [profile, setProfile]             = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); setProfileLoading(false); return; }

    setProfileLoading(true);

    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setProfileLoading(false);
        if (!data) return;

        // Deactivated account: sign out immediately
        if (data.is_active === false) {
          supabase.auth.signOut().then(() => {
            window.location.replace('/login?reason=deactivated');
          });
          return;
        }

        // Superuser always gets admin role regardless of DB value
        const effectiveRole = checkSuperuser(session.user.email) ? 'admin' : data.role;
        setProfile({ ...data, role: effectiveRole });

        // Update last_sign_in (fire-and-forget)
        supabase
          .from('profiles')
          .update({ last_sign_in: new Date().toISOString() })
          .eq('id', session.user.id);
      });
  }, [session]);

  const role      = profile?.role ?? null;
  const isPending = role === 'pending';
  const isSuperuser = !!(session?.user?.email && checkSuperuser(session.user.email));

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });

  const signInWithMicrosoft = () =>
    supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{
      session, profile, role, isPending, isSuperuser, profileLoading,
      signInWithGoogle, signInWithMicrosoft, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
