import { useAuth } from '../hooks/useAuth';

export default function PendingApproval() {
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    window.location.replace('/login');
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-primary)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 440, textAlign: 'center',
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

        {/* Lock icon */}
        <div style={{ fontSize: 52, marginBottom: 18, lineHeight: 1 }}>🔒</div>

        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Access Pending Approval
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 10 }}>
          Your account has been created but requires administrator approval before you can access the CRM.
        </p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
          Please contact your administrator or reply to your invitation email.
        </p>

        {profile?.email && (
          <div style={{
            padding: '10px 16px', background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)', borderRadius: 6,
            fontSize: 13, color: 'var(--text-primary)',
            marginBottom: 24, fontFamily: 'var(--mono)',
          }}>
            {profile.email}
          </div>
        )}

        <button
          onClick={handleSignOut}
          style={{
            width: '100%', padding: '10px 0',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, cursor: 'pointer',
            fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500,
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
