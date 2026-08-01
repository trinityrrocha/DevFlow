const {
  getWorkflow,
  transitionDirection,
  missingRequirements,
  canOperateStage
} = require('../src/services/workflowService');

const stages = [
  { id: 'roadmap-id', code: 'ROADMAP', name: 'Roadmap', sort_order: 10, responsibility: 'MANAGER', requirements: {} },
  {
    id: 'backend-id',
    code: 'BACKEND',
    name: 'Backend',
    sort_order: 20,
    responsibility: 'BACKEND_ASSIGNEE',
    requirements: { passing_test: true, submission_fields: ['technical_notes', 'observations'] }
  },
  {
    id: 'github-id',
    code: 'GITHUB_UPDATE',
    name: 'Update GitHub',
    sort_order: 30,
    responsibility: 'MANAGER',
    requirements: { github_fields: ['repository_url', 'branch', 'commit_sha'] }
  },
  {
    id: 'testing-id',
    code: 'TESTING',
    name: 'Testando',
    sort_order: 40,
    responsibility: 'MANAGER',
    requirements: { passing_test: true, test_evidence: true, approval: true }
  },
  { id: 'production-id', code: 'PRODUCTION', name: 'Produção', sort_order: 50, responsibility: 'MANAGER', requirements: {}, completes_task: true }
];

const task = {
  current_stage_id: 'roadmap-id',
  backend_assignee_id: 'backend-user',
  frontend_assignee_id: 'frontend-user'
};

describe('workflowService configurável', () => {
  it('ordena as etapas persistidas sem depender de códigos fixos', () => {
    expect(getWorkflow([...stages].reverse()).map((stage) => stage.code)).toEqual([
      'ROADMAP', 'BACKEND', 'GITHUB_UPDATE', 'TESTING', 'PRODUCTION'
    ]);
  });

  it('aceita somente a próxima etapa como avanço', () => {
    expect(transitionDirection(task, 'backend-id', stages)).toBe('FORWARD');
    expect(transitionDirection(task, 'github-id', stages)).toBe('INVALID');
  });

  it('permite retrocesso para uma etapa anterior conhecida', () => {
    expect(transitionDirection({ ...task, current_stage_id: 'testing-id' }, 'backend-id', stages)).toBe('BACKWARD');
    expect(transitionDirection({ ...task, current_stage_id: 'testing-id' }, 'unknown', stages)).toBe('INVALID');
  });

  it('lista requisitos declarativos ausentes da etapa', () => {
    const missing = missingRequirements(
      { ...task, current_stage_id: 'backend-id' },
      { tests: [], approvals: [], submission: {}, github: {} },
      stages[1]
    );
    expect(missing).toContain('Teste Backend aprovado');
    expect(missing).toContain('Informações técnicas Backend');
    expect(missing).toContain('Observações Backend');
  });

  it('libera etapa com teste e documentação exigidos', () => {
    expect(missingRequirements(
      task,
      {
        tests: [{ stage_id: 'backend-id', result: 'PASSED' }],
        submission: { technical_notes: 'Implementado', observations: 'Sem ressalvas' }
      },
      stages[1]
    )).toEqual([]);
  });

  it('restringe operação pela responsabilidade e permissão', () => {
    const operator = { id: 'backend-user', profiles: [], permissions: ['tasks.operate'] };
    const outsider = { id: 'frontend-user', profiles: [], permissions: ['tasks.operate'] };
    expect(canOperateStage(operator, task, stages[1])).toBe(true);
    expect(canOperateStage(outsider, task, stages[1])).toBe(false);
    expect(canOperateStage({ id: 'manager', profiles: ['MANAGER'], permissions: [] }, task, stages[1])).toBe(true);
  });

  it('exige evidência e aprovação conforme JSON da etapa', () => {
    expect(missingRequirements(task, {
      tests: [{ stage_id: 'testing-id', result: 'PASSED', evidence: '' }],
      approvals: []
    }, stages[3])).toEqual(expect.arrayContaining([
      'Teste aprovado com evidência',
      'Aprovação de Testando'
    ]));
  });

  it('interpreta campos GitHub configurados na etapa', () => {
    expect(missingRequirements(task, { github: {} }, stages[2])).toEqual([
      'Link do repositório', 'Branch', 'Commit'
    ]);
  });
});
