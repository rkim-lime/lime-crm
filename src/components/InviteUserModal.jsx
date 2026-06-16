import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateInvitation } from '../hooks/useUsers';
import { supabase } from '../lib/supabase';

const ROLES = [
  { value: 'admin',      label: 'Admin',      desc: 'Full access, user management' },
  { value: 'partner',    label: 'Partner',    desc: 'Read-only access to all areas' },
  { value: 'sales',      label: 'Sales',      desc: 'Own accounts/contacts/deals, read-only on others' },
  { value: 'operations', label: 'Operations', desc: 'Account/contact editing, onboarding workflows' },
  { value: 'compliance', label: 'Compliance', desc: 'Read-only + KYC/AML fields' },
  { value: 'analyst',    label: 'Analyst',    desc: 'Read-only, no retail PII' },
];

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function InviteUserModal({ onClose }) {
  const [step,      setStep]     = useState(1);
  const [email,     setEmail]    = useState('');
  const [role,      setRole]     = useState('analyst');
  const [notes,     setNotes]    = useState('');
  const [emailErr,  setEmailErr] = useState('');
  const [invitation, setInvitation] = useState(null);
  const [copied,    setCopied]   = useState(false);

  const createInvitation = useCreateInvitation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) { setEmailErr('Enter a valid email address.'); return; }
    setEmailErr('');
    try {
      const data = await createInvitation.mutateAsync({ email, role, notes });
      // Auto-send magic link so invitee receives email immediately
      await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/accept-invite?token=${data.token}`,
        },
      });
      setInvitation(data);
      setStep(2);
    } catch (err) {
      setEmailErr(err.message);
    }
  };

  const inviteLink = invitation
    ? `${window.location.origin}/accept-invite?token=${invitation.token}`
    : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const roleDesc = ROLES.find(r => r.value === role)?.desc ?? '';

  return createPortal(
    <div className="modal-overlay" onClick={step === 1 ? onClose : undefined}>
      <div
        className="modal-dialog"
        style={{ width: 480, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">{step === 1 ? 'Invite User' : 'Invite Created'}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {step === 1 ? (
            <form onSubmit={handleSubmit}>
              {/* Email */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                  Email address *
                </label>
                <input
                  type="email" required autoFocus
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailErr(''); }}
                  placeholder="colleague@company.com"
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                {emailErr && (
                  <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{emailErr}</div>
                )}
              </div>

              {/* Role */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                  Role
                </label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {roleDesc && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{roleDesc}</div>
                )}
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Internal note about this person…"
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
                Invite expires in 7 days.
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={createInvitation.isPending}>
                  {createInvitation.isPending ? 'Creating…' : 'Create Invite'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>✉</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  Invitation sent!
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <strong>{invitation.email}</strong> will receive a login link via email.
                </div>
              </div>

              <details style={{ marginBottom: 20 }}>
                <summary style={{ fontSize: 12, color: 'var(--text-tertiary)', cursor: 'pointer', marginBottom: 8 }}>
                  Or copy this link
                </summary>
                <div style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '10px 12px', marginTop: 8,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Invite link
                  </div>
                  <div style={{
                    fontSize: 12, color: 'var(--text-primary)',
                    wordBreak: 'break-all', fontFamily: 'var(--mono)',
                  }}>
                    {inviteLink}
                  </div>
                </div>
              </details>

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={onClose}>Done</button>
                <button className="btn btn-primary" onClick={handleCopy}>
                  {copied ? '✓ Copied!' : 'Copy Link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
