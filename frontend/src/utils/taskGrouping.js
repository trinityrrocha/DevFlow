import { getTaskCategory } from './taskCategory';

export const TASK_GROUP_OPTIONS = Object.freeze([
  ['', 'Nenhum'],
  ['stage', 'Etapa'],
  ['user', 'Usuário'],
  ['priority', 'Prioridade'],
  ['type', 'Tipo de tarefa']
]);

const PRIORITY_ORDER = Object.freeze({
  URGENT_PRODUCTION: 10,
  CRITICAL: 20,
  HIGH: 30,
  MEDIUM: 40,
  LOW: 50
});

export function currentTaskAssignee(task) {
  const responsibility = String(task.stage_responsibility || '').toUpperCase();
  if (responsibility === 'BACKEND_ASSIGNEE') return { key: task.backend_assignee_id, label: task.backend_assignee_name };
  if (responsibility === 'FRONTEND_ASSIGNEE') return { key: task.frontend_assignee_id, label: task.frontend_assignee_name };
  return { key: 'unassigned', label: 'Não definido' };
}

function groupIdentity(task, groupBy) {
  if (groupBy === 'stage') return {
    key: task.current_stage_id || task.stage || 'stage-unassigned',
    label: task.stage_name || 'Não definida',
    order: Number(task.stage_sort_order ?? Number.MAX_SAFE_INTEGER)
  };
  if (groupBy === 'user') {
    const assignee = currentTaskAssignee(task);
    return { key: assignee.key || 'unassigned', label: assignee.label || 'Não definido', order: assignee.label || 'Não definido' };
  }
  if (groupBy === 'priority') return {
    key: task.priority_id || task.priority || 'priority-unassigned',
    label: String(task.priority || '').toUpperCase() === 'URGENT_PRODUCTION' ? 'Urgente' : task.priority_name || 'Não definida',
    order: PRIORITY_ORDER[String(task.priority || '').toUpperCase()] ?? Number(task.priority_sort_order ?? 999)
  };
  if (groupBy === 'type') return {
    key: task.task_type_id || task.request_type || 'type-unassigned',
    label: task.task_type_name || 'Não definido',
    order: null
  };
  return { key: 'all', label: '', order: 0 };
}

export function groupTasks(tasks, groupBy) {
  if (!groupBy) return [{ key: 'all', label: '', tasks: [...tasks], order: 0 }];
  const groups = new Map();
  for (const [index, task] of tasks.entries()) {
    const identity = groupIdentity(task, groupBy);
    const existing = groups.get(identity.key) || { ...identity, firstIndex: index, tasks: [] };
    existing.tasks.push(task);
    groups.set(identity.key, existing);
  }
  return [...groups.values()].sort((left, right) => {
    if (groupBy === 'type') return left.firstIndex - right.firstIndex;
    if (typeof left.order === 'number' && typeof right.order === 'number' && left.order !== right.order) return left.order - right.order;
    return String(left.label).localeCompare(String(right.label), 'pt-BR');
  });
}

export { getTaskCategory };
