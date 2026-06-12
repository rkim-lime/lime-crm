import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import PendingApproval from '../pages/PendingApproval';

export default function ProtectedRoute({ children }) {
  const { session, isPending, profileLoading } = useAuth();

  // Still loading session or profile
  if (session === undefined || profileLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', color: 'var(--text-tertiary)', fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Pending users see a holding page instead of any CRM content
  if (isPending) return <PendingApproval />;

  return children;
}
