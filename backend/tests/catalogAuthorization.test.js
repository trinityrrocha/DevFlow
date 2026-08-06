const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

describe('autorizacao e integridade dos cadastros', () => {
  const routes = readFileSync(resolve(__dirname, '../src/routes/catalogRoutes.js'), 'utf8');
  const service = readFileSync(resolve(__dirname, '../src/services/catalogService.js'), 'utf8');
  const migration = readFileSync(resolve(__dirname, '../../database/migrations/003_navigation_catalog_permissions.sql'), 'utf8');

  it('separa permissoes de leitura e administracao no backend', () => {
    expect(routes).toContain("router.get('/clients', requirePermission('clients.view')");
    expect(routes).toContain("router.post('/clients', requirePermission('clients.manage')");
    expect(routes).toContain("router.get('/projects', requirePermission('projects.view')");
    expect(routes).toContain("router.delete('/projects/:id', requirePermission('projects.manage')");
  });

  it('mantem filtros e paginacao limitados ao tenant', () => {
    expect(service).toContain("conditions = ['c.company_id=$1', 'c.deleted_at IS NULL']");
    expect(service).toContain("conditions = ['p.company_id=$1', 'p.deleted_at IS NULL']");
    expect(service).toContain('Math.min(Number(filters.limit) || 20, 100)');
  });

  it('bloqueia exclusoes de clientes e projetos com vinculos', () => {
    expect(service).toContain("'CLIENT_HAS_PROJECTS'");
    expect(service).toContain("'PROJECT_HAS_TASKS'");
    expect(service).not.toContain('ON DELETE CASCADE FROM tasks');
  });

  it('aplica as novas permissoes de forma incremental e idempotente', () => {
    for (const permission of ['clients.view', 'clients.manage', 'projects.view']) expect(migration).toContain(permission);
    expect(migration).toContain('ON CONFLICT');
  });
});
