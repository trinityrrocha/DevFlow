import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compactTaskDuration, DEFAULT_TASK_FILTERS, hasActiveTaskFilters,
  paginationWindow, TASK_SORT_DEFAULT_DIRECTIONS, taskCountLabel
} from './utils/taskList';

const source = readFileSync(resolve(import.meta.dirname, 'pages/Tasks.jsx'), 'utf8');

describe('contrato funcional e visual da lista de tarefas', () => {
  it('detecta e limpa somente filtros operacionais ativos', () => {
    expect(hasActiveTaskFilters(DEFAULT_TASK_FILTERS)).toBe(false);
    expect(hasActiveTaskFilters({ ...DEFAULT_TASK_FILTERS, stage: 'BACKEND' })).toBe(true);
    expect(Object.keys(DEFAULT_TASK_FILTERS)).toEqual(['search', 'state', 'category', 'stage', 'priority', 'overdue']);
    expect(source).toContain('setFilters({ ...DEFAULT_TASK_FILTERS })');
    expect(source).toContain('hasActiveTaskFilters(filters)');
    expect(source).toContain('Limpar filtros');
  });

  it('expõe filtro de etapa canônico e preserva filtros combinados na API paginada', () => {
    expect(source).toContain("api.get('/catalogs/stages')");
    expect(source).toContain('filters.stage');
    expect(source).toContain('...filters,');
    expect(source).toContain('lifecycle,');
    expect(source).toContain('page,');
    expect(source).not.toContain('limit: 100');
  });

  it('compacta durações sem substituir cálculos e representa ausência com travessões', () => {
    expect(compactTaskDuration(null)).toBe('—');
    expect(compactTaskDuration(0)).toBe('0min');
    expect(compactTaskDuration(10 * 86400 + 2 * 3600)).toBe('10d 2h');
    expect(compactTaskDuration(9 * 86400 + 21 * 3600 + 12 * 60)).toBe('9d 21h 12min');
    expect(compactTaskDuration(-3600)).toBe('-1h');
    expect(source).toContain('{estimate} / {remaining}');
    expect(source).toContain('title={durationTitle}');
  });

  it('usa linguagem natural e paginação numérica compacta', () => {
    expect(taskCountLabel(1)).toBe('1 tarefa');
    expect(taskCountLabel(8)).toBe('8 tarefas');
    expect(paginationWindow(1, 8)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationWindow(4, 8)).toEqual([2, 3, 4, 5, 6]);
    expect(paginationWindow(8, 8)).toEqual([4, 5, 6, 7, 8]);
    expect(source).not.toContain('tarefa(s)');
    expect(source).toContain('aria-current={pageNumber === page');
  });

  it('envia ordenação permitida ao servidor e exibe direção acessível', () => {
    expect(TASK_SORT_DEFAULT_DIRECTIONS).toEqual({ task: 'desc', stage: 'asc', priority: 'desc', created_at: 'desc' });
    expect(source).toContain('sort_by: sorting.by');
    expect(source).toContain('sort_direction: sorting.direction');
    expect(source).toContain('aria-sort=');
    expect(source).toContain('ArrowUp');
    expect(source).toContain('ArrowDown');
  });

  it('mantém densidade, tema, mobile scroll controlado e descrições acessíveis', () => {
    expect(source).toContain('min-w-[1120px]');
    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('dark:text-slate-300');
    expect(source).toContain('aria-label={`${role}: ${display}`}');
    expect(source).toContain('<TaskTypeIcon code={task.request_type} label={task.task_type_name} />');
    expect(source).toContain('<StatusBadge context="Estado"');
    expect(source).toContain('<StatusBadge context="Prioridade"');
  });
});
