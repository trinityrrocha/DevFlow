export function getTaskCategory(type) {
  return String(type || '').toUpperCase() === 'BUG_REPORT' ? 'BUG' : 'DEV';
}
