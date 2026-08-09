/* global afterEach, vi */
const taskController = require('../src/controllers/taskController');
const taskService = require('../src/services/taskService');
const { AppError } = require('../src/utils/errors');

const request = () => ({
  body: { action: 'pause', reason: 'Pausa solicitada para validacao.' },
  params: { id: '00000000-0000-4000-8000-000000000001' },
  requestId: 'request-test'
});

const response = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe('respostas semanticas da mudanca de estado', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retorna 404 JSON quando a tarefa nao existe', async () => {
    vi.spyOn(taskService, 'setTaskState').mockRejectedValue(
      new AppError('TASK_NOT_FOUND', 'Tarefa nao encontrada.', 404)
    );
    const res = response();

    await taskController.stateAction(request(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Tarefa não encontrada' });
  });

  it.each([
    [400, 'Informe um motivo com pelo menos 5 caracteres.'],
    [409, 'Somente tarefas ativas podem ser pausadas.']
  ])('preserva recusa de negocio %s com mensagem clara', async (status, message) => {
    vi.spyOn(taskService, 'setTaskState').mockRejectedValue(
      new AppError('TASK_STATE_RULE', message, status)
    );
    const res = response();

    await taskController.stateAction(request(), res);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });

  it('rejeita payload invalido como 400 sem chamar o servico', async () => {
    const service = vi.spyOn(taskService, 'setTaskState');
    const req = request();
    req.body.reason = 'x';
    const res = response();

    await taskController.stateAction(req, res);

    expect(service).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Dados invalidos para atualizar o estado.'
    }));
  });

  it('responde 500 generico e registra somente diagnostico sanitizado', async () => {
    vi.spyOn(taskService, 'setTaskState').mockRejectedValue(
      Object.assign(new Error('senha-do-banco-nao-pode-vazar'), { code: 'ECONNRESET' })
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();

    await taskController.stateAction(request(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Erro interno ao atualizar estado' });
    expect(log).toHaveBeenCalledWith(
      '[DevFlow task state controller] Falha interna sanitizada.',
      { code: 'ECONNRESET', request_id: 'request-test' }
    );
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('senha-do-banco');
  });
});
