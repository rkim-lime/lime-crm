import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../hooks/useAuth.jsx';
import { useUpdateUserName } from '../hooks/useUsers';

const ROLE_LABELS = {
  admin: 'Admin', partner: 'Partner', sales: 'Sales',
  operations: 'Operations', compliance: 'Compliance',
  analyst: 'Analyst', pending: 'Pending',
};

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function avatarColor(text) {
  return AVATAR_COLORS[(text?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}

function initials(name, email) {
  const text = name || email || '?';
  return text.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function MyProfile() {
  const { profile, session } = useAuth();
  const update = useUpdateUserName();

  const [name, setName]     = useState('');
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (profile) setName(profile.full_name ?? '');
  }, [profile]);

  const email = profile?.email ?? session?.user?.email ?? '';
  const role  = profile?.role ?? '';

  const handleSave = async (e) => {
    e.preventDefault();
    setSaved(false);
    setError('');
    try {
      await update.mutateAsync({ id: profile.id, full_name: name.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    }
  };

  const avatarText = name || email;

  return (
    <Layout title="My Profile">
      <div style={{ maxWidth: 520 }}>
        <form onSubmit={handleSave}>
          <div className="card card-body" style={{ marginBottom: 16 }}>
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: avatarColor(avatarText),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>
                {initials(name, email)}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{name || '(no name set)'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{email}</div>
              </div>
            </div>

            {/* Full Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setSaved(false); setError(''); }}
                placeholder="Your full name"
                className="form-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {/* Email — read-only */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                readOnly
                className="form-input"
                style={{ width: '100%', boxSizing: 'border-box', opacity: 0.65 }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                Email is tied to your sign-in and cannot be changed here.
              </div>
            </div>

            {/* Role — read-only */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Role
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`badge badge-tier-${role}`}>{ROLE_LABELS[role] ?? role}</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Contact an admin to change your role.
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && (
              <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✓ Saved</span>
            )}
          </div>
        </form>
      </div>
    </Layout>
  );
}
