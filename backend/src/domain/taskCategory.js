const REPORT_BUG_TASK_TYPE_CODE = 'BUG_REPORT';

function taskTypeCode(value) {
  if (typeof value === 'string') return value;
  return value?.request_type || value?.task_type_code || value?.type?.code || value?.type || '';
}

function getTaskCategory(value) {
  return String(taskTypeCode(value)).trim().toUpperCase() === REPORT_BUG_TASK_TYPE_CODE
    ? 'BUG'
    : 'DEV';
}

function taskCategorySql(taskTypeAlias = 'tt') {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(taskTypeAlias)) {
    throw new TypeError('Alias SQL de tipo de tarefa inválido.');
  }
  return `CASE WHEN UPPER(${taskTypeAlias}.code)='${REPORT_BUG_TASK_TYPE_CODE}' THEN 'BUG' ELSE 'DEV' END`;
}

module.exports = {
  REPORT_BUG_TASK_TYPE_CODE,
  getTaskCategory,
  taskCategorySql
};
