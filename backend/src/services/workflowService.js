const { hasPermission } = require('./tenantService');

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

function getWorkflow(stages) {
  return [...(stages || [])]
    .filter((stage) => stage.is_active !== false)
    .sort((left, right) => left.sort_order - right.sort_order);
}

function stageMatches(stage, value) {
  return stage.id === value || stage.code === value;
}

function transitionDirection(task, targetStage, stages) {
  const workflow = getWorkflow(stages);
  const currentIndex = workflow.findIndex((stage) => stageMatches(stage, task.current_stage_id || task.stage));
  const targetIndex = workflow.findIndex((stage) => stageMatches(stage, targetStage));
  if (currentIndex < 0 || targetIndex < 0) return 'INVALID';
  if (targetIndex === currentIndex + 1) return 'FORWARD';
  if (targetIndex < currentIndex) return 'BACKWARD';
  return 'INVALID';
}

function missingRequirements(task, context, currentStage) {
  const missing = [];
  const rules = currentStage?.requirements || {};
  const submission = context.submission || {};
  const tests = context.tests || [];
  const approvals = context.approvals || [];
  const github = context.github || {};

  const taskLabels = {
    title: 'Título',
    initial_description: 'Descrição inicial',
    product_affected: 'Produto afetado',
    related_requirement: 'Requisito relacionado',
    initial_evidence: 'Evidências',
    backend_assignee_id: 'Responsável Backend',
    frontend_assignee_id: 'Responsável Frontend'
  };
  for (const field of rules.task_fields || []) {
    if (!task[field] || (typeof task[field] === 'string' && !hasText(task[field]))) {
      missing.push(taskLabels[field] || field);
    }
  }
  const submissionLabels = {
    technical_notes: 'Informações técnicas',
    observations: 'Observações'
  };
  for (const field of rules.submission_fields || []) {
    if (!hasText(submission[field])) missing.push(`${submissionLabels[field] || field} ${currentStage.name}`);
  }
  if (rules.passing_test) {
    const passing = tests.find((test) =>
      test.stage_id === currentStage.id
      && test.result === 'PASSED'
      && (!rules.test_evidence || hasText(test.evidence))
    );
    if (!passing) missing.push(rules.test_evidence ? 'Teste aprovado com evidência' : `Teste ${currentStage.name} aprovado`);
  }
  if (rules.approval) {
    const latest = approvals.find((approval) => approval.stage_id === currentStage.id);
    if (latest?.decision !== 'APPROVED') missing.push(`Aprovação de ${currentStage.name}`);
  }
  const githubLabels = {
    repository_url: 'Link do repositório',
    branch: 'Branch',
    commit_sha: 'Commit',
    pull_request_url: 'Pull Request',
    release: 'Release'
  };
  for (const field of rules.github_fields || []) {
    if (!hasText(github[field])) missing.push(githubLabels[field] || field);
  }
  return missing;
}

function canOperateStage(user, task, stage) {
  if (hasPermission(user, 'tasks.manage') || user.profiles?.includes('MANAGER')) return true;
  if (!hasPermission(user, 'tasks.operate')) return false;
  if (stage.responsibility === 'ANY') return true;
  if (stage.responsibility === 'BACKEND_ASSIGNEE') return user.id === task.backend_assignee_id;
  if (stage.responsibility === 'FRONTEND_ASSIGNEE') return user.id === task.frontend_assignee_id;
  return false;
}

module.exports = { getWorkflow, transitionDirection, missingRequirements, canOperateStage };
