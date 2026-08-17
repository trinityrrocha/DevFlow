const TASK_PRIORITY_HIERARCHY = Object.freeze([
  'URGENT_PRODUCTION',
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW'
]);

function priorityRankSql(priorityAlias = 'p') {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(priorityAlias)) {
    throw new TypeError('Alias SQL de prioridade inválido.');
  }
  return `CASE
    WHEN UPPER(${priorityAlias}.code) IN ('URGENT_PRODUCTION','URGENTE_PRODUCAO') OR UPPER(${priorityAlias}.name) IN ('URGENTE PRODUCAO','URGENTE PRODUÇÃO') THEN 5
    WHEN UPPER(${priorityAlias}.code) IN ('CRITICAL','CRITICA') OR UPPER(${priorityAlias}.name) IN ('CRITICA','CRÍTICA') THEN 4
    WHEN UPPER(${priorityAlias}.code) IN ('HIGH','ALTA') OR UPPER(${priorityAlias}.name)='ALTA' THEN 3
    WHEN UPPER(${priorityAlias}.code) IN ('MEDIUM','MEDIA') OR UPPER(${priorityAlias}.name) IN ('MEDIA','MÉDIA') THEN 2
    WHEN UPPER(${priorityAlias}.code) IN ('LOW','BAIXA') OR UPPER(${priorityAlias}.name)='BAIXA' THEN 1
    ELSE 0 END`;
}

function taskOrderBy(filters = {}) {
  const direction = filters.sort_direction === 'asc' ? 'ASC' : 'DESC';
  const expressions = {
    task: 't.task_number',
    stage: 's.sort_order',
    priority: priorityRankSql('p'),
    created_at: 't.created_at'
  };
  const expression = expressions[filters.sort_by];
  if (expression) return `${expression} ${direction}, ${filters.sort_by === 'task' ? 't.created_at DESC' : 't.task_number DESC'}`;
  return `${priorityRankSql('p')} DESC, t.created_at DESC, t.task_number DESC`;
}

module.exports = { TASK_PRIORITY_HIERARCHY, priorityRankSql, taskOrderBy };
