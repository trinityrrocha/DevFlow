export const LEGACY_ROUTES = {
  '/': '/dashboard',
  '/tasks': '/task',
  '/users': '/team',
  '/settings': '/settings/modules/catalogs'
};

export const navigationGroups = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Tarefas', to: '/task' },
  {
    label: 'Cadastros',
    items: [
      { label: 'Equipe', to: '/team', permission: 'users.manage' },
      { label: 'Clientes', to: '/clients', permission: 'clients.view' },
      { label: 'Projetos', to: '/projects', permission: 'projects.view' }
    ]
  },
  {
    label: 'Sistema',
    items: [
      { label: 'Auditoria', to: '/audit', permission: 'audit.view' },
      { label: 'Lixeira de Tarefas', to: '/task/trash', permission: 'tasks.manage' },
      { label: 'Politica de autenticacao multifator', to: '/settings/security/mfa', superAdmin: true },
      { label: 'Catalogos configuraveis', to: '/settings/modules/catalogs', permission: 'catalogs.manage' },
      { label: 'Fluxos configuraveis', to: '/settings/modules/workflows', permission: 'catalogs.manage' },
      { label: 'Servidor SMTP', to: '/settings/server/smtp', superAdmin: true },
      { label: 'Atualizacoes', to: '/settings/updates', superAdmin: true },
      { label: 'Backups', to: '/settings/backups', superAdmin: true }
    ]
  }
];

export function canAccessNavigationItem(user, item) {
  if (item.superAdmin) return user?.is_super_admin === true;
  if (!item.permission) return true;
  return user?.is_super_admin === true || user?.permissions?.includes(item.permission) === true;
}

export function visibleNavigation(user) {
  return navigationGroups.map((group) => {
    if (!group.items) return group;
    return { ...group, items: group.items.filter((item) => canAccessNavigationItem(user, item)) };
  }).filter((group) => !group.items || group.items.length > 0);
}

export function routeIsActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}
