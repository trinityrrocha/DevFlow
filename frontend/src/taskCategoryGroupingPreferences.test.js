import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bug, Code2 } from 'lucide-react';
import { getTaskCategory, taskMatchesCategory } from './utils/taskCategory';
import { groupTasks } from './utils/taskGrouping';
import { TASK_CATEGORY_ICONS, TaskCategoryIcon } from './utils/taskPresentation';

const read = (file) => readFileSync(resolve(import.meta.dirname, file), 'utf8');
const task = (code, number, overrides = {}) => ({
  id: `task-${number}`,
  task_number: number,
  request_type: code,
  task_type_id: `type-${code}`,
  task_type_name: code === 'BUG_REPORT' ? 'Report Bug' : code[0] + code.slice(1).toLowerCase(),
  current_stage_id: 'stage-backend',
  stage_name: 'Backend',
  stage_sort_order: 20,
  stage_responsibility: 'BACKEND_ASSIGNEE',
  backend_assignee_id: 'backend-user',
  backend_assignee_name: 'Ana Backend',
  frontend_assignee_id: 'frontend-user',
  frontend_assignee_name: 'Bruno Frontend',
  priority: 'MEDIUM',
  priority_name: 'Média',
  ...overrides
});

describe('regressão real da categoria Bug/Dev', () => {
  it('mantém helper, filtro, badge e Lucide Bug em acordo para Report Bug', () => {
    const reportBug = task('BUG_REPORT', 8);
    expect(getTaskCategory(reportBug)).toBe('BUG');
    expect(taskMatchesCategory(reportBug, 'BUG')).toBe(true);
    expect(taskMatchesCategory(reportBug, 'DEV')).toBe(false);
    expect(TASK_CATEGORY_ICONS[getTaskCategory(reportBug)]).toBe(Bug);
    const badge = TaskCategoryIcon({ task: reportBug });
    expect(badge.props['aria-label']).toBe('Categoria: Bug');
    expect(badge.props.children[0].type).toBe(Bug);
    expect(badge.props.children[1]).toBe('Bug');
  });

  it.each(['BACKEND', 'FRONTEND', 'FIX', 'OTHER'])('%s permanece Dev em filtro, badge e ícone', (code) => {
    const development = task(code, 3);
    expect(getTaskCategory(development)).toBe('DEV');
    expect(taskMatchesCategory(development, 'DEV')).toBe(true);
    expect(taskMatchesCategory(development, 'BUG')).toBe(false);
    expect(TASK_CATEGORY_ICONS[getTaskCategory(development)]).toBe(Code2);
    const badge = TaskCategoryIcon({ task: development });
    expect(badge.props['aria-label']).toBe('Categoria: Dev');
    expect(badge.props.children[0].type).toBe(Code2);
  });
});

describe('agrupamento real e persistente', () => {
  it('cria exatamente Report Bug, Backend e Frontend sem duplicar tarefas', () => {
    const tasks = [
      task('BUG_REPORT', 8), task('BUG_REPORT', 6), task('BUG_REPORT', 7),
      task('BACKEND', 3), task('BACKEND', 4), task('BACKEND', 5),
      task('FRONTEND', 23), task('FRONTEND', 11), task('FRONTEND', 12)
    ];
    const groups = groupTasks(tasks, 'type');
    expect(groups.map(({ label }) => label)).toEqual(['Report Bug', 'Backend', 'Frontend']);
    expect(groups.map(({ tasks: items }) => items.length)).toEqual([3, 3, 3]);
    expect(new Set(groups.flatMap(({ tasks: items }) => items.map(({ id }) => id))).size).toBe(9);
  });

  it('carrega e salva a preferência no backend por usuário/empresa, sem localStorage', () => {
    const source = read('pages/Tasks.jsx');
    expect(source).toContain("api.get('/tasks/preferences')");
    expect(source).toContain("api.patch('/tasks/preferences'");
    expect(source).toContain('[user.id, user.company_id]');
    expect(source).toContain("preference.grouping === 'none' ? '' : preference.grouping");
    expect(source).not.toContain('localStorage');
  });

  it('envia categoria canônica à paginação server-side e exibe label explícito', () => {
    const source = read('pages/Tasks.jsx');
    expect(source).toContain("category: ''");
    expect(source).toContain('filters.category');
    expect(source).toContain('Todas as categorias');
    expect(source).toContain('<span className="mb-1 block">Agrupar por</span>');
    expect(source).toContain("{ ...filters, lifecycle, page }");
    expect(source).not.toContain('limit: 100');
  });
});
