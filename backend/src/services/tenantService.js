const db = require('../config/database');
const { AppError, assert } = require('../utils/errors');

const ADMIN_PERMISSIONS = [
  'dashboard.view', 'tasks.view', 'tasks.create', 'tasks.operate', 'tasks.manage',
  'clients.view', 'clients.manage', 'projects.view', 'projects.manage',
  'catalogs.manage', 'users.manage', 'audit.view'
];
const USER_PERMISSIONS = [
  'dashboard.view', 'tasks.view', 'tasks.create', 'tasks.operate',
  'clients.view', 'projects.view'
];

const ENVIRONMENTS = [
  ['DEVELOPMENT', 'Desenvolvimento', 'blue', 10],
  ['HOMOLOGATION', 'Homologação', 'amber', 20],
  ['PRODUCTION', 'Produção', 'red', 30],
  ['SPECIFIC_CLIENT', 'Cliente específico', 'violet', 40],
  ['LOCAL', 'Ambiente local', 'slate', 50]
];
const PRIORITIES = [
  ['LOW', 'Baixa', 1, 10, 'slate'],
  ['MEDIUM', 'Média', 2, 20, 'blue'],
  ['HIGH', 'Alta', 3, 30, 'amber'],
  ['CRITICAL', 'Crítica', 5, 40, 'red'],
  ['URGENT_PRODUCTION', 'Urgente Produção', 8, 50, 'red']
];
const TASK_TYPES = [
  ['NEW_FEATURE', 'Nova funcionalidade', 'REQUEST', 10],
  ['IMPROVEMENT', 'Melhoria', 'REQUEST', 20],
  ['VISUAL_ADJUSTMENT', 'Ajuste visual', 'REQUEST', 30],
  ['PERFORMANCE', 'Performance', 'REQUEST', 40],
  ['REFACTORING', 'Refatoração', 'REQUEST', 50],
  ['FIX', 'Correção', 'BOTH', 60],
  ['INTEGRATION', 'Integração', 'REQUEST', 70],
  ['DOCUMENTATION', 'Documentação', 'REQUEST', 80],
  ['OTHER', 'Outro', 'BOTH', 90],
  ['BUG_REPORT', 'Bug', 'BUG', 100]
];

const stage = (code, name, order, responsibility, requirements, options = {}) => ({
  code,
  name,
  order,
  responsibility,
  requirements,
  tracksTime: options.tracksTime !== false,
  completesTask: options.completesTask === true
});

const commonDevelopmentStages = [
  stage('BACKEND', 'Backend', 20, 'BACKEND_ASSIGNEE', {
    passing_test: true,
    submission_fields: ['technical_notes', 'observations']
  }),
  stage('FRONTEND', 'Frontend', 30, 'FRONTEND_ASSIGNEE', {
    passing_test: true,
    submission_fields: ['observations']
  }),
  stage('FRONTEND_APPROVAL', 'Aprovação do Frontend', 40, 'MANAGER', {
    approval: true
  }),
  stage('GITHUB_UPDATE', 'Update GitHub', 50, 'MANAGER', {
    github_fields: ['repository_url', 'branch', 'commit_sha']
  }),
  stage('TESTING', 'Testando', 60, 'MANAGER', {
    passing_test: true,
    test_evidence: true,
    approval: true
  }),
  stage('REVIEW', 'Revisando', 70, 'MANAGER', { approval: true }),
  stage('PRODUCTION', 'Produção', 80, 'MANAGER', {}, { tracksTime: false, completesTask: true })
];

const WORKFLOW_DEFINITIONS = [
  {
    code: 'DEFAULT_REQUEST',
    name: 'Fluxo padrão de Solicitação',
    kind: 'REQUEST',
    stages: [
      stage('ROADMAP', 'Roadmap', 10, 'MANAGER', {
        task_fields: ['title', 'initial_description', 'backend_assignee_id', 'frontend_assignee_id']
      }, { tracksTime: false }),
      ...commonDevelopmentStages
    ]
  },
  {
    code: 'DEFAULT_BUG',
    name: 'Fluxo padrão de Bug',
    kind: 'BUG',
    stages: [
      stage('REPORT_BUG', 'Report Bug', 10, 'MANAGER', {
        task_fields: [
          'title', 'initial_description', 'product_affected', 'related_requirement',
          'initial_evidence', 'backend_assignee_id', 'frontend_assignee_id'
        ]
      }, { tracksTime: false }),
      ...commonDevelopmentStages
    ]
  }
];

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'empresa';
}

async function uniqueSlug(client, name) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  while ((await client.query('SELECT 1 FROM companies WHERE slug=$1', [candidate])).rowCount) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

async function createRole(client, companyId, code, name, permissionCodes) {
  const role = (await client.query(
    `INSERT INTO company_roles (company_id,code,name,is_system)
     VALUES ($1,$2,$3,TRUE) RETURNING *`,
    [companyId, code, name]
  )).rows[0];
  await client.query(
    `INSERT INTO role_permissions (company_id,role_id,permission_id)
     SELECT $1,$2,id FROM permissions WHERE code=ANY($3::text[])`,
    [companyId, role.id, permissionCodes]
  );
  return role;
}

async function createWorkflow(client, companyId, definition) {
  const workflow = (await client.query(
    `INSERT INTO workflows (company_id,code,name,task_kind,is_default,is_system)
     VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING *`,
    [companyId, definition.code, definition.name, definition.kind]
  )).rows[0];
  for (const item of definition.stages) {
    await client.query(
      `INSERT INTO workflow_stages (
         company_id,workflow_id,code,name,sort_order,responsibility,requirements,
         tracks_time,completes_task
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        companyId, workflow.id, item.code, item.name, item.order, item.responsibility,
        item.requirements, item.tracksTime, item.completesTask
      ]
    );
  }
}

async function bootstrapCompany(client, companyName, adminUserId) {
  const company = (await client.query(
    'INSERT INTO companies (name,slug) VALUES ($1,$2) RETURNING *',
    [companyName, await uniqueSlug(client, companyName)]
  )).rows[0];
  const membership = (await client.query(
    `INSERT INTO company_memberships (company_id,user_id,is_default)
     VALUES ($1,$2,TRUE) RETURNING *`,
    [company.id, adminUserId]
  )).rows[0];
  const adminRole = await createRole(client, company.id, 'ADMIN', 'Administrador', ADMIN_PERMISSIONS);
  await createRole(client, company.id, 'USER', 'Usuário', USER_PERMISSIONS);
  await client.query(
    'INSERT INTO membership_roles (company_id,membership_id,role_id) VALUES ($1,$2,$3)',
    [company.id, membership.id, adminRole.id]
  );

  for (const [code, name] of [
    ['BACKEND_DEVELOPER', 'Desenvolvedor Backend'],
    ['FRONTEND_DEVELOPER', 'Desenvolvedor Frontend'],
    ['MANAGER', 'Gestor']
  ]) {
    const profile = (await client.query(
      `INSERT INTO technical_profiles (company_id,code,name,is_system)
       VALUES ($1,$2,$3,TRUE) RETURNING id`,
      [company.id, code, name]
    )).rows[0];
    if (code === 'MANAGER') {
      await client.query(
        `INSERT INTO membership_technical_profiles (company_id,membership_id,profile_id)
         VALUES ($1,$2,$3)`,
        [company.id, membership.id, profile.id]
      );
    }
  }
  for (const [code, name, color, order] of ENVIRONMENTS) {
    await client.query(
      `INSERT INTO environments (company_id,code,name,color_token,sort_order,is_system)
       VALUES ($1,$2,$3,$4,$5,TRUE)`,
      [company.id, code, name, color, order]
    );
  }
  for (const [code, name, weight, order, color] of PRIORITIES) {
    await client.query(
      `INSERT INTO priorities (company_id,code,name,weight,sort_order,color_token,is_system)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [company.id, code, name, weight, order, color]
    );
  }
  for (const [code, name, kind, order] of TASK_TYPES) {
    await client.query(
      `INSERT INTO task_types (company_id,code,name,applicable_kind,sort_order,is_system)
       VALUES ($1,$2,$3,$4,$5,TRUE)`,
      [company.id, code, name, kind, order]
    );
  }
  for (const workflow of WORKFLOW_DEFINITIONS) await createWorkflow(client, company.id, workflow);
  await client.query(
    `INSERT INTO metric_refresh_state (company_id,status)
     VALUES ($1,'IDLE')`,
    [company.id]
  );
  return { company, membership };
}

async function loadMembershipContext(userId, companyId, queryable = db) {
  const result = await queryable.query(
    `SELECT m.id AS membership_id,m.company_id,m.user_id,m.is_default,
            c.name AS company_name,c.slug AS company_slug,
            COALESCE((
              SELECT array_agg(DISTINCT r.code ORDER BY r.code)
              FROM membership_roles mr JOIN company_roles r ON r.id=mr.role_id
              WHERE mr.membership_id=m.id AND r.is_active=TRUE
            ),'{}') AS roles,
            COALESCE((
              SELECT array_agg(DISTINCT p.code ORDER BY p.code)
              FROM membership_technical_profiles mp JOIN technical_profiles p ON p.id=mp.profile_id
              WHERE mp.membership_id=m.id AND p.is_active=TRUE
            ),'{}') AS profiles,
            COALESCE((
              SELECT array_agg(DISTINCT permission.code ORDER BY permission.code)
              FROM membership_roles mr
              JOIN company_roles r ON r.id=mr.role_id AND r.is_active=TRUE
              JOIN role_permissions rp ON rp.role_id=r.id
              JOIN permissions permission ON permission.id=rp.permission_id
              WHERE mr.membership_id=m.id
            ),'{}') AS permissions
     FROM company_memberships m
     JOIN companies c ON c.id=m.company_id AND c.is_active=TRUE AND c.deleted_at IS NULL
     WHERE m.user_id=$1 AND m.is_active=TRUE
       AND ($2::uuid IS NULL OR m.company_id=$2)
     ORDER BY m.is_default DESC,m.joined_at
     LIMIT 1`,
    [userId, companyId || null]
  );
  return result.rows[0] || null;
}

async function listUserCompanies(userId) {
  const result = await db.query(
    `SELECT c.id,c.name,c.slug,m.is_default
     FROM company_memberships m JOIN companies c ON c.id=m.company_id
     WHERE m.user_id=$1 AND m.is_active=TRUE AND c.is_active=TRUE AND c.deleted_at IS NULL
     ORDER BY m.is_default DESC,c.name`,
    [userId]
  );
  return result.rows;
}

async function requireMembership(userId, companyId) {
  const context = await loadMembershipContext(userId, companyId);
  assert(context, 'COMPANY_ACCESS_DENIED', 'Empresa não encontrada.', 404);
  return context;
}

function hasPermission(user, code) {
  return user?.is_super_admin === true || user?.permissions?.includes(code);
}

function assertPermission(user, code) {
  if (!hasPermission(user, code)) {
    throw new AppError('PERMISSION_DENIED', 'Você não possui permissão para esta operação.', 403);
  }
}

module.exports = {
  ADMIN_PERMISSIONS,
  USER_PERMISSIONS,
  bootstrapCompany,
  loadMembershipContext,
  listUserCompanies,
  requireMembership,
  hasPermission,
  assertPermission
};
