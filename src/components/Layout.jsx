import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { usePendingUsers } from '../hooks/usePendingUsers';

const STATIC_NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: '▦' },
      { to: '/playbook',  label: 'Playbook',  icon: '◉' },
    ],
  },
  {
    label: 'Pipelines',
    items: [
      { to: '/pipeline/enterprise', label: 'Enterprise', icon: '⬡' },
      { to: '/pipeline/pro',        label: 'Pro',         icon: '⬡' },
      { to: '/pipeline/individual', label: 'Individual',  icon: '⬡' },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/leads',    label: 'Leads',    icon: '◈', prefix: true },
      { to: '/contacts', label: 'Contacts', icon: '◯', prefix: true },
      { to: '/accounts', label: 'Accounts', icon: '⬜', prefix: true },
      { to: '/deals',    label: 'Deals',    icon: '◎', prefix: true },
    ],
  },
  {
    label: 'Activity',
    items: [
      { to: '/tasks',     label: 'Tasks',         icon: '✓' },
      { to: '/activity',  label: 'Activity Feed', icon: '⚡' },
      { to: '/documents', label: 'Documents',     icon: '◻' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/analytics',            label: 'Analytics',    icon: '▲' },
      { to: '/reports',              label: 'Reports',      icon: '☰' },
      { to: '/funnel',               label: 'Funnels',      icon: '⬇' },
      { to: '/reports/lead-hygiene', label: 'Lead Hygiene', icon: '◍' },
    ],
  },
];

const BASE_SETTINGS_ITEMS = [
  { to: '/integrations',     label: 'Integrations',   icon: '⟳' },
  { to: '/settings/scoring', label: 'Scoring Config', icon: '◎' },
];

const ADMIN_SETTINGS_ITEMS = [
  { to: '/settings/users',   label: 'Users',          icon: '◉' },
];

function Icon({ ch }) {
  return <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center', display: 'inline-block' }}>{ch}</span>;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function navActive(to, pathname, prefix = false) {
  if (pathname === to) return true;
  return prefix && pathname.startsWith(to + '/');
}

export default function Layout({ title, children }) {
  const { profile, role, signOut } = useAuth();
  const navigate  = useNavigate();
  const { pathname } = useLocation();
  const { count: pendingCount } = usePendingUsers();
  const isAdmin = role === 'admin';

  const [dismissedCount, setDismissedCount] = useState(
    () => parseInt(localStorage.getItem('lime_pending_dismissed') ?? '0', 10)
  );

  const showBanner   = isAdmin && pendingCount > 0 && pendingCount > dismissedCount;
  const settingsItems = isAdmin
    ? [...BASE_SETTINGS_ITEMS, ...ADMIN_SETTINGS_ITEMS]
    : BASE_SETTINGS_ITEMS;

  const handleDismissBanner = () => {
    localStorage.setItem('lime_pending_dismissed', String(pendingCount));
    setDismissedCount(pendingCount);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">L</div>
          <span className="sidebar-logo-text">lime-crm</span>
        </div>

        <nav className="sidebar-nav">
          {/* Static sections */}
          {STATIC_NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map(({ to, label, icon, prefix }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={`sidebar-item${navActive(to, pathname, prefix) ? ' active' : ''}`}
                >
                  <Icon ch={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}

          {/* Settings section (dynamic) */}
          <div>
            <div className="sidebar-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Settings
              {isAdmin && pendingCount > 0 && (
                <span style={{
                  background: 'var(--red)', color: '#fff',
                  borderRadius: 10, fontSize: 10, fontWeight: 700,
                  padding: '1px 5px', lineHeight: '14px',
                }}>
                  {pendingCount}
                </span>
              )}
            </div>
            {settingsItems.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                className={`sidebar-item${navActive(to, pathname) ? ' active' : ''}`}
              >
                <Icon ch={icon} />
                {label}
                {label === 'Users' && isAdmin && pendingCount > 0 && (
                  <span style={{
                    marginLeft: 'auto', background: 'var(--red)', color: '#fff',
                    borderRadius: 10, fontSize: 10, fontWeight: 700,
                    padding: '0px 5px', lineHeight: '16px',
                  }}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials(profile?.full_name ?? profile?.email)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile?.full_name ?? profile?.email ?? '—'}</div>
              <div className="sidebar-user-role">{role ?? '…'}</div>
            </div>
          </div>
          <button className="sidebar-item w-full mt-1" style={{ color: 'var(--red)' }} onClick={handleSignOut}>
            <Icon ch="→" /> Sign out
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
        </header>
        <main className="page-body">
          {/* Pending users banner */}
          {showBanner && (
            <div
              onClick={() => navigate('/settings/users')}
              style={{
                background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6,
                padding: '10px 16px', marginBottom: 20, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 14 }}>⚠</span>
              <span style={{ flex: 1, fontSize: 13, color: '#92400e' }}>
                <strong>{pendingCount} user{pendingCount > 1 ? 's' : ''} pending approval</strong>
                {' — Review in '}
                <u>Settings → Users</u>
              </span>
              <button
                onClick={e => { e.stopPropagation(); handleDismissBanner(); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: '#b45309', padding: '0 2px', lineHeight: 1,
                }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
