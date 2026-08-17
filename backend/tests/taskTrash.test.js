/* global afterEach, vi */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const taskController = require('../src/controllers/taskController');
const taskService = require('../src/services/taskService');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const response = () => ({ json: vi.fn() });

describe('lixeira auditavel de tarefas', () => {
  afterEach(() => vi.restoreAllMocks());

  const migration = read('../database/migrations/016_task_trash.sql');
  const service = read('src/services/taskService.js');
  const routes = read('src/routes/taskRoutes.js');
  const notifications = read('src/controllers/notificationController.js');
  const dashboard = read('src/services/dashboardService.js');
  const catalogs = read('src/services/catalogService.js');

  it('cria autoria e indice da lixeira sem modificar migrations anteriores', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS deleted_by UUID');
    expect(migration).toContain('tasks_deleted_by_membership_fk');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_trash');
    expect(migration).toContain("current_setting('devflow.task_purge', TRUE) = 'enabled'");
  });

  it('protege exclusao/restauracao por tasks.manage e purge por Super Admin', () => {
    expect(routes).toContain("router.get('/trash', requirePermission('tasks.manage')");
    expect(routes).toContain("router.delete('/:id', requirePermission('tasks.manage')");
    expect(routes).toContain("router.post('/:id/restore', requirePermission('tasks.manage')");
    expect(routes).toContain("router.delete('/trash', requireSuperAdmin");
    expect(service).toContain("req.user?.is_super_admin === true");
  });

  it('exige o codigo da tarefa e preserva o mesmo ID na restauracao', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    vi.spyOn(taskService, 'softDeleteTask').mockResolvedValue({ id, code: 'DF-000008' });
    const deletedResponse = response();
    await taskController.deleteTask({ params: { id }, body: { confirmation: 'DF-000008' } }, deletedResponse);
    expect(taskService.softDeleteTask).toHaveBeenCalledWith(expect.anything(), id, 'DF-000008');
    expect(deletedResponse.json).toHaveBeenCalledWith({ task: { id, code: 'DF-000008' } });

    vi.spyOn(taskService, 'restoreTask').mockResolvedValue({ id, code: 'DF-000008' });
    const restoredResponse = response();
    await taskController.restoreTask({ params: { id } }, restoredResponse);
    expect(restoredResponse.json).toHaveBeenCalledWith({ task: { id, code: 'DF-000008' } });
  });

  it('registra os quatro eventos obrigatorios e mantem soft delete centralizado', () => {
    for (const event of ['task_deleted', 'task_restored', 'task_permanently_deleted', 'task_trash_emptied']) {
      expect(service).toContain(`'${event}'`);
    }
    expect(service).toContain('t.deleted_at IS NULL');
    expect(service).toContain('t.deleted_at IS NOT NULL');
    expect(service).toContain('deleted_at=CURRENT_TIMESTAMP,deleted_by=$3');
    expect(service).toContain('deleted_at=NULL,deleted_by=NULL');
  });

  it('remove dependencias em ordem, desvincula bugs ativos e limpa arquivos por quarentena', () => {
    const attachmentDelete = service.indexOf("'task_attachments'");
    const testDelete = service.indexOf("'task_tests'");
    const commentDelete = service.indexOf("'task_comments'");
    expect(attachmentDelete).toBeGreaterThan(0);
    expect(attachmentDelete).toBeLessThan(testDelete);
    expect(attachmentDelete).toBeLessThan(commentDelete);
    for (const table of ['email_outbox', 'notifications', 'task_stage_touch_sessions', 'task_timer_events', 'task_stage_submissions', 'task_stage_intervals', 'task_approvals', 'task_github_metadata', 'task_events']) {
      expect(service).toContain(table);
    }
    expect(service).toContain('SET related_task_id=NULL');
    expect(service).toContain('taskPurgeStorage.quarantine');
    expect(service).toContain('quarantined?.rollback');
  });

  it('exclui tarefas apagadas de notificacoes, metricas e contadores operacionais', () => {
    expect(notifications).toContain('t.deleted_at IS NULL');
    expect(dashboard).toContain('active_task.deleted_at IS NULL');
    expect(dashboard).toContain('task.deleted_at IS NULL');
    expect(catalogs).toContain('t.deleted_at IS NULL) AS task_count');
    expect(service).toContain('refreshTrashMetrics(req.user.company_id)');
  });

  it('exige a frase forte para esvaziar a lixeira', async () => {
    vi.spyOn(taskService, 'emptyTrash').mockResolvedValue({ permanently_deleted: 3 });
    const res = response();
    await taskController.emptyTrash({ body: { confirmation: 'ESVAZIAR LIXEIRA' } }, res);
    expect(taskService.emptyTrash).toHaveBeenCalledWith(expect.anything(), 'ESVAZIAR LIXEIRA');
    expect(res.json).toHaveBeenCalledWith({ permanently_deleted: 3 });
  });
});
