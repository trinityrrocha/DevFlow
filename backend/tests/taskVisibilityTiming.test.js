const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { timingSnapshot, canOperateTimer, MAX_ESTIMATE_SECONDS } = require('../src/services/taskTimingService');

describe('visibilidade Roadmap e cronometros', () => {
  const taskService = readFileSync(resolve(__dirname, '../src/services/taskService.js'), 'utf8');
  const dashboardService = readFileSync(resolve(__dirname, '../src/services/dashboardService.js'), 'utf8');
  const notificationController = readFileSync(resolve(__dirname, '../src/controllers/notificationController.js'), 'utf8');
  const timingService = readFileSync(resolve(__dirname, '../src/services/taskTimingService.js'), 'utf8');

  it('calcula tempo ativo pela soma persistida e timestamp, inclusive apos reinicio', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const snapshot = timingSnapshot({ timer_status: 'running', timer_last_started_at: '2026-08-06T11:30:00Z', active_elapsed_seconds: 3600, estimated_duration_seconds: 10800, started_at: '2026-08-06T08:00:00Z' }, now);
    expect(snapshot.active_elapsed_seconds).toBe(5400);
    expect(snapshot.remaining_seconds).toBe(5400);
    expect(snapshot.elapsed_since_start_seconds).toBe(14400);
  });

  it('mantem regressiva parada durante pausa, mas tempo total continua', () => {
    const snapshot = timingSnapshot({ timer_status: 'paused', active_elapsed_seconds: 7200, estimated_duration_seconds: 10800, started_at: '2026-08-06T08:00:00Z' }, new Date('2026-08-06T12:00:00Z'));
    expect(snapshot.active_elapsed_seconds).toBe(7200);
    expect(snapshot.remaining_seconds).toBe(3600);
    expect(snapshot.elapsed_since_start_seconds).toBe(14400);
  });

  it('marca atraso por tempo ativo e respeita limite de estimativa', () => {
    expect(timingSnapshot({ timer_status: 'paused', active_elapsed_seconds: 3601, estimated_duration_seconds: 3600 }).is_overdue).toBe(true);
    expect(MAX_ESTIMATE_SECONDS).toBe(31536000);
  });

  it('autoriza responsavel da etapa ou administrador a operar o timer', () => {
    const task = { responsibility: 'BACKEND_ASSIGNEE', backend_assignee_id: 'backend', frontend_assignee_id: 'frontend' };
    expect(canOperateTimer({ id: 'backend', permissions: ['tasks.operate'], profiles: [] }, task, task)).toBe(true);
    expect(canOperateTimer({ id: 'outsider', permissions: ['tasks.operate'], profiles: [] }, task, task)).toBe(false);
    expect(canOperateTimer({ id: 'admin', permissions: ['tasks.manage'], profiles: [] }, task, task)).toBe(true);
  });

  it('aplica Roadmap em lista, detalhe, relacionados, dashboard e notificacoes', () => {
    for (const source of [taskService, dashboardService, notificationController]) {
      expect(source).toMatch(/ROADMAP/);
      expect(source).toContain('created_by');
    }
    expect(taskService).toContain("assert(await canViewTask(user, task, queryable), 'TASK_NOT_FOUND'");
    expect(timingService).toContain('FOR UPDATE OF t');
  });
});
