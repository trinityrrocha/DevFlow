/* global afterEach, vi */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const db = require('../src/config/database');
const taskController = require('../src/controllers/taskController');
const taskService = require('../src/services/taskService');
const catalogService = require('../src/services/catalogService');
const {
  REPORT_BUG_TASK_TYPE_CODE,
  getTaskCategory,
  taskCategorySql
} = require('../src/domain/taskCategory');
const { TASK_PRIORITY_HIERARCHY, taskOrderBy } = require('../src/domain/taskPriority');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const user = (id) => ({ id, company_id: '00000000-0000-4000-8000-000000000001', is_super_admin: true });
const response = () => ({ json: vi.fn() });

describe('categoria canônica e preferência da lista de tarefas', () => {
  afterEach(() => vi.restoreAllMocks());

  it('classifica exclusivamente o tipo real BUG_REPORT como Bug', () => {
    expect(REPORT_BUG_TASK_TYPE_CODE).toBe('BUG_REPORT');
    expect(getTaskCategory('BUG_REPORT')).toBe('BUG');
    expect(getTaskCategory({ request_type: 'bug_report' })).toBe('BUG');
    for (const code of ['BACKEND', 'FRONTEND', 'FIX', 'OTHER', 'REPORT_BUG', undefined]) {
      expect(getTaskCategory(code)).toBe('DEV');
    }
    expect(taskCategorySql('tt')).toContain("UPPER(tt.code)='BUG_REPORT'");
    expect(getTaskCategory({ request_type: 'BACKEND', title: 'Bug 404 no cadastro' })).toBe('DEV');
  });

  it('filtra Bug e Dev pela mesma expressão do tipo real, não por tasks.kind', async () => {
    const queries = [];
    vi.spyOn(db, 'query').mockImplementation(async (sql, values) => {
      queries.push({ sql, values });
      if (String(sql).includes('SELECT COUNT(*)')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    });

    await taskService.listTasks(user('00000000-0000-4000-8000-000000000010'), { category: 'BUG' });

    expect(queries).toHaveLength(2);
    expect(queries.every(({ sql }) => sql.includes("CASE WHEN UPPER(tt.code)='BUG_REPORT' THEN 'BUG' ELSE 'DEV' END"))).toBe(true);
    expect(queries.every(({ sql }) => !sql.includes('t.kind=$'))).toBe(true);
    expect(queries[0].values).toContain('BUG');
  });

  it('expõe a categoria canônica na API e valida o filtro no controller', async () => {
    vi.spyOn(taskService, 'listTasks').mockResolvedValue({ tasks: [], pagination: {} });
    const res = response();
    const req = { user: user('00000000-0000-4000-8000-000000000010'), query: { category: 'BUG' } };
    await taskController.listTasks(req, res);
    expect(taskService.listTasks).toHaveBeenCalledWith(req.user, expect.objectContaining({ category: 'BUG' }));
    expect(res.json).toHaveBeenCalled();
  });

  it('combina etapa, categoria, prioridade, ciclo, paginação e ordenação no servidor', async () => {
    const queries = [];
    vi.spyOn(db, 'query').mockImplementation(async (sql, values) => {
      queries.push({ sql: String(sql), values });
      if (String(sql).includes('SELECT COUNT(*)')) return { rows: [{ total: 38 }] };
      return { rows: [] };
    });

    const result = await taskService.listTasks(user('00000000-0000-4000-8000-000000000010'), {
      lifecycle: 'open', state: 'ACTIVE', stage: 'BACKEND', category: 'DEV',
      priority: '00000000-0000-4000-8000-000000000099', overdue: 'false',
      search: 'DF-8', sort_by: 'stage', sort_direction: 'asc', page: 2, limit: 10
    });

    expect(queries[0].sql).toContain('t.deleted_at IS NULL');
    expect(queries[0].sql).toContain("t.state IN ('ACTIVE','PAUSED')");
    expect(queries[0].sql).toContain('(s.id::text=');
    expect(queries[0].sql).toContain("CASE WHEN UPPER(tt.code)='BUG_REPORT' THEN 'BUG' ELSE 'DEV' END");
    expect(queries[1].sql).toContain('ORDER BY s.sort_order ASC, t.task_number DESC');
    expect(queries[1].values.slice(-2)).toEqual([10, 10]);
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 38, total_pages: 4 });
  });

  it('usa a hierarquia canônica e somente expressões permitidas na ordenação', () => {
    expect(TASK_PRIORITY_HIERARCHY).toEqual(['URGENT_PRODUCTION', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    expect(taskOrderBy({ sort_by: 'task', sort_direction: 'asc' })).toBe('t.task_number ASC, t.created_at DESC');
    expect(taskOrderBy({ sort_by: 'created_at', sort_direction: 'desc' })).toBe('t.created_at DESC, t.task_number DESC');
    expect(taskOrderBy({ sort_by: 'invalid', sort_direction: 'asc' })).toContain('URGENT_PRODUCTION');
    expect(taskOrderBy({ sort_by: 'invalid', sort_direction: 'asc' })).not.toContain('invalid');
  });

  it('deriva as etapas ativas do domínio multi-tenant', async () => {
    vi.spyOn(db, 'query').mockResolvedValue({ rows: [{ code: 'BACKEND', name: 'Backend', sort_order: 20 }] });
    await expect(catalogService.listStages('00000000-0000-4000-8000-000000000001')).resolves.toEqual([
      { code: 'BACKEND', name: 'Backend', sort_order: 20 }
    ]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM workflow_stages'), ['00000000-0000-4000-8000-000000000001']);
  });

  it('persiste a escolha separadamente por empresa e usuário', async () => {
    const preferences = new Map([
      ['00000000-0000-4000-8000-000000000010', 'stage'],
      ['00000000-0000-4000-8000-000000000020', 'type']
    ]);
    vi.spyOn(db, 'query').mockImplementation(async (sql, values) => {
      if (String(sql).includes('SELECT grouping')) {
        const grouping = preferences.get(values[1]);
        return { rows: grouping ? [{ grouping }] : [] };
      }
      preferences.set(values[1], values[2]);
      return { rows: [{ grouping: values[2] }] };
    });
    const mario = user('00000000-0000-4000-8000-000000000010');
    const maria = user('00000000-0000-4000-8000-000000000020');

    expect(await taskService.getListPreference(mario)).toEqual({ grouping: 'stage' });
    expect(await taskService.getListPreference(maria)).toEqual({ grouping: 'type' });
    await taskService.saveListPreference(mario, 'priority');
    expect(await taskService.getListPreference(mario)).toEqual({ grouping: 'priority' });
    expect(await taskService.getListPreference(maria)).toEqual({ grouping: 'type' });
  });

  it('usa migration incremental vinculada à membership e rotas autenticadas', () => {
    const migration = read('../database/migrations/017_task_list_preferences.sql');
    const routes = read('src/routes/taskRoutes.js');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS user_task_list_preferences');
    expect(migration).toContain('PRIMARY KEY (company_id, user_id)');
    expect(migration).toContain('REFERENCES company_memberships(company_id, user_id)');
    expect(migration).toContain("CHECK (grouping IN ('none', 'stage', 'user', 'priority', 'type'))");
    expect(migration).toContain("WHERE code = 'BUG_REPORT'");
    expect(routes).toContain("router.get('/preferences', requirePermission('tasks.view')");
    expect(routes).toContain("router.patch('/preferences', requirePermission('tasks.view')");
  });
});
