/* global vi */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const db = require('../src/config/database');
const { calculateGeneral, dashboardDetails, DETAIL_FILTERS } = require('../src/services/dashboardService');

describe('dashboard rastreavel por area tecnica', () => {
  it('contabiliza bugs Backend e Frontend por relacionamento sem N+1', async () => {
    const queries = [];
    const client = {
      query: vi.fn(async (sql) => {
        queries.push(sql);
        if (sql.includes('total_tasks')) return { rows: [{ total_tasks: 4, completed_tasks: 1, active_tasks: 2, paused_tasks: 1, total_bugs: 3, resolved_bugs: 1, pending_bugs: 2, backend_bugs: 2, frontend_bugs: 2 }] };
        if (sql.includes("'priority' AS dimension")) return { rows: [] };
        if (sql.includes('average_completion_seconds')) return { rows: [{ average_completion_seconds: 0 }] };
        return { rows: [] };
      })
    };
    const result = await calculateGeneral(client, 'company');
    expect(result).toMatchObject({ backend_bugs: 2, frontend_bugs: 2 });
    expect(queries).toHaveLength(4);
    expect(queries[0]).toContain("bug_area IN ('BACKEND','BOTH')");
    expect(queries[0]).toContain("bug_area IN ('FRONTEND','BOTH')");
    expect(queries[0]).toContain('parent.deleted_at IS NULL');
    expect(queries.join('\n')).not.toMatch(/for\s*\([^)]*bug/iu);
  });

  it.each([
    ['backend_bugs', "t.bug_area IN ('BACKEND','BOTH')"],
    ['frontend_bugs', "t.bug_area IN ('FRONTEND','BOTH')"]
  ])('detalha %s com tarefa vinculada, responsavel e uma consulta paginada', async (metric, expectedFilter) => {
    const query = vi.spyOn(db, 'query').mockResolvedValueOnce({ rows: [{
      total: 2, task_id: 'parent', task_code: 'DF-000005', record_id: 'bug', record_code: 'DF-000010',
      title: 'Falha', kind: 'BUG', state: 'ACTIVE', side: metric === 'backend_bugs' ? 'BACKEND' : 'FRONTEND',
      assignee_name: metric === 'backend_bugs' ? 'Mario' : 'Maria', related_task_title: 'Tarefa principal'
    }] });
    try {
      const result = await dashboardDetails({ company_id: 'company', is_super_admin: true }, metric, { page: 1, limit: 20 });
      expect(result).toMatchObject({ metric, items: [{ task_id: 'parent', record_id: 'bug', assignee_name: metric === 'backend_bugs' ? 'Mario' : 'Maria' }], pagination: { total: 2, total_pages: 1 } });
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain(expectedFilter);
      expect(query.mock.calls[0][0]).toContain('JOIN tasks parent ON parent.id=t.related_task_id');
      expect(query.mock.calls[0][0]).toContain('COUNT(*) OVER()');
      expect(query.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
    } finally { query.mockRestore(); }
  });

  it('inclui multiplos bugs da mesma tarefa e devolve estado vazio sem consulta adicional', async () => {
    expect(DETAIL_FILTERS.backend_bugs).not.toContain('DISTINCT');
    const query = vi.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });
    try {
      expect(await dashboardDetails({ company_id: 'company', is_super_admin: true }, 'backend_bugs'))
        .toEqual({ metric: 'backend_bugs', items: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } });
      expect(query).toHaveBeenCalledTimes(1);
    } finally { query.mockRestore(); }
  });

  it('mantem autorizacao por dashboard.view e allowlist fechada de indicadores', async () => {
    const routes = readFileSync(resolve(__dirname, '../src/routes/dashboardRoutes.js'), 'utf8');
    expect(routes).toContain("requirePermission('dashboard.view')");
    expect(await dashboardDetails({ company_id: 'company', is_super_admin: true }, 'segredo')).toBeNull();
  });
});
