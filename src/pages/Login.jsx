import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { supabase } from '../lib/supabase';

export default function Login() {
  const { session, signInWithGoogle, signInWithMicrosoft } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reason = params.get('reason');

  const [email,   setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [linkErr, setLinkErr] = useState('');

  useEffect(() => {
    if (session) navigate('/dashboard', { replace: true });
  }, [session, navigate]);

  const handleMagicLink = async (e) => {
    e.preventDefault();
    setSending(true);
    setLinkErr('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setLinkErr(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-mark">L</div>
          <span className="login-logo-text">lime-crm</span>
        </div>

        <p className="login-subtitle">Lime Trading CRM</p>

        {reason === 'deactivated' && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
            padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626',
            lineHeight: 1.5,
          }}>
            Your account has been deactivated. Please contact your administrator.
          </div>
        )}

        {sent ? (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✉</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Check your email</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              We sent a sign-in link to <strong>{email}</strong>.<br />
              Click the link to sign in — no password needed.
            </div>
            <button
              style={{
                fontSize: 12, marginTop: 18, color: 'var(--text-tertiary)',
                background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
              onClick={() => { setSent(false); setEmail(''); }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleMagicLink}>
              <input
                type="email"
                required
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setLinkErr(''); }}
                className="form-input"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              />
              {linkErr && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{linkErr}</div>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={sending}
              >
                {sending ? 'Sending…' : 'Send Magic Link'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <button className="oauth-btn" onClick={signInWithGoogle}>
              <GoogleIcon />
              Continue with Google
            </button>

            <button className="oauth-btn" onClick={signInWithMicrosoft}>
              <MicrosoftIcon />
              Continue with Microsoft
            </button>
          </>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 20, lineHeight: 1.6 }}>
          Access restricted to authorised team members.<br />
          Contact your admin if you need access.
        </p>
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
