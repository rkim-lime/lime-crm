import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function ProtectedRoute({ children }) {
  const { session } = useAuth();

  // Still loading
  if (session === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-tertiary)', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return children;
}
