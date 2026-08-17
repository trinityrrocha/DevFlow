export const REPORT_BUG_TASK_TYPE_CODE = 'BUG_REPORT';

export function getTaskTypeCode(value) {
  if (typeof value === 'string') return value;
  return value?.request_type || value?.task_type_code || value?.type?.code || value?.type || '';
}

export function getTaskCategory(value) {
  const apiCategory = typeof value === 'object' ? String(value?.task_category || '').toUpperCase() : '';
  if (apiCategory === 'BUG' || apiCategory === 'DEV') return apiCategory;
  return String(getTaskTypeCode(value)).trim().toUpperCase() === REPORT_BUG_TASK_TYPE_CODE
    ? 'BUG'
    : 'DEV';
}

export function taskMatchesCategory(task, category) {
  const normalized = String(category || '').trim().toUpperCase();
  return !normalized || getTaskCategory(task) === normalized;
}
