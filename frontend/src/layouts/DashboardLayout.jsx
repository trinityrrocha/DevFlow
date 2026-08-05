import { useEffect, useRef, useState } from 'react';
import { Bell, Bug, ClipboardList, Gauge, GitPullRequest, LogOut, Menu, Plus, Settings2, UserCircle, Users, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from '../router';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import NewTaskModal from '../components/NewTaskModal';
import { formatDate } from '../utils/formatters';

export default function DashboardLayout({ children }) {
  const { user, companies, logout, switchCompany } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const notificationRef = useRef(null);

  const refreshNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data);
    } catch {
      // Session interceptor handles authentication failures.
    }
  };

  useEffect(() => {
    if (user.must_change_password || user.mfa_setup_required) return undefined;
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 15000);
    return () => window.clearInterval(timer);
  }, [user.must_change_password, user.mfa_setup_required]);

  useEffect(() => {
    const close = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openNotifications = async () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (!opening) return;
    const unreadIds = notifications.notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (unreadIds.length) {
      await api.post('/notifications/read', { ids: unreadIds }).catch(() => {});
      setNotifications((current) => ({
        unread_count: 0,
        notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
      }));
    }
  };

  const links = [
    { to: '/', label: 'Dashboard', icon: Gauge },
    { to: '/tasks', label: 'Tarefas', icon: GitPullRequest },
    ...(user.permissions?.includes('projects.manage') ? [
      { to: '/settings', label: 'Cadastros', icon: Settings2 }
    ] : []),
    ...(user.permissions?.includes('users.manage') ? [
      { to: '/users', label: 'Equipe', icon: Users },
    ] : []),
    ...(user.permissions?.includes('audit.view') ? [
      { to: '/audit', label: 'Auditoria', icon: ClipboardList }
    ] : []),
    { to: '/profile', label: 'Meu perfil', icon: UserCircle }
  ];

  const isActive = (to) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 text-white md:flex">
        <Brand />
        <nav className="flex-1 space-y-1 px-3 py-5">
          {links.map(({ to, label: text, icon: Icon }) => (
            <Link key={to} to={to} className={`flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors ${
              isActive(to) ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}>
              <Icon className="h-5 w-5" /> {text}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-semibold">{user.name?.[0]}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-xs text-slate-400">{user.is_super_admin ? 'Super Admin' : user.access_level === 'ADMIN' ? 'Administrador' : user.profiles?.[0] || 'Usuário'}</p>
            </div>
          </div>
          <button onClick={doLogout} className="flex w-full items-center gap-3 rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-red-500/10 hover:text-red-400">
            <LogOut className="h-5 w-5" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <button onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-slate-600" aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
            <span className="font-bold text-slate-900">DevFlow</span>
          </div>
          <div className="hidden md:block">
            {companies.length > 1 ? (
              <select
                value={user.company_id}
                onChange={async (event) => {
                  await switchCompany(event.target.value);
                  navigate('/');
                }}
                className="field min-w-56 py-2"
                aria-label="Empresa ativa"
              >
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            ) : <p className="text-sm text-slate-500">{user.company_name || 'Gestão do ciclo de desenvolvimento'}</p>}
          </div>
          <div className="flex items-center gap-2">
            {!user.must_change_password && !user.mfa_setup_required && <div className="relative" ref={notificationRef}>
              <button onClick={openNotifications} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Notificações">
                <Bell className="h-5 w-5" />
                {notifications.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="border-b border-slate-200 px-4 py-3"><p className="text-sm font-semibold">Notificações</p></div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.notifications.length === 0 && <p className="p-5 text-center text-sm text-slate-500">Nenhuma notificação.</p>}
                    {notifications.notifications.map((item) => (
                      <button key={item.id} onClick={() => { setNotificationsOpen(false); if (item.task_id) navigate(`/tasks/${item.task_id}`); }}
                        className="block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
                        <p className="text-sm font-medium text-slate-800">{item.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.body}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.created_at)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>}
            {!user.must_change_password && !user.mfa_setup_required && <button onClick={() => setNewTaskOpen(true)} className="btn-primary">
              <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Nova Tarefa</span>
            </button>}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8">
          {(user.must_change_password || user.mfa_setup_required) && location.pathname !== '/profile' ? (
            <div className="mx-auto max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              Conclua os requisitos de segurança em <Link to="/profile" className="font-semibold underline">Meu perfil</Link> para liberar o sistema.
            </div>
          ) : children}
        </main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900 text-white md:hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-4"><Brand /><button onClick={() => setMobileOpen(false)} className="p-2" aria-label="Fechar menu"><X className="h-5 w-5" /></button></div>
          <nav className="space-y-2 p-4">
            {links.map(({ to, label: text, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-md px-4 py-3 text-slate-200 hover:bg-slate-800"><Icon className="h-5 w-5" />{text}</Link>
            ))}
          </nav>
        </div>
      )}

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={(task) => {
          setNewTaskOpen(false);
          navigate(`/tasks/${task.id}`);
        }}
      />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center px-5">
      <span className="mr-3 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600"><Bug className="h-5 w-5" /></span>
      <div><p className="text-lg font-bold">DevFlow</p><p className="text-[10px] uppercase tracking-widest text-slate-400">Development lifecycle</p></div>
    </div>
  );
}
