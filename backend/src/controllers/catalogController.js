const { z } = require('zod');
const service = require('../services/catalogService');
const { recordAudit } = require('../services/auditService');
const { AppError } = require('../utils/errors');

const code = z.string().trim().min(2).max(64).regex(/^[A-Z0-9_]+$/);
const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const responsible = z.object({
  user_id: z.string().uuid(),
  responsibility_code: code
});

const clientSchema = z.object({
  name: z.string().trim().min(2).max(180),
  code: nullableText(64),
  contact_name: nullableText(160),
  contact_email: z.string().email().max(320).nullable().optional(),
  notes: nullableText(10000),
  is_active: z.boolean().optional()
});

const projectSchema = z.object({
  client_id: z.string().uuid(),
  default_environment_id: z.string().uuid(),
  name: z.string().trim().min(2).max(180),
  code,
  description: nullableText(20000),
  github_repository_url: z.string().url().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  responsibles: z.array(responsible).max(100).optional()
});

const catalogSchemas = {
  environments: z.object({
    code, name: z.string().trim().min(2).max(120), color_token: z.string().max(32).optional(),
    sort_order: z.number().int().min(0).optional(), is_active: z.boolean().optional()
  }),
  priorities: z.object({
    code, name: z.string().trim().min(2).max(120), weight: z.number().positive().optional(),
    color_token: z.string().max(32).optional(), sort_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional()
  }),
  taskTypes: z.object({
    code, name: z.string().trim().min(2).max(120),
    applicable_kind: z.enum(['REQUEST', 'BUG', 'BOTH']).optional(),
    sort_order: z.number().int().min(0).optional(), is_active: z.boolean().optional()
  }),
  profiles: z.object({
    code, name: z.string().trim().min(2).max(120), description: nullableText(1000),
    is_active: z.boolean().optional()
  })
};

const stageSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  sort_order: z.number().int().min(0),
  responsibility: z.enum(['MANAGER', 'BACKEND_ASSIGNEE', 'FRONTEND_ASSIGNEE', 'ANY']),
  requirements: z.record(z.string(), z.unknown()).optional(),
  tracks_time: z.boolean().default(true),
  completes_task: z.boolean().default(false)
});

async function bootstrap(req, res) {
  res.json(await service.bootstrap(req.user.company_id));
}

async function listClients(req, res) {
  const filters = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  }).parse(req.query);
  res.json(await service.listClients(req.user.company_id, filters));
}

async function getClient(req, res) {
  res.json({ client: await service.getClient(req.user.company_id, req.params.id) });
}

async function createClient(req, res) {
  const client = await service.createClient(req.user.company_id, clientSchema.omit({ is_active: true }).parse(req.body));
  await recordAudit({ req, operation: 'CLIENT_CREATED', entityType: 'CLIENT', entityId: client.id, newValues: client });
  res.status(201).json({ client });
}

async function updateClient(req, res) {
  const client = await service.updateClient(req.user.company_id, req.params.id, clientSchema.partial().parse(req.body));
  await recordAudit({ req, operation: 'CLIENT_UPDATED', entityType: 'CLIENT', entityId: client.id, newValues: client });
  res.json({ client });
}

async function deleteClient(req, res) {
  const client = await service.deleteClient(req.user.company_id, req.params.id);
  await recordAudit({ req, operation: 'CLIENT_DELETED', entityType: 'CLIENT', entityId: client.id, previousValues: client });
  res.status(204).end();
}

async function listProjects(req, res) {
  const filters = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(['all', 'DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).default('all'),
    client_id: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  }).parse(req.query);
  res.json(await service.listProjects(req.user.company_id, filters));
}

async function getProject(req, res) {
  res.json({ project: await service.getProject(req.user.company_id, req.params.id) });
}

async function createProject(req, res) {
  const project = await service.createProject(req.user.company_id, projectSchema.parse(req.body));
  await recordAudit({ req, operation: 'PROJECT_CREATED', entityType: 'PROJECT', entityId: project.id, newValues: project });
  res.status(201).json({ project });
}

async function updateProject(req, res) {
  const project = await service.updateProject(req.user.company_id, req.params.id, projectSchema.partial().parse(req.body));
  await recordAudit({ req, operation: 'PROJECT_UPDATED', entityType: 'PROJECT', entityId: project.id, newValues: project });
  res.json({ project });
}

async function deleteProject(req, res) {
  const project = await service.deleteProject(req.user.company_id, req.params.id);
  await recordAudit({ req, operation: 'PROJECT_DELETED', entityType: 'PROJECT', entityId: project.id, previousValues: project });
  res.status(204).end();
}

async function listCatalog(req, res) {
  res.json({ items: await service.listCatalog(req.user.company_id, req.params.catalog) });
}

async function createCatalogItem(req, res) {
  const schema = catalogSchemas[req.params.catalog];
  if (!schema) throw new AppError('CATALOG_INVALID', 'Catálogo inválido.', 404);
  const item = await service.createCatalogItem(req.user.company_id, req.params.catalog, schema.parse(req.body));
  await recordAudit({ req, operation: 'CATALOG_ITEM_CREATED', entityType: req.params.catalog, entityId: item.id, newValues: item });
  res.status(201).json({ item });
}

async function updateCatalogItem(req, res) {
  const schema = catalogSchemas[req.params.catalog];
  if (!schema) throw new AppError('CATALOG_INVALID', 'Catálogo inválido.', 404);
  const item = await service.updateCatalogItem(req.user.company_id, req.params.catalog, req.params.id, schema.partial().parse(req.body));
  await recordAudit({ req, operation: 'CATALOG_ITEM_UPDATED', entityType: req.params.catalog, entityId: item.id, newValues: item });
  res.json({ item });
}

async function createWorkflow(req, res) {
  const payload = z.object({
    code, name: z.string().trim().min(2).max(160),
    task_kind: z.enum(['REQUEST', 'BUG', 'BOTH']),
    is_default: z.boolean().default(false),
    stages: z.array(stageSchema).min(2).max(30)
  }).superRefine((value, context) => {
    if (value.stages.filter((stage) => stage.completes_task).length !== 1) {
      context.addIssue({ code: 'custom', path: ['stages'], message: 'O fluxo deve ter exatamente uma etapa final.' });
    }
    if (!value.stages.at(-1)?.completes_task) {
      context.addIssue({ code: 'custom', path: ['stages'], message: 'A etapa final deve ser a última do fluxo.' });
    }
    if (new Set(value.stages.map((stage) => stage.code)).size !== value.stages.length) {
      context.addIssue({ code: 'custom', path: ['stages'], message: 'Os códigos das etapas devem ser únicos.' });
    }
  }).parse(req.body);
  const workflow = await service.createWorkflow(req.user.company_id, payload);
  await recordAudit({ req, operation: 'WORKFLOW_CREATED', entityType: 'WORKFLOW', entityId: workflow.id, newValues: payload });
  res.status(201).json({ workflow });
}

module.exports = {
  bootstrap, listClients, getClient, createClient, updateClient, deleteClient,
  listProjects, getProject, createProject, updateProject, deleteProject,
  listCatalog, createCatalogItem, updateCatalogItem, createWorkflow
};
