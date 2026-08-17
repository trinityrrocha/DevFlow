const path = require('path');
const fs = require('fs/promises');
const { z, ZodError } = require('zod');
const taskService = require('../services/taskService');
const attachmentService = require('../services/attachmentService');
const { recordAudit } = require('../services/auditService');
const { createGithubCardSchema, updateGithubCardSchema } = require('../validation/githubCard');
const { AppError } = require('../utils/errors');

const taskSchema = z.object({
  kind: z.enum(['REQUEST', 'BUG']),
  project_id: z.string().uuid(),
  task_type_id: z.string().uuid(),
  priority_id: z.string().uuid(),
  environment_id: z.string().uuid(),
  workflow_id: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(240),
  initial_description: z.string().trim().min(10).max(50000),
  requester_id: z.string().uuid(),
  client_environment: z.string().trim().max(240).nullable().optional(),
  product_affected: z.string().trim().max(240).nullable().optional(),
  related_requirement: z.string().trim().max(10000).nullable().optional(),
  related_task_id: z.string().uuid().nullable().optional(),
  bug_area: z.enum(['BACKEND', 'FRONTEND', 'BOTH']).nullable().optional(),
  initial_evidence: z.string().trim().max(50000).nullable().optional(),
  backend_assignee_id: z.string().uuid(),
  frontend_assignee_id: z.string().uuid(),
  estimated_duration_seconds: z.number().int().min(60).max(31536000).nullable().optional()
}).superRefine((value, context) => {
  if (value.kind === 'BUG') {
    for (const field of ['product_affected', 'related_requirement', 'bug_area', 'initial_evidence']) {
      if (!value[field]) context.addIssue({ code: 'custom', path: [field], message: 'Campo obrigatório para Bug.' });
    }
  }
});

const taskTestSchema = z.object({
  status: z.enum(['APPROVED', 'NOT_APPROVED']),
  environment: z.enum(['local', 'local_nuvem']),
  context: z.string().trim().min(3).max(50000),
  validated_profiles: z.string().trim().min(1).max(4000),
  backend_info: z.string().trim().max(10000).default(''),
  frontend_info: z.string().trim().max(10000).default(''),
  testing_notes: z.string().trim().max(50000).default('')
}).strict();

async function createTask(req, res) {
  const task = await taskService.createTask(req, taskSchema.parse(req.body));
  await recordAudit({ req, operation: 'TASK_CREATED', entityType: 'TASK', entityId: task.id, newValues: task });
  res.status(201).json({ task });
}

async function listTasks(req, res) {
  const filters = z.object({
    state: z.enum(['ACTIVE', 'PAUSED', 'CANCELED', 'COMPLETED']).optional(),
    lifecycle: z.enum(['open', 'completed']).optional(),
    stage: z.string().max(64).optional(),
    category: z.enum(['BUG', 'DEV']).optional(),
    priority: z.string().max(64).optional(),
    project_id: z.string().uuid().optional(),
    assignee: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    overdue: z.enum(['true', 'false']).optional(),
    sort_by: z.enum(['task', 'stage', 'priority', 'created_at']).optional(),
    sort_direction: z.enum(['asc', 'desc']).optional()
  }).parse(req.query);
  res.json(await taskService.listTasks(req.user, filters));
}

async function getListPreference(req, res) {
  res.json(await taskService.getListPreference(req.user));
}

async function saveListPreference(req, res) {
  const { grouping } = z.object({
    grouping: z.enum(['none', 'stage', 'user', 'priority', 'type'])
  }).strict().parse(req.body);
  res.json(await taskService.saveListPreference(req.user, grouping));
}

async function listTrash(req, res) {
  const filters = z.object({
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
  }).parse(req.query);
  res.json(await taskService.listTrash(req.user, filters));
}

async function deleteTask(req, res) {
  const { confirmation } = z.object({ confirmation: z.string().trim().min(1).max(32) }).parse(req.body);
  const task = await taskService.softDeleteTask(req, req.params.id, confirmation);
  res.json({ task });
}

async function restoreTask(req, res) {
  const task = await taskService.restoreTask(req, req.params.id);
  res.json({ task });
}

async function emptyTrash(req, res) {
  const { confirmation } = z.object({ confirmation: z.literal('ESVAZIAR LIXEIRA') }).parse(req.body);
  const result = await taskService.emptyTrash(req, confirmation);
  res.json(result);
}

async function detail(req, res) {
  const result = await taskService.getTaskDetail(req.params.id, req.user);
  if (taskService.isRoadmap(result.task)) await recordAudit({ req, operation: 'TASK_ROADMAP_VIEWED', entityType: 'TASK', entityId: result.task.id });
  res.json(result);
}

async function transition(req, res) {
  const payload = z.object({ target_stage: z.string().min(1).max(64), reason: z.string().max(2000).optional() }).parse(req.body);
  const task = await taskService.transitionTask(req, req.params.id, payload.target_stage, payload.reason);
  await recordAudit({ req, operation: 'TASK_TRANSITIONED', entityType: 'TASK', entityId: task.id, newValues: { stage: task.stage, state: task.state } });
  res.json({ task });
}

async function stateAction(req, res) {
  try {
    const payload = z.object({ action: z.enum(['pause', 'reopen', 'cancel']), reason: z.string().trim().min(5).max(2000) }).parse(req.body);
    const task = await taskService.setTaskState(req, req.params.id, payload.action, payload.reason);
    await recordAudit({ req, operation: `TASK_${payload.action.toUpperCase()}`, entityType: 'TASK', entityId: task.id, newValues: { state: task.state } });
    return res.json({ task });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Dados invalidos para atualizar o estado.',
        details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
      });
    }
    if (error instanceof AppError && error.status === 404) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
    if (error instanceof AppError && [400, 403, 409].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[DevFlow task state controller] Falha interna sanitizada.', {
      code: String(error?.code || 'UNKNOWN').slice(0, 40),
      request_id: req.requestId || null
    });
    return res.status(500).json({ error: 'Erro interno ao atualizar estado' });
  }
}

async function updateAdministration(req, res) {
  const payload = z.object({
    priority_id: z.string().uuid().optional(),
    backend_assignee_id: z.string().uuid().optional(),
    frontend_assignee_id: z.string().uuid().optional(),
    estimated_duration_seconds: z.number().int().min(60).max(31536000).optional()
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const task = await taskService.updateAdministration(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_ADMIN_UPDATED', entityType: 'TASK', entityId: task.id, newValues: payload });
  if (task.became_overdue) await recordAudit({ req, operation: 'TASK_OVERDUE', entityType: 'TASK', entityId: task.id, newValues: { estimated_duration_seconds: task.estimated_duration_seconds } });
  res.json({ task });
}

async function timerAction(req, res) {
  try {
    const { action } = z.object({
      action: z.enum(['start', 'pause', 'resume'])
    }).strict().parse(req.body);
    const task = await taskService.timerAction(req, req.params.id, action);
    await recordAudit({ req, operation: `TASK_TIMER_${action.toUpperCase()}`, entityType: 'TASK', entityId: task.id, newValues: { timer_status: task.timer_status, active_elapsed_seconds: task.active_elapsed_seconds, is_overdue: task.is_overdue } });
    if (task.became_overdue) await recordAudit({ req, operation: 'TASK_OVERDUE', entityType: 'TASK', entityId: task.id, newValues: { active_elapsed_seconds: task.active_elapsed_seconds, estimated_duration_seconds: task.estimated_duration_seconds } });
    return res.json({ task });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Acao de cronometro invalida.',
        details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
      });
    }
    if (error instanceof AppError && [400, 401, 403, 404, 409].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[TIMER_ERROR]', error);
    return res.status(500).json({ error: 'Falha interna ao processar o cronometro.' });
  }
}

async function saveSubmission(req, res) {
  const payload = z.object({
    technical_notes: z.string().max(50000).optional(),
    observations: z.string().max(50000).optional()
  }).parse(req.body);
  const submission = await taskService.saveSubmission(req, req.params.id, payload);
  await recordAudit({ req, operation: 'STAGE_SUBMISSION_SAVED', entityType: 'TASK', entityId: req.params.id, newValues: { stage_id: submission.stage_id } });
  res.json({ submission });
}

async function addTest(req, res) {
  const payload = taskTestSchema.parse(req.body);
  const test = await taskService.addTest(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_TEST_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { test_id: test.id, stage_id: test.stage_id, status: test.status } });
  res.status(201).json({ test });
}

async function updateTest(req, res) {
  const payload = taskTestSchema.parse(req.body);
  const test = await taskService.updateTest(req, req.params.id, req.params.testId, payload);
  await recordAudit({ req, operation: 'TASK_TEST_UPDATED', entityType: 'TASK', entityId: req.params.id, newValues: { test_id: test.id, status: test.status } });
  res.json({ test });
}

async function deleteTest(req, res) {
  await taskService.softDeleteTest(req, req.params.id, req.params.testId);
  await recordAudit({ req, operation: 'TASK_TEST_REMOVED', entityType: 'TASK', entityId: req.params.id, newValues: { test_id: req.params.testId } });
  res.status(204).end();
}

async function addApproval(req, res) {
  const payload = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    notes: z.string().trim().min(3).max(50000)
  }).parse(req.body);
  const approval = await taskService.addApproval(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_APPROVAL_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { approval_id: approval.id, decision: approval.decision } });
  res.status(201).json({ approval });
}

async function addGithub(req, res) {
  const payload = createGithubCardSchema.parse(req.body);
  const github = await taskService.saveGithub(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_GITHUB_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { ...payload, notes_code: payload.notes_code ? '[REDACTED_CONTENT]' : null, code_content: payload.code_content ? '[REDACTED_CODE]' : null } });
  res.status(201).json({ github });
}

async function updateGithub(req, res) {
  const payload = updateGithubCardSchema.parse(req.body);
  const github = await taskService.saveGithub(req, req.params.id, payload, req.params.cardId);
  await recordAudit({ req, operation: 'TASK_GITHUB_UPDATED', entityType: 'TASK', entityId: req.params.id, newValues: { ...payload, notes_code: payload.notes_code ? '[REDACTED_CONTENT]' : null, code_content: payload.code_content ? '[REDACTED_CODE]' : null } });
  res.json({ github });
}

async function deleteGithub(req, res) {
  await taskService.softDeleteGithub(req, req.params.id, req.params.cardId);
  await recordAudit({ req, operation: 'TASK_GITHUB_REMOVED', entityType: 'TASK', entityId: req.params.id, newValues: { github_card_id: req.params.cardId } });
  res.status(204).end();
}

async function addComment(req, res) {
  const { content } = z.object({ content: z.string().trim().min(1).max(20000) }).parse(req.body);
  const comment = await taskService.addComment(req, req.params.id, content);
  await recordAudit({ req, operation: 'TASK_COMMENT_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { comment_id: comment.id } });
  res.status(201).json({ comment });
}

async function uploadAttachment(req, res) {
  try {
    const context = z.object({
      test_id: z.preprocess((value) => value || undefined, z.string().uuid().optional()),
      comment_id: z.preprocess((value) => value || undefined, z.string().uuid().optional()),
      sourceSection: z.enum(['geral', 'backend', 'frontend', 'testes', 'github', 'comentarios']).default('geral')
    }).refine((value) => !(value.test_id && value.comment_id), { message: 'Informe apenas um contexto de anexo.' }).parse(req.body || {});
    const attachment = await attachmentService.createAttachment(req, req.params.id, req.file, req.body?.description, context);
    await recordAudit({ req, operation: 'TASK_ATTACHMENT_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { attachment_id: attachment.id, source_section: attachment.source_section } });
    res.status(201).json({ attachment });
  } catch (error) {
    if (req.file?.path) await fs.rm(req.file.path, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadAttachment(req, res) {
  const { attachment, filePath } = await attachmentService.getAttachment(req.user, req.params.id, req.params.attachmentId);
  res.setHeader('Content-Type', attachment.mime_type);
  const disposition = /^(image|video)\//u.test(attachment.mime_type) || attachment.mime_type === 'application/pdf'
    ? 'inline'
    : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${path.basename(attachment.original_name).replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
}

async function deleteAttachment(req, res) {
  await attachmentService.softDeleteAttachment(req, req.params.id, req.params.attachmentId);
  await recordAudit({ req, operation: 'TASK_ATTACHMENT_REMOVED', entityType: 'TASK', entityId: req.params.id, newValues: { attachment_id: req.params.attachmentId } });
  res.status(204).end();
}

module.exports = {
  createTask, listTasks, getListPreference, saveListPreference, listTrash, deleteTask, restoreTask, emptyTrash, detail, transition, stateAction, updateAdministration,
  saveSubmission, addTest, updateTest, deleteTest, addApproval, addGithub, updateGithub, deleteGithub, addComment,
  uploadAttachment, downloadAttachment, deleteAttachment, timerAction
};
