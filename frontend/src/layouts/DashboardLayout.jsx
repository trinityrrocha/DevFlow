import { useEffect, useRef, useState } from 'react';
import { Bell, Bug, ChevronDown, LogOut, Menu, UserCircle, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from '../router';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { formatDate } from '../utils/formatters';
import { routeIsActive, visibleNavigation } from '../navigation';
import ThemeToggle from '../components/ThemeToggle';

export default function DashboardLayout({ children }) {
  const { user, companies, logout, switchCompany } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0, total: 0, page: 1, limit: 20 });
  const notificationRef = useRef(null);
  const profileRef = useRef(null);
  const navigation = visibleNavigation(user);

  const refreshNotifications = async () => {
    if (window.sessionStorage.getItem('devflow:update-active')) return;
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data);
    } catch {
      // Authentication failures are handled by the API interceptor.
    }
  };

  useEffect(() => {
    if (user.must_change_password || user.mfa_setup_required) return undefined;
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 15000);
    return () => window.clearInterval(timer);
  }, [user.must_change_password, user.mfa_setup_required]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const closeEscape = (event) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setProfileOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, []);

  const openNotifications = async () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    setProfileOpen(false);
    if (opening) await refreshNotifications();
  };

  const markNotification = async (item) => {
    if (!item.read_at) {
      await api.post('/notifications/read', { ids: [item.id] }).catch(() => {});
      setNotifications((current) => ({ ...current, unread_count: Math.max(0, current.unread_count - 1), notifications: current.notifications.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry) }));
    }
    setNotificationsOpen(false);
    if (item.link_path) navigate(item.link_path);
    else if (item.task_id) navigate(`/task/${item.task_id}`);
  };

  const markAllNotifications = async () => {
    await api.post('/notifications/read-all');
    setNotifications((current) => ({ ...current, unread_count: 0, notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })) }));
  };

  const loadMoreNotifications = async () => {
    const nextPage = notifications.page + 1;
    const response = await api.get('/notifications', { params: { page: nextPage, limit: notifications.limit } });
    setNotifications((current) => ({ ...response.data, notifications: [...current.notifications, ...response.data.notifications] }));
  };

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-3 px-4 lg:px-8">
          <button type="button" onClick={() => setMobileOpen((open) => !open)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" aria-label="Alternar menu principal" aria-expanded={mobileOpen} aria-controls="mobile-navigation">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2" aria-label="DevFlow - Dashboard">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white"><Bug className="h-5 w-5" /></span>
            <span className="hidden font-bold text-slate-900 dark:text-slate-100 sm:inline">DevFlow</span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Navegacao principal">
            {navigation.map((group) => group.items
              ? <NavigationDropdown key={group.label} group={group} pathname={pathname} />
              : <TopLink key={group.to} item={group} pathname={pathname} />)}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {!user.must_change_password && !user.mfa_setup_required && <div className="relative" ref={notificationRef}>
              <button type="button" onClick={openNotifications} className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`Notificacoes: ${notifications.unread_count} nao lidas`} aria-expanded={notificationsOpen} aria-controls="notifications-menu">
                <Bell className="h-5 w-5" />
                {notifications.unread_count > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{Math.min(notifications.unread_count, 99)}</span>}
              </button>
              {notificationsOpen && <NotificationMenu id="notifications-menu" data={notifications} onNavigate={markNotification} onMarkAll={markAllNotifications} onLoadMore={loadMoreNotifications} />}
            </div>}

            <div className="relative" ref={profileRef}>
              <button type="button" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }} className="flex items-center gap-2 rounded-md p-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" aria-label="Abrir menu do perfil" aria-haspopup="menu" aria-expanded={profileOpen} aria-controls="profile-menu">
                <UserCircle className="h-6 w-6" /><span className="hidden max-w-32 truncate text-sm font-medium md:inline">{user.name}</span><ChevronDown className="hidden h-4 w-4 md:block" />
              </button>
              {profileOpen && <div id="profile-menu" role="menu" className="absolute right-0 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700"><p className="truncate text-sm font-semibold">{user.name}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p></div>
                {companies.length > 1 && <label className="block px-3 py-2 text-xs font-medium text-slate-600">Empresa ativa<select value={user.company_id} onChange={async (event) => { await switchCompany(event.target.value); navigate('/dashboard'); }} className="field mt-1">{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
                <Link role="menuitem" to="/profile" onClick={() => setProfileOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">Meu perfil</Link>
                <button role="menuitem" type="button" onClick={doLogout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-700 hover:bg-red-50"><LogOut className="h-4 w-4" />Sair</button>
              </div>}
            </div>
          </div>
        </div>

        {mobileOpen && <nav id="mobile-navigation" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 lg:hidden" aria-label="Navegacao principal movel">
          {navigation.map((group) => group.items
            ? <div key={group.label} className="mb-3"><p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>{group.items.map((item) => <TopLink key={item.to} item={item} pathname={pathname} onClick={() => setMobileOpen(false)} mobile />)}</div>
            : <TopLink key={group.to} item={group} pathname={pathname} onClick={() => setMobileOpen(false)} mobile />)}
        </nav>}
      </header>

      <main className="mx-auto max-w-screen-2xl p-4 md:p-8">
        {(user.must_change_password || user.mfa_setup_required) && pathname !== '/profile' ? (
          <div className="mx-auto max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
            Conclua os requisitos de seguranca em <Link to="/profile" className="font-semibold underline">Meu perfil</Link> para liberar o sistema.
          </div>
        ) : children}
      </main>
    </div>
  );
}

function TopLink({ item, pathname, onClick, mobile = false }) {
  const active = routeIsActive(pathname, item.to);
  return <Link to={item.to} onClick={onClick} aria-current={active ? 'page' : undefined} className={`${mobile ? 'mb-1 block' : ''} rounded-md px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}>{item.label}</Link>;
}

function NavigationDropdown({ group, pathname }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = `navigation-${group.label.toLowerCase()}`;
  const active = group.items.some((item) => routeIsActive(pathname, item.to));

  useEffect(() => {
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const moveFocus = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...ref.current.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items.at(-1)?.focus();
    else if (event.key === 'ArrowDown') items[(current + 1 + items.length) % items.length]?.focus();
    else items[(current - 1 + items.length) % items.length]?.focus();
  };

  return <div className="relative" ref={ref} onKeyDown={moveFocus}>
    <button type="button" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => ref.current?.querySelector('[role="menuitem"]')?.focus()); } }} className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}>{group.label}<ChevronDown className="h-4 w-4" /></button>
    {open && <div id={menuId} role="menu" className="absolute left-0 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">{group.items.map((item) => <Link key={item.to} role="menuitem" tabIndex="-1" to={item.to} onClick={() => setOpen(false)} className={`block rounded-md px-3 py-2 text-sm ${routeIsActive(pathname, item.to) ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>{item.label}</Link>)}</div>}
  </div>;
}

function NotificationMenu({ id, data, onNavigate, onMarkAll, onLoadMore }) {
  return <div id={id} className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-sm font-semibold">Notificacoes</p>{data.unread_count > 0 && <button type="button" onClick={onMarkAll} className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Marcar todas como lidas</button>}</div>
    <div className="max-h-96 overflow-y-auto">
      {data.notifications.length === 0 && <p className="p-5 text-center text-sm text-slate-500">Nenhuma notificacao.</p>}
      {data.notifications.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item)} className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${item.read_at ? '' : 'bg-indigo-50/60 dark:bg-indigo-950/40'}`}><div className="flex items-start gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read_at ? 'bg-slate-200 dark:bg-slate-600' : 'bg-indigo-600 dark:bg-indigo-400'}`} /><div><p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-300">{item.body}</p><p className="mt-1 text-[11px] text-slate-400">{item.notification_type} · {formatDate(item.created_at)}</p></div></div></button>)}
      {data.notifications.length < data.total && <button type="button" onClick={onLoadMore} className="w-full px-4 py-3 text-sm font-medium text-indigo-600 hover:bg-slate-50">Carregar mais</button>}
    </div>
  </div>;
}
