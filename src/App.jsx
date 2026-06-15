import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth.jsx';
import ProtectedRoute from './components/ProtectedRoute';
import RoleGate      from './components/RoleGate';

import Login         from './pages/Login';
import Dashboard     from './pages/Dashboard';
import Pipeline      from './pages/Pipeline';
import Accounts      from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import Contacts      from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Deals         from './pages/Deals';
import DealDetail    from './pages/DealDetail';
import Leads         from './pages/Leads';
import LeadDetail    from './pages/LeadDetail';
import Funnel        from './pages/Funnel';
import Tasks         from './pages/Tasks';
import Activity      from './pages/Activity';
import Documents     from './pages/Documents';
import Analytics     from './pages/Analytics';
import Reports       from './pages/Reports';
import Integrations  from './pages/Integrations';
import LeadHygiene        from './pages/reports/LeadHygiene';
import OwnershipHygiene   from './pages/reports/OwnershipHygiene';
import ScoringConfig from './pages/settings/ScoringConfig';
import Users         from './pages/settings/Users';
import AcceptInvite  from './pages/AcceptInvite';
import Playbook      from './pages/Playbook';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login"          element={<Login />} />
            <Route path="/accept-invite"  element={<AcceptInvite />} />
            <Route path="/"               element={<Navigate to="/dashboard" replace />} />

            {/* Protected routes */}
            <Route path="/dashboard"        element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/playbook"         element={<ProtectedRoute><Playbook /></ProtectedRoute>} />
            <Route path="/pipeline"         element={<Navigate to="/pipeline/enterprise" replace />} />
            <Route path="/pipeline/:tier"   element={<ProtectedRoute><Pipeline /></ProtectedRoute>} />
            <Route path="/accounts"         element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
            <Route path="/accounts/:id"     element={<ProtectedRoute><AccountDetail /></ProtectedRoute>} />
            <Route path="/contacts"         element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
            <Route path="/contacts/:id"     element={<ProtectedRoute><ContactDetail /></ProtectedRoute>} />
            <Route path="/deals"            element={<ProtectedRoute><Deals /></ProtectedRoute>} />
            <Route path="/deals/:id"        element={<ProtectedRoute><DealDetail /></ProtectedRoute>} />
            <Route path="/leads"            element={<ProtectedRoute><Leads /></ProtectedRoute>} />
            <Route path="/leads/:id"        element={<ProtectedRoute><LeadDetail /></ProtectedRoute>} />
            <Route path="/funnel"           element={<ProtectedRoute><Funnel /></ProtectedRoute>} />
            <Route path="/reports/lead-hygiene" element={<ProtectedRoute><LeadHygiene /></ProtectedRoute>} />
            <Route path="/reports/ownership"    element={<ProtectedRoute><OwnershipHygiene /></ProtectedRoute>} />
            <Route path="/tasks"            element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
            <Route path="/activity"         element={<ProtectedRoute><Activity /></ProtectedRoute>} />
            <Route path="/documents"        element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/analytics"        element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
            <Route path="/reports"          element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/integrations"     element={<ProtectedRoute><Integrations /></ProtectedRoute>} />

            {/* Settings — specific routes must come before the redirect */}
            <Route path="/settings/scoring"
              element={
                <ProtectedRoute>
                  <RoleGate allow={['admin']} fallback={<Navigate to="/dashboard" replace />}>
                    <ScoringConfig />
                  </RoleGate>
                </ProtectedRoute>
              }
            />
            <Route path="/settings/users"
              element={
                <ProtectedRoute>
                  <RoleGate allow={['admin']} fallback={<Navigate to="/dashboard" replace />}>
                    <Users />
                  </RoleGate>
                </ProtectedRoute>
              }
            />
            <Route path="/settings" element={<Navigate to="/settings/users" replace />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
