/* global afterEach, vi */
const db = require('../src/config/database');
const taskController = require('../src/controllers/taskController');
const taskService = require('../src/services/taskService');
const timingService = require('../src/services/taskTimingService');
const { AppError } = require('../src/utils/errors');

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const TASK_ID = '00000000-0000-4000-8000-000000000002';
const ACTOR_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_ID = '00000000-0000-4000-8000-000000000004';
const STAGE_ID = '00000000-0000-4000-8000-000000000005';

function request(overrides = {}) {
  return {
    body: { action: 'start' },
    params: { id: TASK_ID },
    requestId: 'timer-request-test',
    user: {
      id: ACTOR_ID,
      company_id: COMPANY_ID,
      permissions: ['tasks.operate'],
      profiles: []
    },
    ...overrides
  };
}

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function timerTask(overrides = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    current_stage_id: STAGE_ID,
    stage: 'BACKEND',
    stage_name: 'Backend',
    state: 'ACTIVE',
    tracks_time: true,
    responsibility: 'BACKEND_ASSIGNEE',
    backend_assignee_id: ACTOR_ID,
    frontend_assignee_id: OTHER_ID,
    timer_status: 'not_started',
    timer_started_by: null,
    timer_resumed_by: null,
    timer_last_started_at: null,
    timer_ended_at: null,
    active_elapsed_seconds: 0,
    estimated_duration_seconds: 3600,
    is_overdue: false,
    ...overrides
  };
}

function mockTransaction(task = timerTask(), updateOverrides = {}) {
  const client = {
    query: vi.fn(async (sql) => {
      if (sql.includes('SELECT t.*')) return { rows: task ? [task] : [] };
      if (sql.includes('UPDATE tasks SET timer_status')) {
        return {
          rows: [{
            ...task,
            timer_status: 'running',
            timer_started_by: ACTOR_ID,
            timer_last_started_at: new Date().toISOString(),
            ...updateOverrides
          }]
        };
      }
      return { rows: [], rowCount: 1 };
    })
  };
  vi.spyOn(db, 'transaction').mockImplementation((callback) => callback(client));
  return client;
}

describe('transacao estrutural do cronometro', () => {
  afterEach(() => vi.restoreAllMocks());

  it('inicia com lock, parametros tipados e autoria exclusiva da sessao', async () => {
    const client = mockTransaction();
    const req = request({ body: { action: 'start', user_id: OTHER_ID } });

    const result = await timingService.timerAction(req, TASK_ID, 'start');

    expect(result.timer_status).toBe('running');
    const [selectSql, selectParams] = client.query.mock.calls[0];
    expect(selectSql).toContain('FOR UPDATE OF t');
    expect(selectParams).toEqual([TASK_ID, COMPANY_ID]);

    const [updateSql, updateParams] = client.query.mock.calls[1];
    expect(updateSql).toContain('$3::varchar(20)');
    expect(updateSql).toContain('$6::text');
    expect(updateSql).toContain('$7::uuid');
    expect(updateParams).toEqual([TASK_ID, COMPANY_ID, 'running', 0, false, 'start', ACTOR_ID]);

    const [sessionSql, sessionParams] = client.query.mock.calls[2];
    expect(sessionSql).toContain('task_stage_touch_sessions');
    expect(sessionParams).toEqual([COMPANY_ID, TASK_ID, STAGE_ID, ACTOR_ID]);

    const [eventSql, eventParams] = client.query.mock.calls[3];
    expect(eventSql).toContain('stage_id');
    expect(eventParams[2]).toBe(STAGE_ID);
    expect(eventParams[4]).toBe(ACTOR_ID);
    expect(eventParams).not.toContain(OTHER_ID);
  });

  it('recusa sobreposicao do mesmo usuario antes de atualizar ou inserir evento', async () => {
    const client = mockTransaction(timerTask({
      timer_status: 'running',
      timer_started_by: ACTOR_ID,
      timer_last_started_at: new Date().toISOString()
    }));

    await expect(timingService.timerAction(request(), TASK_ID, 'start')).rejects.toMatchObject({
      code: 'TIMER_ALREADY_RUNNING',
      status: 409,
      message: 'Ja existe um cronometro ativo para esta tarefa.'
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('retorna 404 para tarefa ausente e 403 para usuario nao associado', async () => {
    mockTransaction(null);
    await expect(timingService.timerAction(request(), TASK_ID, 'start')).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
      status: 404
    });
    vi.restoreAllMocks();

    const client = mockTransaction();
    const unauthorized = request({ user: { ...request().user, id: OTHER_ID } });
    await expect(timingService.timerAction(unauthorized, TASK_ID, 'start')).rejects.toMatchObject({
      code: 'TIMER_FORBIDDEN',
      status: 403
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('converte constraints e concorrencia do PostgreSQL em 409', async () => {
    const client = mockTransaction();
    client.query.mockImplementationOnce(async () => ({ rows: [timerTask()] }));
    client.query.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate timer'), { code: '23505' });
    });

    await expect(timingService.timerAction(request(), TASK_ID, 'start')).rejects.toMatchObject({
      code: 'TIMER_CONFLICT',
      status: 409
    });
  });

  it('encerra a sessao de touch time da etapa ao pausar', async () => {
    const client = mockTransaction(timerTask({
      timer_status: 'running',
      timer_started_by: ACTOR_ID,
      timer_last_started_at: new Date().toISOString()
    }), { timer_status: 'paused', timer_last_started_at: null });

    await timingService.timerAction(request({ body: { action: 'pause' } }), TASK_ID, 'pause');

    const closeCall = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE task_stage_touch_sessions'));
    expect(closeCall).toBeTruthy();
    expect(closeCall[1]).toEqual([COMPANY_ID, TASK_ID, STAGE_ID, 'PAUSED']);
  });
});

describe('respostas semanticas do controller do cronometro', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [400, 'Identificador da tarefa invalido.'],
    [403, 'Voce nao pode operar o cronometro desta etapa.'],
    [404, 'Tarefa nao encontrada.'],
    [409, 'Ja existe um cronometro ativo para esta tarefa.']
  ])('preserva erro de negocio %s em JSON', async (status, message) => {
    vi.spyOn(taskService, 'timerAction').mockRejectedValue(new AppError('TIMER_RULE', message, status));
    const res = response();

    await taskController.timerAction(request(), res);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });

  it('rejeita campos de autoria enviados pelo cliente', async () => {
    const service = vi.spyOn(taskService, 'timerAction');
    const res = response();

    await taskController.timerAction(request({ body: { action: 'start', userId: OTHER_ID } }), res);

    expect(service).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Acao de cronometro invalida.' }));
  });

  it('rejeita conclusao manual porque a etapa encerra o tempo', async () => {
    const service = vi.spyOn(taskService, 'timerAction');
    const res = response();

    await taskController.timerAction(request({ body: { action: 'complete' } }), res);

    expect(service).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('registra o erro real e responde 500 generico', async () => {
    const failure = Object.assign(new Error('database details'), { code: '42P08' });
    vi.spyOn(taskService, 'timerAction').mockRejectedValue(failure);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();

    await taskController.timerAction(request(), res);

    expect(errorLog).toHaveBeenCalledWith('[TIMER_ERROR]', failure);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Falha interna ao processar o cronometro.' });
  });
});
