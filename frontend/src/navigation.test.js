import { describe, expect, it } from 'vitest';
import { LEGACY_ROUTES, canAccessNavigationItem, routeIsActive, visibleNavigation } from './navigation';

describe('navegacao superior', () => {
  const user = { permissions: ['clients.view', 'projects.view'] };

  it('preserva redirecionamentos das rotas antigas', () => {
    expect(LEGACY_ROUTES).toEqual(expect.objectContaining({ '/': '/dashboard', '/tasks': '/task', '/users': '/team' }));
  });

  it('filtra itens pelo contrato de permissoes', () => {
    const groups = visibleNavigation(user);
    expect(groups.find((group) => group.label === 'Cadastros').items.map((item) => item.label)).toEqual(['Clientes', 'Projetos']);
    expect(groups.find((group) => group.label === 'Sistema')).toBeUndefined();
  });

  it('permite ao Super Admin acessar itens exclusivos', () => {
    expect(canAccessNavigationItem({ is_super_admin: true }, { superAdmin: true })).toBe(true);
    const items = visibleNavigation({ is_super_admin: true }).find((group) => group.label === 'Sistema').items;
    expect(items).toHaveLength(7);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Servidor SMTP', to: '/settings/server/smtp' }),
      expect.objectContaining({ label: 'Backups', to: '/settings/backups' })
    ]));
  });

  it('identifica rota ativa sem confundir prefixos', () => {
    expect(routeIsActive('/task/123', '/task')).toBe(true);
    expect(routeIsActive('/tasks', '/task')).toBe(false);
    expect(routeIsActive('/clients', '/clients')).toBe(true);
  });
});
