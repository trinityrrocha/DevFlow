import { Navigate, useLocation } from './router';
import { useAuth } from './context/AuthContext';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import Users from './pages/Users';
import Profile from './pages/Profile';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import Clients from './pages/Clients';
import Projects from './pages/Projects';
import { LEGACY_ROUTES } from './navigation';

function ProtectedRoute({ permission, superAdmin = false, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Carregando sessão segura...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (superAdmin && !user.is_super_admin) return <Navigate to="/dashboard" replace />;
  if (permission && !user.is_super_admin && !user.permissions?.includes(permission)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/login') return <Login />;

  let page;
  if (LEGACY_ROUTES[pathname]) page = <Navigate to={LEGACY_ROUTES[pathname]} replace />;
  else if (/^\/tasks\/[^/]+$/.test(pathname)) page = <Navigate to={pathname.replace('/tasks/', '/task/')} replace />;
  else if (pathname === '/dashboard') page = <Dashboard />;
  else if (pathname === '/task') page = <Tasks />;
  else if (/^\/task\/[^/]+$/.test(pathname)) page = <TaskDetail />;
  else if (pathname === '/profile') page = <Profile />;
  else if (pathname === '/team') page = <ProtectedRoute permission="users.manage"><Users /></ProtectedRoute>;
  else if (pathname === '/clients') page = <ProtectedRoute permission="clients.view"><Clients /></ProtectedRoute>;
  else if (pathname === '/projects') page = <ProtectedRoute permission="projects.view"><Projects /></ProtectedRoute>;
  else if (pathname === '/audit') page = <ProtectedRoute permission="audit.view"><Audit /></ProtectedRoute>;
  else if (pathname === '/settings/security/mfa') page = <ProtectedRoute superAdmin><Settings section="mfa" /></ProtectedRoute>;
  else if (pathname === '/settings/modules/catalogs') page = <ProtectedRoute permission="catalogs.manage"><Settings section="catalogs" /></ProtectedRoute>;
  else if (pathname === '/settings/modules/workflows') page = <ProtectedRoute permission="catalogs.manage"><Settings section="workflows" /></ProtectedRoute>;
  else if (pathname === '/settings/server/smtp') page = <ProtectedRoute superAdmin><Settings section="smtp" /></ProtectedRoute>;
  else if (pathname === '/settings/updates') page = <ProtectedRoute superAdmin><Settings section="updates" /></ProtectedRoute>;
  else page = <Navigate to="/dashboard" replace />;

  return (
    <ProtectedRoute>
      <DashboardLayout>{page}</DashboardLayout>
    </ProtectedRoute>
  );
}
