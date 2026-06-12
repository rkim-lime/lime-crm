import { useAuth } from '../hooks/useAuth.jsx';

const ROLE_RANK = { admin: 99, partner: 10, sales: 50, operations: 40, compliance: 30, analyst: 20 };

// allow: array of roles that can see children, e.g. allow={['admin','sales']}
// minRole: not used — prefer explicit allow list for clarity
export default function RoleGate({ allow, children, fallback = null }) {
  const { role } = useAuth();
  if (!role) return fallback;
  if (allow && !allow.includes(role)) return fallback;
  return children;
}

export function useCanEdit() {
  const { role } = useAuth();
  return ['admin', 'sales', 'operations'].includes(role);
}

export function useCanSeeCompliance() {
  const { role } = useAuth();
  return ['admin', 'compliance', 'operations'].includes(role);
}

export function useIsAdmin() {
  const { role } = useAuth();
  return role === 'admin';
}
