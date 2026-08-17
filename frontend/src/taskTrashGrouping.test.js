import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bug, Code2 } from 'lucide-react';
import { priorityDisplayName } from './utils/formatters';
import { TASK_CATEGORY_ICONS } from './utils/taskPresentation';
import { currentTaskAssignee, getTaskCategory, groupTasks, TASK_GROUP_OPTIONS } from './utils/taskGrouping';

const read = (file) => readFileSync(resolve(import.meta.dirname, file), 'utf8');
const task = (overrides = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  current_stage_id: 'stage', stage: 'BACKEND', stage_name: 'Backend', stage_sort_order: 20,
  stage_responsibility: 'BACKEND_ASSIGNEE', backend_assignee_id: 'backend-user', backend_assignee_name: 'Ana Backend',
  frontend_assignee_id: 'frontend-user', frontend_assignee_name: 'Bruno Frontend',
  priority_id: 'medium', priority: 'MEDIUM', priority_name: 'Média', priority_sort_order: 20,
  task_type_id: 'feature', request_type: 'NEW_FEATURE', task_type_name: 'Nova funcionalidade', task_type_sort_order: 10,
  ...overrides
});

describe('lixeira, categoria e agrupamento de tarefas', () => {
  it('classifica somente Report Bug como Bug e usa icones Lucide centralizados', () => {
    expect(getTaskCategory('BUG_REPORT')).toBe('BUG');
    for (const type of ['BACKEND', 'FRONTEND', 'NEW_FEATURE', 'FIX', 'OTHER', undefined]) expect(getTaskCategory(type)).toBe('DEV');
    expect(TASK_CATEGORY_ICONS.BUG).toBe(Bug);
    expect(TASK_CATEGORY_ICONS.DEV).toBe(Code2);
  });

  it('oferece todos os modos de agrupamento', () => {
    expect(TASK_GROUP_OPTIONS.map(([value]) => value)).toEqual(['', 'stage', 'user', 'priority', 'type']);
  });

  it('agrupa pelo tipo real sem substituir pela categoria Bug/Dev', () => {
    const items = [
      task({ id: 'bug', task_type_id: 'bug-report', request_type: 'BUG_REPORT', task_type_name: 'Report Bug', task_type_sort_order: 100 }),
      task({ id: 'backend', task_type_id: 'backend', request_type: 'BACKEND', task_type_name: 'Backend', task_type_sort_order: 20 }),
      task({ id: 'frontend', task_type_id: 'frontend', request_type: 'FRONTEND', task_type_name: 'Frontend', task_type_sort_order: 30 })
    ];
    expect(groupTasks(items, 'type').map((group) => group.label)).toEqual(['Report Bug', 'Backend', 'Frontend']);
    expect(groupTasks(items, 'type').find((group) => group.label === 'Report Bug').tasks[0].id).toBe('bug');
  });

  it('preserva ordem logica de etapas, sem reordenar itens dentro do grupo', () => {
    const first = task({ id: 'first-backend' });
    const frontend = task({ id: 'frontend', current_stage_id: 'front', stage: 'FRONTEND', stage_name: 'Frontend', stage_sort_order: 30 });
    const second = task({ id: 'second-backend' });
    const groups = groupTasks([first, frontend, second], 'stage');
    expect(groups.map((group) => group.label)).toEqual(['Backend', 'Frontend']);
    expect(groups[0].tasks.map((item) => item.id)).toEqual(['first-backend', 'second-backend']);
  });

  it('agrupa usuario conforme a responsabilidade da etapa e evita duplicatas', () => {
    expect(currentTaskAssignee(task()).label).toBe('Ana Backend');
    expect(currentTaskAssignee(task({ stage_responsibility: 'FRONTEND_ASSIGNEE' })).label).toBe('Bruno Frontend');
    expect(currentTaskAssignee(task({ stage_responsibility: 'MANAGER' })).label).toBe('Não definido');
    expect(groupTasks([task({ id: 'single' })], 'user')[0].tasks).toHaveLength(1);
  });

  it('ordena prioridades semanticamente e exibe Urgente sem alterar o codigo', () => {
    const groups = groupTasks([
      task({ id: 'low', priority_id: 'low', priority: 'LOW', priority_name: 'Baixa' }),
      task({ id: 'urgent', priority_id: 'urgent', priority: 'URGENT_PRODUCTION', priority_name: 'Urgente Produção' }),
      task({ id: 'high', priority_id: 'high', priority: 'HIGH', priority_name: 'Alta' })
    ], 'priority');
    expect(groups.map((group) => group.label)).toEqual(['Urgente', 'Alta', 'Baixa']);
    expect(priorityDisplayName({ code: 'URGENT_PRODUCTION', name: 'Urgente Produção' })).toBe('Urgente');
    expect(priorityDisplayName({ code: 'DF-000008', priority: 'URGENT_PRODUCTION', priority_name: 'Urgente Produção' })).toBe('Urgente');
  });

  it('mantem a paginacao no backend e agrupa somente a pagina ordenada recebida', () => {
    const list = read('pages/Tasks.jsx');
    expect(list).toContain('...filters,');
    expect(list).toContain('lifecycle,');
    expect(list).toContain('page,');
    expect(list).toContain("groupTasks(data.tasks, groupBy || '')");
    expect(list).not.toContain('limit: 100');
  });

  it('implementa confirmacoes fortes, acessibilidade e restricao visual do purge', () => {
    const detail = read('pages/TaskDetail.jsx');
    const trash = read('pages/TaskTrash.jsx');
    const confirmation = read('components/StrongConfirmationModal.jsx');
    expect(detail).toContain('confirmationText={task.code}');
    expect(trash).toContain('confirmationText="ESVAZIAR LIXEIRA"');
    expect(trash).toContain('user.is_super_admin');
    expect(trash).toContain('aria-label={`Restaurar ${task.code}`}');
    expect(confirmation).toContain('aria-modal="true"');
    expect(confirmation).toContain('typed !== confirmationText');
  });
});
