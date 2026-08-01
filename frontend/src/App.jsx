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

function ProtectedRoute({ admin = false, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Carregando sessão segura...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.access_level !== 'ADMIN') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/login') return <Login />;

  let page;
  if (pathname === '/') page = <Dashboard />;
  else if (pathname === '/tasks') page = <Tasks />;
  else if (/^\/tasks\/[^/]+$/.test(pathname)) page = <TaskDetail />;
  else if (pathname === '/profile') page = <Profile />;
  else if (pathname === '/users') page = <ProtectedRoute admin><Users /></ProtectedRoute>;
  else if (pathname === '/audit') page = <ProtectedRoute admin><Audit /></ProtectedRoute>;
  else if (pathname === '/settings') page = <ProtectedRoute admin><Settings /></ProtectedRoute>;
  else page = <Navigate to="/" replace />;

  return (
    <ProtectedRoute>
      <DashboardLayout>{page}</DashboardLayout>
    </ProtectedRoute>
  );
}
