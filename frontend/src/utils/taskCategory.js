export const REPORT_BUG_TASK_TYPE_CODE = 'BUG_REPORT';

export function getTaskTypeCode(value) {
  if (typeof value === 'string') return value;
  return value?.request_type || value?.task_type_code || value?.type?.code || value?.type || '';
}

export function getTaskCategory(value) {
  return String(getTaskTypeCode(value)).trim().toUpperCase() === REPORT_BUG_TASK_TYPE_CODE
    ? 'BUG'
    : 'DEV';
}

export function taskMatchesCategory(task, category) {
  const normalized = String(category || '').trim().toUpperCase();
  return !normalized || getTaskCategory(task) === normalized;
}
