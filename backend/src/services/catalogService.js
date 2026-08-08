const db = require('../config/database');
const { AppError, assert } = require('../utils/errors');

const tableConfig = {
  environments: {
    table: 'environments',
    fields: ['code', 'name', 'color_token', 'sort_order', 'is_active']
  },
  priorities: {
    table: 'priorities',
    fields: ['code', 'name', 'weight', 'color_token', 'sort_order', 'is_active']
  },
  taskTypes: {
    table: 'task_types',
    fields: ['code', 'name', 'applicable_kind', 'sort_order', 'is_active']
  },
  profiles: {
    table: 'technical_profiles',
    fields: ['code', 'name', 'description', 'is_active']
  }
};

async function bootstrap(companyId) {
  const [clients, projects, environments, priorities, taskTypes, workflows, users] = await Promise.all([
    db.query(
      `SELECT id,name,code,contact_name,contact_email,notes,is_active
       FROM clients WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`,
      [companyId]
    ),
    db.query(
      `SELECT p.*,c.name AS client_name,e.name AS default_environment_name
       FROM projects p JOIN clients c ON c.id=p.client_id
       JOIN environments e ON e.id=p.default_environment_id
       WHERE p.company_id=$1 AND p.deleted_at IS NULL ORDER BY p.name`,
      [companyId]
    ),
    db.query('SELECT * FROM environments WHERE company_id=$1 ORDER BY sort_order,name', [companyId]),
    db.query('SELECT * FROM priorities WHERE company_id=$1 ORDER BY sort_order,name', [companyId]),
    db.query('SELECT * FROM task_types WHERE company_id=$1 ORDER BY sort_order,name', [companyId]),
    db.query(
      `SELECT w.*,COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id',s.id,'code',s.code,'name',s.name,'sort_order',s.sort_order,
           'responsibility',s.responsibility,'requirements',s.requirements,
           'tracks_time',s.tracks_time,'completes_task',s.completes_task,
           'is_active',s.is_active
         ) ORDER BY s.sort_order)
         FROM workflow_stages s WHERE s.workflow_id=w.id
       ),'[]'::jsonb) AS stages
       FROM workflows w WHERE w.company_id=$1 ORDER BY w.name`,
      [companyId]
    ),
    db.query(
      `SELECT u.id,u.name,u.email,m.id AS membership_id,
              COALESCE(array_agg(DISTINCT tp.code) FILTER (WHERE tp.code IS NOT NULL),'{}') AS profiles
       FROM company_memberships m JOIN users u ON u.id=m.user_id
       LEFT JOIN membership_technical_profiles mp ON mp.membership_id=m.id
       LEFT JOIN technical_profiles tp ON tp.id=mp.profile_id
       WHERE m.company_id=$1 AND m.is_active=TRUE AND u.is_active=TRUE AND u.deleted_at IS NULL
       GROUP BY u.id,m.id ORDER BY u.name`,
      [companyId]
    )
  ]);
  return {
    clients: clients.rows,
    projects: projects.rows,
    environments: environments.rows,
    priorities: priorities.rows,
    task_types: taskTypes.rows,
    workflows: workflows.rows,
    users: users.rows
  };
}

function pagination(filters = {}) {
  const page = Number(filters.page) || 1;
  const limit = Math.min(Number(filters.limit) || 20, 100);
  return { page, limit, offset: (page - 1) * limit };
}

async function listClients(companyId, filters = {}) {
  const { page, limit, offset } = pagination(filters);
  const values = [companyId];
  const conditions = ['c.company_id=$1', 'c.deleted_at IS NULL'];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(c.name ILIKE $${values.length} OR c.code ILIKE $${values.length} OR c.contact_name ILIKE $${values.length})`);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    values.push(filters.status === 'active');
    conditions.push(`c.is_active=$${values.length}`);
  }
  const where = conditions.join(' AND ');
  const total = Number((await db.query(`SELECT COUNT(*) FROM clients c WHERE ${where}`, values)).rows[0].count);
  values.push(limit, offset);
  const clients = (await db.query(
    `SELECT c.*,
            (SELECT COUNT(*)::integer FROM projects p
             WHERE p.client_id=c.id AND p.company_id=c.company_id AND p.deleted_at IS NULL) AS project_count
     FROM clients c WHERE ${where}
     ORDER BY c.name LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )).rows;
  return { clients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getClient(companyId, id) {
  const client = (await db.query(
    `SELECT c.*,
            (SELECT COUNT(*)::integer FROM projects p
             WHERE p.client_id=c.id AND p.company_id=c.company_id AND p.deleted_at IS NULL) AS project_count
     FROM clients c WHERE c.id=$1 AND c.company_id=$2 AND c.deleted_at IS NULL`,
    [id, companyId]
  )).rows[0];
  assert(client, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.', 404);
  return client;
}

async function createClient(companyId, payload) {
  return (await db.query(
    `WITH generated AS (SELECT gen_random_uuid() AS id)
     INSERT INTO clients (id,company_id,name,code,contact_name,contact_email,notes)
     SELECT id,$1,$2,'CLI_' || UPPER(REPLACE(id::text,'-','')),$3,$4,$5 FROM generated
     RETURNING *`,
    [companyId, payload.name, payload.contact_name || null, payload.contact_email || null, payload.notes || null]
  )).rows[0];
}

async function updateClient(companyId, id, payload) {
  const allowed = ['name', 'contact_name', 'contact_email', 'notes', 'is_active'];
  const fields = allowed.filter((field) => payload[field] !== undefined);
  assert(fields.length, 'NO_CHANGES', 'Nenhuma alteração informada.');
  const result = await db.query(
    `UPDATE clients SET ${fields.map((field, index) => `${field}=$${index + 3}`).join(',')},
       updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL RETURNING *`,
    [id, companyId, ...fields.map((field) => payload[field])]
  );
  assert(result.rowCount, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.', 404);
  return result.rows[0];
}

async function deleteClient(companyId, id) {
  return db.transaction(async (client) => {
    const existing = (await client.query(
      'SELECT * FROM clients WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [id, companyId]
    )).rows[0];
    assert(existing, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.', 404);
    const links = Number((await client.query(
      'SELECT COUNT(*) FROM projects WHERE client_id=$1 AND company_id=$2 AND deleted_at IS NULL',
      [id, companyId]
    )).rows[0].count);
    assert(links === 0, 'CLIENT_HAS_PROJECTS', 'Cliente possui projetos vinculados e não pode ser excluído.', 409);
    await client.query(
      'UPDATE clients SET is_active=FALSE,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND company_id=$2',
      [id, companyId]
    );
    return existing;
  });
}

const projectSelection = `SELECT p.*,c.name AS client_name,e.name AS default_environment_name,
            (SELECT COUNT(*)::integer FROM tasks t WHERE t.project_id=p.id AND t.company_id=p.company_id) AS task_count,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'user_id',pr.user_id,'name',u.name,'responsibility_code',pr.responsibility_code
              ) ORDER BY u.name)
              FROM project_responsibles pr JOIN users u ON u.id=pr.user_id
              WHERE pr.project_id=p.id
            ),'[]'::jsonb) AS responsibles
     FROM projects p JOIN clients c ON c.id=p.client_id
     JOIN environments e ON e.id=p.default_environment_id`;

async function listProjects(companyId, filters = {}) {
  const { page, limit, offset } = pagination(filters);
  const values = [companyId];
  const conditions = ['p.company_id=$1', 'p.deleted_at IS NULL'];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(p.name ILIKE $${values.length} OR p.code ILIKE $${values.length} OR c.name ILIKE $${values.length})`);
  }
  if (filters.status && filters.status !== 'all') {
    values.push(filters.status);
    conditions.push(`p.status=$${values.length}`);
  }
  if (filters.client_id) {
    values.push(filters.client_id);
    conditions.push(`p.client_id=$${values.length}`);
  }
  const where = conditions.join(' AND ');
  const total = Number((await db.query(
    `SELECT COUNT(*) FROM projects p JOIN clients c ON c.id=p.client_id WHERE ${where}`,
    values
  )).rows[0].count);
  values.push(limit, offset);
  const projects = (await db.query(
    `SELECT p.*,c.name AS client_name,e.name AS default_environment_name,
            (SELECT COUNT(*)::integer FROM tasks t WHERE t.project_id=p.id AND t.company_id=p.company_id) AS task_count,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'user_id',pr.user_id,'name',u.name,'responsibility_code',pr.responsibility_code
              ) ORDER BY u.name)
              FROM project_responsibles pr JOIN users u ON u.id=pr.user_id
              WHERE pr.project_id=p.id
            ),'[]'::jsonb) AS responsibles
     FROM projects p JOIN clients c ON c.id=p.client_id
     JOIN environments e ON e.id=p.default_environment_id
     WHERE ${where} ORDER BY p.name LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )).rows;
  return { projects, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getProject(companyId, id) {
  const project = (await db.query(
    `${projectSelection} WHERE p.id=$1 AND p.company_id=$2 AND p.deleted_at IS NULL`,
    [id, companyId]
  )).rows[0];
  assert(project, 'PROJECT_NOT_FOUND', 'Projeto não encontrado.', 404);
  return project;
}

async function assertProjectReferences(queryable, companyId, payload) {
  const reference = await queryable.query(
    `SELECT
       EXISTS(SELECT 1 FROM clients WHERE id=$1 AND company_id=$3 AND deleted_at IS NULL) AS client_ok,
       EXISTS(SELECT 1 FROM environments WHERE id=$2 AND company_id=$3 AND is_active=TRUE) AS environment_ok`,
    [payload.client_id, payload.default_environment_id, companyId]
  );
  assert(reference.rows[0].client_ok, 'CLIENT_INVALID', 'Cliente inválido.');
  assert(reference.rows[0].environment_ok, 'ENVIRONMENT_INVALID', 'Ambiente inválido.');
}

async function syncProjectResponsibles(client, companyId, projectId, responsibles = []) {
  await client.query('DELETE FROM project_responsibles WHERE project_id=$1 AND company_id=$2', [projectId, companyId]);
  for (const item of responsibles) {
    await client.query(
      `INSERT INTO project_responsibles (company_id,project_id,user_id,responsibility_code)
       VALUES ($1,$2,$3,$4)`,
      [companyId, projectId, item.user_id, item.responsibility_code]
    );
  }
}

async function createProject(companyId, payload) {
  return db.transaction(async (client) => {
    await assertProjectReferences(client, companyId, payload);
    const project = (await client.query(
      `WITH generated AS (SELECT gen_random_uuid() AS id)
       INSERT INTO projects (
         id,company_id,client_id,default_environment_id,name,code,description,github_repository_url,status
       ) SELECT id,$1,$2,$3,$4,'PRJ_' || UPPER(REPLACE(id::text,'-','')),$5,$6,$7 FROM generated
       RETURNING *`,
      [
        companyId, payload.client_id, payload.default_environment_id, payload.name,
        payload.description || null, payload.github_repository_url || null, payload.status || 'ACTIVE'
      ]
    )).rows[0];
    await syncProjectResponsibles(client, companyId, project.id, payload.responsibles);
    return project;
  });
}

async function updateProject(companyId, id, payload) {
  return db.transaction(async (client) => {
    const existing = (await client.query(
      'SELECT * FROM projects WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [id, companyId]
    )).rows[0];
    if (!existing) throw new AppError('PROJECT_NOT_FOUND', 'Projeto não encontrado.', 404);
    const merged = {
      client_id: payload.client_id || existing.client_id,
      default_environment_id: payload.default_environment_id || existing.default_environment_id
    };
    await assertProjectReferences(client, companyId, merged);
    const project = (await client.query(
      `UPDATE projects SET client_id=$3,default_environment_id=$4,
         name=COALESCE($5,name),description=COALESCE($6,description),
         github_repository_url=COALESCE($7,github_repository_url),status=COALESCE($8,status),
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [
        id, companyId, merged.client_id, merged.default_environment_id, payload.name,
        payload.description, payload.github_repository_url, payload.status
      ]
    )).rows[0];
    if (payload.responsibles) await syncProjectResponsibles(client, companyId, id, payload.responsibles);
    return project;
  });
}

async function deleteProject(companyId, id) {
  return db.transaction(async (client) => {
    const existing = (await client.query(
      'SELECT * FROM projects WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [id, companyId]
    )).rows[0];
    assert(existing, 'PROJECT_NOT_FOUND', 'Projeto não encontrado.', 404);
    const links = Number((await client.query(
      'SELECT COUNT(*) FROM tasks WHERE project_id=$1 AND company_id=$2',
      [id, companyId]
    )).rows[0].count);
    assert(links === 0, 'PROJECT_HAS_TASKS', 'Projeto possui tarefas vinculadas e não pode ser excluído.', 409);
    await client.query(
      `UPDATE projects SET status='ARCHIVED',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2`,
      [id, companyId]
    );
    return existing;
  });
}

async function listCatalog(companyId, catalog) {
  const config = tableConfig[catalog];
  if (!config) throw new AppError('CATALOG_INVALID', 'Catálogo inválido.', 404);
  return (await db.query(
    `SELECT * FROM ${config.table} WHERE company_id=$1 ORDER BY sort_order NULLS LAST,name`,
    [companyId]
  )).rows;
}

async function createCatalogItem(companyId, catalog, payload) {
  const config = tableConfig[catalog];
  if (!config) throw new AppError('CATALOG_INVALID', 'Catálogo inválido.', 404);
  const fields = config.fields.filter((field) => payload[field] !== undefined);
  const values = fields.map((field) => payload[field]);
  const placeholders = fields.map((_, index) => `$${index + 2}`);
  return (await db.query(
    `INSERT INTO ${config.table} (company_id,${fields.join(',')})
     VALUES ($1,${placeholders.join(',')}) RETURNING *`,
    [companyId, ...values]
  )).rows[0];
}

async function updateCatalogItem(companyId, catalog, id, payload) {
  const config = tableConfig[catalog];
  if (!config) throw new AppError('CATALOG_INVALID', 'Catálogo inválido.', 404);
  const fields = config.fields.filter((field) => payload[field] !== undefined);
  assert(fields.length, 'NO_CHANGES', 'Nenhuma alteração informada.');
  const assignments = fields.map((field, index) => `${field}=$${index + 3}`);
  const result = await db.query(
    `UPDATE ${config.table} SET ${assignments.join(',')},updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [id, companyId, ...fields.map((field) => payload[field])]
  );
  assert(result.rowCount, 'CATALOG_ITEM_NOT_FOUND', 'Item não encontrado.', 404);
  return result.rows[0];
}

async function createWorkflow(companyId, payload) {
  return db.transaction(async (client) => {
    if (payload.is_default) {
      await client.query(
        `UPDATE workflows SET is_default=FALSE
         WHERE company_id=$1
           AND ($2='BOTH' OR task_kind=$2)
           AND is_default=TRUE`,
        [companyId, payload.task_kind]
      );
    }
    const workflow = (await client.query(
      `INSERT INTO workflows (company_id,code,name,task_kind,is_default)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [companyId, payload.code, payload.name, payload.task_kind, payload.is_default]
    )).rows[0];
    for (const stage of payload.stages) {
      await client.query(
        `INSERT INTO workflow_stages (
           company_id,workflow_id,code,name,sort_order,responsibility,requirements,tracks_time,completes_task
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          companyId, workflow.id, stage.code, stage.name, stage.sort_order,
          stage.responsibility, stage.requirements || {}, stage.tracks_time, stage.completes_task
        ]
      );
    }
    return workflow;
  });
}

module.exports = {
  bootstrap, listClients, getClient, createClient, updateClient, deleteClient,
  listProjects, getProject, createProject, updateProject, deleteProject,
  listCatalog, createCatalogItem, updateCatalogItem, createWorkflow
};
