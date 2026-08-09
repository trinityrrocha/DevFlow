const path = require('path');
const fs = require('fs/promises');
const { z } = require('zod');
const taskService = require('../services/taskService');
const attachmentService = require('../services/attachmentService');
const { recordAudit } = require('../services/auditService');

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

async function createTask(req, res) {
  const task = await taskService.createTask(req, taskSchema.parse(req.body));
  await recordAudit({ req, operation: 'TASK_CREATED', entityType: 'TASK', entityId: task.id, newValues: task });
  res.status(201).json({ task });
}

async function listTasks(req, res) {
  const filters = z.object({
    state: z.enum(['ACTIVE', 'PAUSED', 'CANCELED', 'COMPLETED']).optional(),
    stage: z.string().max(64).optional(),
    kind: z.enum(['REQUEST', 'BUG']).optional(),
    priority: z.string().max(64).optional(),
    project_id: z.string().uuid().optional(),
    assignee: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    overdue: z.enum(['true', 'false']).optional()
  }).parse(req.query);
  res.json(await taskService.listTasks(req.user, filters));
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
  const payload = z.object({ action: z.enum(['pause', 'reopen', 'cancel']), reason: z.string().trim().min(5).max(2000) }).parse(req.body);
  const task = await taskService.setTaskState(req, req.params.id, payload.action, payload.reason);
  await recordAudit({ req, operation: `TASK_${payload.action.toUpperCase()}`, entityType: 'TASK', entityId: task.id, newValues: { state: task.state } });
  res.json({ task });
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
  const { action } = z.object({ action: z.enum(['start', 'pause', 'resume', 'complete', 'cancel']) }).parse(req.body);
  const task = await taskService.timerAction(req, req.params.id, action);
  await recordAudit({ req, operation: `TASK_TIMER_${action.toUpperCase()}`, entityType: 'TASK', entityId: task.id, newValues: { timer_status: task.timer_status, active_elapsed_seconds: task.active_elapsed_seconds, is_overdue: task.is_overdue } });
  if (task.became_overdue) await recordAudit({ req, operation: 'TASK_OVERDUE', entityType: 'TASK', entityId: task.id, newValues: { active_elapsed_seconds: task.active_elapsed_seconds, estimated_duration_seconds: task.estimated_duration_seconds } });
  res.json({ task });
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
  const payload = z.object({
    description: z.string().trim().min(3).max(50000),
    result: z.enum(['PASSED', 'FAILED', 'BLOCKED']),
    evidence: z.string().trim().max(50000).optional(),
    tested_as_super_admin: z.boolean().default(false),
    tested_as_admin: z.boolean().default(false),
    tested_as_user: z.boolean().default(false)
  }).parse(req.body);
  const test = await taskService.addTest(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_TEST_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { test_id: test.id, stage_id: test.stage_id, result: test.result } });
  res.status(201).json({ test });
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

const optionalUrl = z.preprocess((value) => value === '' ? null : value, z.string().url().nullable().optional());
const githubFields = {
    title: z.string().trim().min(2).max(160),
    repository_url: optionalUrl,
    branch: z.string().trim().max(255).nullable().optional(),
    commit_sha: z.string().trim().max(64).nullable().optional(),
    pull_request_url: optionalUrl,
    release: z.string().trim().max(255).nullable().optional(),
    notes_code: z.string().max(50000).nullable().optional()
};

async function addGithub(req, res) {
  const payload = z.object(githubFields).parse(req.body);
  const github = await taskService.saveGithub(req, req.params.id, payload);
  await recordAudit({ req, operation: 'TASK_GITHUB_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { ...payload, notes_code: payload.notes_code ? '[REDACTED_CONTENT]' : null } });
  res.status(201).json({ github });
}

async function updateGithub(req, res) {
  const payload = z.object({ ...githubFields, title: githubFields.title.optional() }).partial()
    .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' }).parse(req.body);
  const github = await taskService.saveGithub(req, req.params.id, payload, req.params.cardId);
  await recordAudit({ req, operation: 'TASK_GITHUB_UPDATED', entityType: 'TASK', entityId: req.params.id, newValues: { ...payload, notes_code: payload.notes_code ? '[REDACTED_CONTENT]' : null } });
  res.json({ github });
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
      comment_id: z.preprocess((value) => value || undefined, z.string().uuid().optional())
    }).refine((value) => !(value.test_id && value.comment_id), { message: 'Informe apenas um contexto de anexo.' }).parse(req.body || {});
    const attachment = await attachmentService.createAttachment(req, req.params.id, req.file, req.body?.description, context);
    await recordAudit({ req, operation: 'TASK_ATTACHMENT_ADDED', entityType: 'TASK', entityId: req.params.id, newValues: { attachment_id: attachment.id } });
    res.status(201).json({ attachment });
  } catch (error) {
    if (req.file?.path) await fs.rm(req.file.path, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadAttachment(req, res) {
  const { attachment, filePath } = await attachmentService.getAttachment(req.user, req.params.id, req.params.attachmentId);
  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(attachment.original_name).replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
}

async function deleteAttachment(req, res) {
  await attachmentService.softDeleteAttachment(req, req.params.id, req.params.attachmentId);
  await recordAudit({ req, operation: 'TASK_ATTACHMENT_REMOVED', entityType: 'TASK', entityId: req.params.id, newValues: { attachment_id: req.params.attachmentId } });
  res.status(204).end();
}

module.exports = {
  createTask, listTasks, detail, transition, stateAction, updateAdministration,
  saveSubmission, addTest, addApproval, addGithub, updateGithub, addComment,
  uploadAttachment, downloadAttachment, deleteAttachment, timerAction
};
