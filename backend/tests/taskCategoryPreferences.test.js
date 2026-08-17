/* global afterEach, vi */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const db = require('../src/config/database');
const taskController = require('../src/controllers/taskController');
const taskService = require('../src/services/taskService');
const {
  REPORT_BUG_TASK_TYPE_CODE,
  getTaskCategory,
  taskCategorySql
} = require('../src/domain/taskCategory');

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
