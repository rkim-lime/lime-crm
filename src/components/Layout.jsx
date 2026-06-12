import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: '▦' },
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
    label: 'Leads & Contacts',
    items: [
      { to: '/leads',    label: 'Leads',    icon: '◈' },
      { to: '/accounts', label: 'Accounts', icon: '⬜' },
      { to: '/contacts', label: 'Contacts', icon: '◯' },
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
      { to: '/reports/lead-hygiene', label: 'Lead Hygiene', icon: '◍' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/integrations', label: 'Integrations', icon: '⟳' },
      { to: '/settings',     label: 'Settings',     icon: '⚙' },
    ],
  },
];

function Icon({ ch }) {
  return <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center', display: 'inline-block' }}>{ch}</span>;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function Layout({ title, children }) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();

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
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
                >
                  <Icon ch={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
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
        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
