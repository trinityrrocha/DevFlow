export const DEFAULT_TASK_FILTERS = Object.freeze({
  search: '',
  state: '',
  category: '',
  stage: '',
  priority: '',
  overdue: ''
});

export const TASK_SORT_DEFAULT_DIRECTIONS = Object.freeze({
  task: 'desc',
  stage: 'asc',
  priority: 'desc',
  created_at: 'desc'
});

export function hasActiveTaskFilters(filters) {
  return Object.keys(DEFAULT_TASK_FILTERS).some((key) => String(filters?.[key] || '') !== '');
}

export function taskCountLabel(value) {
  const count = Math.max(0, Number(value) || 0);
  return `${count} ${count === 1 ? 'tarefa' : 'tarefas'}`;
}

export function compactTaskDuration(seconds) {
  if (seconds == null) return '—';
  const sign = Number(seconds) < 0 ? '-' : '';
  const total = Math.abs(Math.trunc(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}min` : ''].filter(Boolean);
  return `${sign}${parts.join(' ') || '0min'}`;
}

export function paginationWindow(page, totalPages, size = 5) {
  const total = Math.max(0, Number(totalPages) || 0);
  if (!total) return [];
  const current = Math.min(total, Math.max(1, Number(page) || 1));
  const width = Math.max(1, Math.min(total, size));
  let start = Math.max(1, current - Math.floor(width / 2));
  start = Math.min(start, total - width + 1);
  return Array.from({ length: width }, (_, index) => start + index);
}
