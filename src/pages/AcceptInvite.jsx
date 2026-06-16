import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const ROLE_LABELS = {
  admin: 'Admin', partner: 'Partner', sales: 'Sales',
  operations: 'Operations', compliance: 'Compliance', analyst: 'Analyst',
};

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [invitation, setInvitation] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [sending,    setSending]    = useState(false);
  const [sent,       setSent]       = useState(false);
  const [magicErr,   setMagicErr]   = useState('');

  useEffect(() => {
    if (!token) {
      setError('No invite token found in this link. Please check the URL and try again.');
      setLoading(false);
      return;
    }

    supabase
      .rpc('get_invitation_by_token', { p_token: token })
      .single()
      .then(({ data, error: rpcErr }) => {
        setLoading(false);
        if (rpcErr || !data) {
          setError('This invite link is invalid or has expired. Please contact your administrator.');
          return;
        }
        if (data.status === 'accepted') {
          setError('This invite has already been accepted. Please sign in directly.');
          return;
        }
        if (data.status !== 'pending' || new Date(data.expires_at) < new Date()) {
          setError('This invite link has expired. Please contact your administrator for a new one.');
          return;
        }
        setInvitation(data);
      });
  }, [token]);

  const handleGoogleSignIn = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });

  const handleMagicLink = async () => {
    setSending(true);
    setMagicErr('');
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: invitation.email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (otpErr) throw otpErr;
      setSent(true);
    } catch (err) {
      setMagicErr(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-primary)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420, textAlign: 'center',
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '44px 36px',
      }}>
        {/* Branding */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
          }}>L</div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>lime-crm</span>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Validating invite…</div>
        ) : error ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 14 }}>⚠</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Invalid Invite</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{error}</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 14 }}>✉</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>You've been invited</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 22 }}>
              Sign in to accept your invitation to Lime CRM.
            </p>

            <div style={{
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>Email</span>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{invitation.email}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>Role</span>
                <span className={`badge badge-tier-${invitation.role}`} style={{ fontSize: 12 }}>
                  {ROLE_LABELS[invitation.role] ?? invitation.role}
                </span>
              </div>
            </div>

            {sent ? (
              <div style={{ textAlign: 'center', padding: '4px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✉</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Check your email</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                  We sent a sign-in link to <strong>{invitation.email}</strong>.<br />
                  Click the link to complete your sign-in.
                </div>
              </div>
            ) : (
              <>
                <input
                  type="email"
                  readOnly
                  value={invitation.email}
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, opacity: 0.7 }}
                />
                {magicErr && (
                  <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{magicErr}</div>
                )}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginBottom: 16 }}
                  onClick={handleMagicLink}
                  disabled={sending}
                >
                  {sending ? 'Sending…' : 'Send Magic Link'}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>or</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                <button className="oauth-btn" style={{ width: '100%' }} onClick={handleGoogleSignIn}>
                  <GoogleIcon />
                  Continue with Google
                </button>
              </>
            )}

            <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 20, lineHeight: 1.6 }}>
              By signing in you accept the terms of service. Your role will be automatically assigned based on this invitation.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}
