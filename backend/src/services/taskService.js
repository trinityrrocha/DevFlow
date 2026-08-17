const db = require('../config/database');
const { AppError, assert } = require('../utils/errors');
const workflow = require('./workflowService');
const { notifyStageChange, notifyAssignments, notifyOverdue, notifyCompleted, taskCode } = require('./notificationService');
const { hasPermission } = require('./tenantService');
const timing = require('./taskTimingService');
const { recordAudit } = require('./auditService');
const taskPurgeStorage = require('./taskPurgeStorage');
const { safeLogError } = require('../utils/safeLogger');
const dashboardService = require('./dashboardService');
const { getTaskCategory, taskCategorySql } = require('../domain/taskCategory');

const isAdmin = (user) => user?.is_super_admin === true || user?.roles?.includes('ADMIN') || user?.permissions?.includes('tasks.manage');
const isRoadmap = (task) => String(task.stage || '').toUpperCase() === 'ROADMAP' || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
const stageTracksTime = (stage) => stage?.tracks_time === true && stage?.completes_task !== true && !isRoadmap(stage);

async function refreshTrashMetrics(companyId) {
  await dashboardService.refreshCompany(companyId)
    .catch((error) => safeLogError('Falha ao recompor metricas apos operacao da lixeira.', error));
}

async function canViewTask(user, task, queryable = db) {
  if (isAdmin(user)) return true;
  if (isRoadmap(task)) return task.created_by === user.id;
  if ([task.created_by, task.requester_id, task.backend_assignee_id, task.frontend_assignee_id].includes(user.id)) return true;
  const linked = await queryable.query('SELECT 1 FROM project_responsibles WHERE company_id=$1 AND project_id=$2 AND user_id=$3 LIMIT 1', [user.company_id, task.project_id, user.id]);
  return linked.rowCount > 0;
}

async function addEvent(client, req, taskId, eventType, description, previousValues = {}, newValues = {}) {
  await client.query(
    `INSERT INTO task_events (
       company_id,task_id,event_type,description,previous_values,new_values,
       actor_id,ip_address,request_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      req.user.company_id, taskId, eventType, description, previousValues, newValues,
      req.user.id, req.ip || null, req.requestId
    ]
  );
  await client.query(
    `UPDATE metric_refresh_state SET status='IDLE',error_code=NULL
     WHERE company_id=$1 AND status<>'RUNNING'`,
    [req.user.company_id]
  );
}

async function loadStages(queryable, companyId, workflowId) {
  return (await queryable.query(
    `SELECT * FROM workflow_stages
     WHERE company_id=$1 AND workflow_id=$2 AND is_active=TRUE
     ORDER BY sort_order`,
    [companyId, workflowId]
  )).rows;
}

async function createTask(req, payload) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const project = (await client.query(
      `SELECT p.*,c.name AS client_name
       FROM projects p JOIN clients c ON c.id=p.client_id AND c.company_id=p.company_id
       WHERE p.id=$1 AND p.company_id=$2 AND p.status IN ('ACTIVE','DRAFT')
         AND p.deleted_at IS NULL AND c.is_active=TRUE AND c.deleted_at IS NULL`,
      [payload.project_id, companyId]
    )).rows[0];
    assert(project, 'PROJECT_NOT_FOUND', 'Projeto não encontrado.', 404);
    const [priorityResult, environmentResult, typeResult, workflowResult, usersResult] = await Promise.all([
      client.query(
        'SELECT * FROM priorities WHERE id=$1 AND company_id=$2 AND is_active=TRUE',
        [payload.priority_id, companyId]
      ),
      client.query(
        'SELECT * FROM environments WHERE id=$1 AND company_id=$2 AND is_active=TRUE',
        [payload.environment_id, companyId]
      ),
      client.query(
        `SELECT * FROM task_types WHERE id=$1 AND company_id=$2 AND is_active=TRUE
         AND applicable_kind IN ($3,'BOTH')`,
        [payload.task_type_id, companyId, payload.kind]
      ),
      payload.workflow_id
        ? client.query(
          `SELECT * FROM workflows WHERE id=$1 AND company_id=$2 AND is_active=TRUE
           AND task_kind IN ($3,'BOTH')`,
          [payload.workflow_id, companyId, payload.kind]
        )
        : client.query(
          `SELECT * FROM workflows WHERE company_id=$1 AND is_active=TRUE AND is_default=TRUE
           AND task_kind IN ($2,'BOTH') ORDER BY task_kind=$2 DESC LIMIT 1`,
          [companyId, payload.kind]
        ),
      client.query(
        `SELECT user_id FROM company_memberships
         WHERE company_id=$1 AND user_id=ANY($2::uuid[]) AND is_active=TRUE`,
        [companyId, [payload.requester_id, payload.backend_assignee_id, payload.frontend_assignee_id]]
      )
    ]);
    assert(priorityResult.rowCount, 'PRIORITY_INVALID', 'Prioridade inválida.');
    assert(environmentResult.rowCount, 'ENVIRONMENT_INVALID', 'Ambiente inválido.');
    assert(typeResult.rowCount, 'TASK_TYPE_INVALID', 'Tipo de tarefa inválido.');
    assert(workflowResult.rowCount, 'WORKFLOW_INVALID', 'Fluxo inválido.');
    assert(
      usersResult.rowCount === new Set([
        payload.requester_id,
        payload.backend_assignee_id,
        payload.frontend_assignee_id
      ]).size,
      'TASK_USER_INVALID',
      'Solicitante ou responsável inválido.'
    );
    if (payload.related_task_id) {
      const related = await client.query(
        `SELECT t.*,s.code AS stage,s.name AS stage_name FROM tasks t
         JOIN workflow_stages s ON s.id=t.current_stage_id
         WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NULL`,
        [payload.related_task_id, companyId]
      );
      assert(related.rowCount && await canViewTask(req.user, related.rows[0], client), 'RELATED_TASK_INVALID', 'Tarefa de origem inválida.');
    }
    const selectedWorkflow = workflowResult.rows[0];
    const stages = await loadStages(client, companyId, selectedWorkflow.id);
    assert(stages.length >= 2, 'WORKFLOW_INCOMPLETE', 'O fluxo precisa ter pelo menos duas etapas.', 409);
    const firstStage = stages[0];
    const task = (await client.query(
      `INSERT INTO tasks (
         company_id,project_id,client_id,task_type_id,priority_id,environment_id,
         workflow_id,current_stage_id,kind,title,initial_description,requester_id,
         client_environment,product_affected,related_requirement,related_task_id,
         bug_area,initial_evidence,backend_assignee_id,frontend_assignee_id,created_by,
         estimated_duration_seconds,current_stage_entered_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       ) RETURNING *`,
      [
        companyId, project.id, project.client_id, payload.task_type_id, payload.priority_id,
        payload.environment_id, selectedWorkflow.id, firstStage.id, payload.kind,
        payload.title, payload.initial_description, payload.requester_id,
        payload.client_environment || null, payload.product_affected || null,
        payload.related_requirement || null, payload.related_task_id || null,
        payload.bug_area || null, payload.initial_evidence || null,
        payload.backend_assignee_id, payload.frontend_assignee_id, req.user.id,
        payload.estimated_duration_seconds || null,
        stageTracksTime(firstStage) ? new Date() : null
      ]
    )).rows[0];
    if (stageTracksTime(firstStage)) {
      await client.query(
        `INSERT INTO task_stage_intervals (
           company_id,task_id,stage_id,stage_code_snapshot,stage_name_snapshot,started_at
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [companyId, task.id, firstStage.id, firstStage.code, firstStage.name, task.current_stage_entered_at]
      );
    }
    await addEvent(
      client,
      req,
      task.id,
      'TASK_CREATED',
      `${taskCode(task)} criada em ${firstStage.name}.`,
      {},
      {
        kind: task.kind,
        project_id: task.project_id,
        workflow_id: selectedWorkflow.id,
        stage_id: firstStage.id,
        priority_id: task.priority_id
      }
    );
    const created = {
      ...task,
      stage: firstStage.code,
      stage_name: firstStage.name,
      stage_responsibility: firstStage.responsibility,
      priority: priorityResult.rows[0].code,
      environment: environmentResult.rows[0].code,
      request_type: typeResult.rows[0].code,
      task_type_name: typeResult.rows[0].name,
      task_category: getTaskCategory(typeResult.rows[0].code),
      project_name: project.name,
      client_name: project.client_name
    };
    await notifyStageChange(created, client);
    await notifyAssignments(created, {}, client);
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listTasks(user, filters) {
  const companyId = user.company_id;
  const conditions = ['t.company_id=$1', 't.deleted_at IS NULL'];
  const values = [companyId];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (!isAdmin(user)) {
    values.push(user.id);
    conditions.push(`(
      ((UPPER(s.code)='ROADMAP' OR LOWER(TRIM(s.name))='roadmap') AND t.created_by=$${values.length})
      OR ((UPPER(s.code)<>'ROADMAP' AND LOWER(TRIM(s.name))<>'roadmap') AND (
        $${values.length}::uuid IN (t.created_by,t.requester_id,t.backend_assignee_id,t.frontend_assignee_id)
        OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=t.company_id AND pr.project_id=t.project_id AND pr.user_id=$${values.length})
      ))
    )`);
  }
  if (filters.state) add('t.state=?', filters.state);
  if (filters.lifecycle === 'open') conditions.push("t.state IN ('ACTIVE','PAUSED')");
  if (filters.lifecycle === 'completed') conditions.push("t.state IN ('COMPLETED','CANCELED')");
  if (filters.stage) add('(s.id::text=? OR s.code=?)', filters.stage);
  if (filters.category) add(`${taskCategorySql('tt')}=?`, filters.category);
  if (filters.priority) add('(p.id::text=? OR p.code=?)', filters.priority);
  if (filters.project_id) add('t.project_id=?', filters.project_id);
  if (filters.assignee) add('?::uuid IN (t.backend_assignee_id,t.frontend_assignee_id)', filters.assignee);
  if (filters.search) add(
    "(t.title ILIKE ? OR ('DF-' || LPAD(t.task_number::text,6,'0')) ILIKE ?)",
    `%${filters.search}%`
  );
  if (filters.overdue) conditions.push(`${filters.overdue === 'true' ? '' : 'NOT '}(
    t.estimated_duration_seconds IS NOT NULL AND t.timer_status NOT IN ('completed','cancelled')
    AND t.estimated_duration_seconds <= t.active_elapsed_seconds
      + CASE WHEN t.timer_status='running' AND t.timer_last_started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-t.timer_last_started_at))::bigint ELSE 0 END
  )`);
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 25));
  const from = `
    FROM tasks t
    JOIN workflow_stages s ON s.id=t.current_stage_id
    JOIN priorities p ON p.id=t.priority_id
    JOIN environments e ON e.id=t.environment_id
    JOIN task_types tt ON tt.id=t.task_type_id
    JOIN projects project ON project.id=t.project_id
    JOIN clients client ON client.id=t.client_id
  `;
  const count = await db.query(
    `SELECT COUNT(*)::integer AS total ${from} WHERE ${conditions.join(' AND ')}`,
    values
  );
  const result = await db.query(
    `SELECT t.*,s.code AS stage,s.name AS stage_name,s.sort_order AS stage_sort_order,
            s.responsibility AS stage_responsibility,
            p.code AS priority,p.name AS priority_name,p.color_token AS priority_color,p.sort_order AS priority_sort_order,
            e.code AS environment,e.name AS environment_name,
            tt.code AS request_type,tt.name AS task_type_name,tt.sort_order AS task_type_sort_order,
            ${taskCategorySql('tt')} AS task_category,
            project.name AS project_name,project.code AS project_code,
            client.name AS client_name,
            requester.name AS requester_name,
            backend.name AS backend_assignee_name,
            frontend.name AS frontend_assignee_name,
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at,CURRENT_TIMESTAMP)-i.started_at)))::bigint
              FROM task_stage_intervals i WHERE i.task_id=t.id
                AND UPPER(i.stage_code_snapshot)<>'ROADMAP'
                AND LOWER(TRIM(i.stage_name_snapshot))<>'roadmap'
            ),0) AS total_seconds,
            (t.active_elapsed_seconds + CASE WHEN t.timer_status='running' AND t.timer_last_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-t.timer_last_started_at))::bigint ELSE 0 END) AS timer_active_seconds,
            CASE WHEN t.estimated_duration_seconds IS NULL THEN NULL ELSE t.estimated_duration_seconds-(t.active_elapsed_seconds + CASE WHEN t.timer_status='running' AND t.timer_last_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-t.timer_last_started_at))::bigint ELSE 0 END) END AS remaining_seconds,
            CASE WHEN t.estimated_duration_seconds IS NULL OR t.timer_status IN ('completed','cancelled') THEN FALSE ELSE t.estimated_duration_seconds<=(t.active_elapsed_seconds + CASE WHEN t.timer_status='running' AND t.timer_last_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-t.timer_last_started_at))::bigint ELSE 0 END) END AS overdue_now
     ${from}
     JOIN users requester ON requester.id=t.requester_id
     JOIN users backend ON backend.id=t.backend_assignee_id
     JOIN users frontend ON frontend.id=t.frontend_assignee_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE
       WHEN UPPER(p.code) IN ('URGENT_PRODUCTION','URGENTE_PRODUCAO') OR UPPER(p.name) IN ('URGENTE PRODUCAO','URGENTE PRODUÇÃO') THEN 1
       WHEN t.kind='BUG' OR UPPER(p.code)='BUG' OR UPPER(p.name)='BUG' THEN 2
       WHEN UPPER(p.code) IN ('CRITICAL','CRITICA') OR UPPER(p.name) IN ('CRITICA','CRÍTICA') THEN 3
       WHEN UPPER(p.code) IN ('HIGH','ALTA') OR UPPER(p.name)='ALTA' THEN 4
       WHEN UPPER(p.code) IN ('MEDIUM','MEDIA') OR UPPER(p.name) IN ('MEDIA','MÉDIA') THEN 5
       WHEN UPPER(p.code) IN ('LOW','BAIXA') OR UPPER(p.name)='BAIXA' THEN 6
       ELSE 7 END,
       t.created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );
  return {
    tasks: result.rows,
    pagination: {
      page,
      limit,
      total: count.rows[0].total,
      total_pages: Math.ceil(count.rows[0].total / limit)
    }
  };
}

async function listTrash(user, filters = {}) {
  assert(isAdmin(user), 'PERMISSION_DENIED', 'Acesso permitido apenas para administradores.', 403);
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 25));
  const values = [user.company_id];
  const conditions = ['t.company_id=$1', 't.deleted_at IS NOT NULL'];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(t.title ILIKE $${values.length} OR ('DF-' || LPAD(t.task_number::text,6,'0')) ILIKE $${values.length})`);
  }
  const from = `FROM tasks t
    JOIN workflow_stages stage ON stage.id=t.current_stage_id AND stage.company_id=t.company_id
    JOIN priorities priority ON priority.id=t.priority_id AND priority.company_id=t.company_id
    JOIN task_types task_type ON task_type.id=t.task_type_id AND task_type.company_id=t.company_id
    JOIN users backend ON backend.id=t.backend_assignee_id
    JOIN users frontend ON frontend.id=t.frontend_assignee_id
    LEFT JOIN users deleted_user ON deleted_user.id=t.deleted_by`;
  const total = Number((await db.query(
    `SELECT COUNT(*) ${from} WHERE ${conditions.join(' AND ')}`,
    values
  )).rows[0].count);
  const result = await db.query(
    `SELECT t.id,t.task_number,t.title,t.kind,t.deleted_at,t.deleted_by,
            stage.code AS stage,stage.name AS stage_name,
            priority.code AS priority,priority.name AS priority_name,
            task_type.code AS request_type,task_type.name AS task_type_name,
            ${taskCategorySql('task_type')} AS task_category,
            backend.name AS backend_assignee_name,frontend.name AS frontend_assignee_name,
            deleted_user.name AS deleted_by_name
     ${from} WHERE ${conditions.join(' AND ')}
     ORDER BY t.deleted_at DESC,t.task_number DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );
  return {
    tasks: result.rows.map((task) => ({ ...task, code: taskCode(task) })),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
  };
}

async function getListPreference(user) {
  const result = await db.query(
    `SELECT grouping
     FROM user_task_list_preferences
     WHERE company_id=$1 AND user_id=$2`,
    [user.company_id, user.id]
  );
  return { grouping: result.rows[0]?.grouping || 'none' };
}

async function saveListPreference(user, grouping) {
  const result = await db.query(
    `INSERT INTO user_task_list_preferences (company_id,user_id,grouping)
     VALUES ($1,$2,$3)
     ON CONFLICT (company_id,user_id) DO UPDATE
     SET grouping=EXCLUDED.grouping,updated_at=CURRENT_TIMESTAMP
     RETURNING grouping`,
    [user.company_id, user.id, grouping]
  );
  return { grouping: result.rows[0].grouping };
}

async function softDeleteTask(req, taskId, confirmation) {
  assert(isAdmin(req.user), 'PERMISSION_DENIED', 'Somente administradores podem excluir tarefas.', 403);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = (await client.query(
      `SELECT t.*,stage.code AS stage,stage.name AS stage_name,stage.tracks_time,stage.completes_task
       FROM tasks t JOIN workflow_stages stage
         ON stage.id=t.current_stage_id AND stage.company_id=t.company_id
       WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NULL
       FOR UPDATE OF t`,
      [taskId, req.user.company_id]
    )).rows[0];
    assert(task, 'TASK_NOT_FOUND', 'Tarefa não encontrada.', 404);
    const code = taskCode(task);
    assert(confirmation === code, 'TASK_DELETE_CONFIRMATION_INVALID', `Digite ${code} para confirmar a exclusão.`, 400);
    const timerSnapshot = timing.timingSnapshot(task);
    await addEvent(client, req, task.id, 'task_deleted', `${code} movida para a lixeira.`, {}, {
      deleted_by: req.user.id,
      previous_stage_id: task.current_stage_id
    });
    await client.query(
      `UPDATE task_stage_touch_sessions
       SET ended_at=CURRENT_TIMESTAMP,
           active_seconds=GREATEST(0,EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-started_at))::bigint),
           end_reason='TASK_DELETED'
       WHERE company_id=$1 AND task_id=$2 AND ended_at IS NULL`,
      [req.user.company_id, task.id]
    );
    await client.query(
      `UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND task_id=$2 AND ended_at IS NULL`,
      [req.user.company_id, task.id]
    );
    const deleted = (await client.query(
      `UPDATE tasks SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$3,
         active_elapsed_seconds=CASE WHEN timer_status='running' THEN $4 ELSE active_elapsed_seconds END,
         timer_status=CASE WHEN timer_status='running' THEN 'paused' ELSE timer_status END,
         timer_last_started_at=CASE WHEN timer_status='running' THEN NULL ELSE timer_last_started_at END,
         timer_paused_at=CASE WHEN timer_status='running' THEN CURRENT_TIMESTAMP ELSE timer_paused_at END,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL RETURNING *`,
      [task.id, req.user.company_id, req.user.id, timerSnapshot.active_elapsed_seconds]
    )).rows[0];
    await recordAudit({
      req, operation: 'task_deleted', entityType: 'TASK', entityId: task.id,
      previousValues: { deleted_at: null, stage_id: task.current_stage_id },
      newValues: { deleted_at: deleted.deleted_at, deleted_by: req.user.id },
      queryable: client, strict: true
    });
    await client.query('COMMIT');
    await refreshTrashMetrics(req.user.company_id);
    return { ...deleted, code, stage: task.stage, stage_name: task.stage_name };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function restoreTask(req, taskId) {
  assert(isAdmin(req.user), 'PERMISSION_DENIED', 'Somente administradores podem restaurar tarefas.', 403);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = (await client.query(
      `SELECT t.*,stage.code AS stage,stage.name AS stage_name,stage.tracks_time,stage.completes_task
       FROM tasks t JOIN workflow_stages stage
         ON stage.id=t.current_stage_id AND stage.company_id=t.company_id
       WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NOT NULL
       FOR UPDATE OF t`,
      [taskId, req.user.company_id]
    )).rows[0];
    assert(task, 'TASK_NOT_FOUND', 'Tarefa não encontrada na lixeira.', 404);
    const reopensStage = task.state === 'ACTIVE' && stageTracksTime(task);
    const restored = (await client.query(
      `UPDATE tasks SET deleted_at=NULL,deleted_by=NULL,updated_at=CURRENT_TIMESTAMP,
         current_stage_entered_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE current_stage_entered_at END
       WHERE id=$1 AND company_id=$2 AND deleted_at IS NOT NULL RETURNING *`,
      [task.id, req.user.company_id, reopensStage]
    )).rows[0];
    if (reopensStage) {
      await client.query(
        `INSERT INTO task_stage_intervals (
           company_id,task_id,stage_id,stage_code_snapshot,stage_name_snapshot,started_at
         ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
        [req.user.company_id, task.id, task.current_stage_id, task.stage, task.stage_name]
      );
    }
    const code = taskCode(task);
    await addEvent(client, req, task.id, 'task_restored', `${code} restaurada da lixeira.`, {
      deleted_at: task.deleted_at,
      deleted_by: task.deleted_by
    }, { deleted_at: null, deleted_by: null });
    await recordAudit({
      req, operation: 'task_restored', entityType: 'TASK', entityId: task.id,
      previousValues: { deleted_at: task.deleted_at, deleted_by: task.deleted_by },
      newValues: { deleted_at: null, deleted_by: null }, queryable: client, strict: true
    });
    await client.query('COMMIT');
    await refreshTrashMetrics(req.user.company_id);
    return { ...restored, code, stage: task.stage, stage_name: task.stage_name };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function emptyTrash(req, confirmation) {
  assert(req.user?.is_super_admin === true, 'SUPER_ADMIN_REQUIRED', 'Ação permitida apenas para o Super Admin.', 403);
  assert(confirmation === 'ESVAZIAR LIXEIRA', 'TASK_TRASH_CONFIRMATION_INVALID', 'Confirmação da lixeira inválida.', 400);
  const client = await db.pool.connect();
  let quarantined = null;
  try {
    await client.query('BEGIN');
    const trashed = (await client.query(
      `SELECT id,task_number,title,deleted_at,deleted_by FROM tasks
       WHERE company_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at FOR UPDATE`,
      [req.user.company_id]
    )).rows;
    if (!trashed.length) {
      await client.query('COMMIT');
      return { permanently_deleted: 0 };
    }
    const ids = trashed.map((task) => task.id);
    const attachmentKeys = (await client.query(
      'SELECT storage_key FROM task_attachments WHERE company_id=$1 AND task_id=ANY($2::uuid[])',
      [req.user.company_id, ids]
    )).rows.map((item) => item.storage_key);
    quarantined = await taskPurgeStorage.quarantine(attachmentKeys);
    for (const task of trashed) {
      await recordAudit({
        req, operation: 'task_permanently_deleted', entityType: 'TASK', entityId: task.id,
        previousValues: { task_number: task.task_number, deleted_at: task.deleted_at, deleted_by: task.deleted_by },
        newValues: { permanently_deleted: true }, queryable: client, strict: true
      });
    }
    await recordAudit({
      req, operation: 'task_trash_emptied', entityType: 'TASK_TRASH', entityId: null,
      newValues: { permanently_deleted: trashed.length, task_ids: ids }, queryable: client, strict: true
    });
    await client.query("SET LOCAL devflow.task_purge = 'enabled'");
    await client.query(
      `UPDATE tasks SET related_task_id=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND related_task_id=ANY($2::uuid[]) AND NOT (id=ANY($2::uuid[]))`,
      [req.user.company_id, ids]
    );
    await client.query(
      `DELETE FROM email_outbox WHERE notification_id IN (
         SELECT id FROM notifications WHERE company_id=$1 AND task_id=ANY($2::uuid[])
       )`, [req.user.company_id, ids]
    );
    for (const table of [
      'task_attachments', 'task_github_metadata', 'notifications',
      'task_stage_touch_sessions', 'task_timer_events', 'task_stage_submissions',
      'task_stage_intervals', 'task_approvals', 'task_tests', 'task_comments', 'task_events'
    ]) {
      await client.query(`DELETE FROM ${table} WHERE company_id=$1 AND task_id=ANY($2::uuid[])`, [req.user.company_id, ids]);
    }
    await client.query('DELETE FROM tasks WHERE company_id=$1 AND id=ANY($2::uuid[])', [req.user.company_id, ids]);
    await client.query(
      `UPDATE metric_refresh_state SET status='IDLE',error_code=NULL
       WHERE company_id=$1 AND status<>'RUNNING'`,
      [req.user.company_id]
    );
    await client.query('COMMIT');
    await quarantined.finalize().catch((error) => safeLogError('Falha ao limpar quarentena de anexos expurgados.', error));
    await refreshTrashMetrics(req.user.company_id);
    return { permanently_deleted: trashed.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await quarantined?.rollback().catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getTask(taskId, companyId, queryable = db, user = null) {
  const task = (await queryable.query(
    `SELECT t.*,s.code AS stage,s.name AS stage_name,s.responsibility,s.requirements,
            s.tracks_time,s.completes_task,
            p.code AS priority,p.name AS priority_name,p.color_token AS priority_color,
            e.code AS environment,e.name AS environment_name,
            tt.code AS request_type,tt.name AS task_type_name,
            ${taskCategorySql('tt')} AS task_category,
            project.name AS project_name,project.code AS project_code,
            client.name AS client_name,
            requester.name AS requester_name,
            backend.name AS backend_assignee_name,
            frontend.name AS frontend_assignee_name
     FROM tasks t
     JOIN workflow_stages s ON s.id=t.current_stage_id
     JOIN priorities p ON p.id=t.priority_id
     JOIN environments e ON e.id=t.environment_id
     JOIN task_types tt ON tt.id=t.task_type_id
     JOIN projects project ON project.id=t.project_id
     JOIN clients client ON client.id=t.client_id
     JOIN users requester ON requester.id=t.requester_id
     JOIN users backend ON backend.id=t.backend_assignee_id
     JOIN users frontend ON frontend.id=t.frontend_assignee_id
     WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NULL`,
    [taskId, companyId]
  )).rows[0];
  assert(task, 'TASK_NOT_FOUND', 'Tarefa não encontrada.', 404);
  if (user) assert(await canViewTask(user, task, queryable), 'TASK_NOT_FOUND', 'Tarefa não encontrada.', 404);
  return task;
}

async function getTaskDetail(taskId, user) {
  const companyId = user.company_id;
  const task = await getTask(taskId, companyId, db, user);
  const [tests, approvals, github, comments, attachments, events, submissions, intervals, stages, relatedBugs, timerEvents, touchByUser] = await Promise.all([
    db.query(
      `SELECT test.*,stage.code AS stage,stage.name AS stage_name,u.name AS created_by_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes,
                'description',a.description,'source_section',a.source_section,'created_at',a.created_at
              ) ORDER BY a.created_at) FROM task_attachments a
              WHERE a.test_id=test.id AND a.deleted_at IS NULL),'[]'::jsonb) AS attachments
       FROM task_tests test JOIN workflow_stages stage ON stage.id=test.stage_id
       JOIN users u ON u.id=test.author_id
       WHERE test.task_id=$1 AND test.company_id=$2 AND test.deleted_at IS NULL
       ORDER BY test.created_at DESC`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT approval.*,stage.code AS stage,stage.name AS stage_name,u.name AS created_by_name
       FROM task_approvals approval JOIN workflow_stages stage ON stage.id=approval.stage_id
       JOIN users u ON u.id=approval.created_by
       WHERE approval.task_id=$1 AND approval.company_id=$2 ORDER BY approval.created_at DESC`,
      [taskId, companyId]
    ),
    db.query(`SELECT github.*,author.name AS author_name,stage.name AS stage_name,stage.code AS stage_code
      FROM task_github_metadata github
      JOIN users author ON author.id=github.author_id
      LEFT JOIN workflow_stages stage ON stage.id=github.stage_id
      WHERE github.task_id=$1 AND github.company_id=$2 AND github.deleted_at IS NULL
      ORDER BY github.created_at DESC,github.id DESC`, [taskId, companyId]),
    db.query(
      `SELECT comment.*,u.name AS created_by_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes,
                'description',a.description,'source_section',a.source_section,'created_at',a.created_at
              ) ORDER BY a.created_at) FROM task_attachments a
              WHERE a.comment_id=comment.id AND a.deleted_at IS NULL),'[]'::jsonb) AS attachments
       FROM task_comments comment JOIN users u ON u.id=comment.created_by
       WHERE comment.task_id=$1 AND comment.company_id=$2 ORDER BY comment.created_at`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT attachment.id,attachment.original_name,attachment.mime_type,attachment.size_bytes,
              attachment.description,attachment.source_section,attachment.created_at,u.name AS created_by_name
       FROM task_attachments attachment JOIN users u ON u.id=attachment.created_by
       WHERE attachment.task_id=$1 AND attachment.company_id=$2 AND attachment.deleted_at IS NULL
       ORDER BY attachment.created_at DESC`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT event.*,u.name AS actor_name
       FROM task_events event JOIN users u ON u.id=event.actor_id
       WHERE event.task_id=$1 AND event.company_id=$2
       ORDER BY event.created_at DESC,event.id DESC`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT submission.*,stage.code AS stage,stage.name AS stage_name
       FROM task_stage_submissions submission
       JOIN workflow_stages stage ON stage.id=submission.stage_id
       WHERE submission.task_id=$1 AND submission.company_id=$2`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT stage_id,stage_code_snapshot AS stage,stage_name_snapshot AS stage_name,
              started_at,ended_at,
              EXTRACT(EPOCH FROM (COALESCE(ended_at,CURRENT_TIMESTAMP)-started_at))::bigint AS seconds
       FROM task_stage_intervals WHERE task_id=$1 AND company_id=$2 ORDER BY started_at`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT * FROM workflow_stages
       WHERE workflow_id=$1 AND company_id=$2 AND is_active=TRUE ORDER BY sort_order`,
      [task.workflow_id, companyId]
    ),
    db.query(
      `SELECT related.id,related.task_number,related.title,related.state FROM tasks related
       JOIN workflow_stages rs ON rs.id=related.current_stage_id
       WHERE related.related_task_id=$1 AND related.company_id=$2 AND related.deleted_at IS NULL
        AND ($3::boolean
          OR ((UPPER(rs.code)='ROADMAP' OR LOWER(TRIM(rs.name))='roadmap') AND related.created_by=$4)
          OR ((UPPER(rs.code)<>'ROADMAP' AND LOWER(TRIM(rs.name))<>'roadmap') AND (
            $4::uuid IN (related.created_by,related.requester_id,related.backend_assignee_id,related.frontend_assignee_id)
            OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=related.company_id AND pr.project_id=related.project_id AND pr.user_id=$4)
          ))) ORDER BY related.created_at`,
      [taskId, companyId, isAdmin(user), user.id]
    ),
    db.query(
      `SELECT event.*,u.name AS actor_name,stage.code AS stage,stage.name AS stage_name
       FROM task_timer_events event
       JOIN users u ON u.id=event.actor_id
       LEFT JOIN workflow_stages stage ON stage.id=event.stage_id AND stage.company_id=event.company_id
       WHERE event.task_id=$1 AND event.company_id=$2 ORDER BY event.created_at DESC,event.id DESC`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT session.user_id,u.name AS user_name,
              COALESCE(SUM(
                session.active_seconds
                + CASE WHEN session.ended_at IS NULL
                    THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-session.started_at))::bigint
                    ELSE 0 END
              ),0)::bigint AS active_seconds,
              BOOL_OR(session.ended_at IS NULL) AS is_running
       FROM task_stage_touch_sessions session
       JOIN users u ON u.id=session.user_id
       WHERE session.task_id=$1 AND session.company_id=$2 AND session.stage_id=$3
       GROUP BY session.user_id,u.name
       ORDER BY active_seconds DESC,u.name`,
      [taskId, companyId, task.current_stage_id]
    )
  ]);
  const measuredIntervals = intervals.rows.filter((item) => !isRoadmap({
    stage: item.stage,
    stage_name: item.stage_name
  }));
  const totalSeconds = measuredIntervals.reduce((sum, item) => sum + Number(item.seconds), 0);
  const currentStageSeconds = measuredIntervals
    .filter((item) => item.stage_id === task.current_stage_id)
    .reduce((sum, item) => sum + Number(item.seconds), 0);
  const currentStage = stages.rows.find((stage) => stage.id === task.current_stage_id);
  const context = {
    submission: submissions.rows.find((item) => item.stage_id === task.current_stage_id),
    tests: tests.rows,
    approvals: approvals.rows,
    github: github.rows[0]
  };
  return {
    task: {
      ...task,
      code: taskCode(task),
      total_seconds: totalSeconds,
      current_stage_seconds: currentStageSeconds,
      missing_requirements: workflow.missingRequirements(task, context, currentStage),
      ...timing.timingSnapshot(task)
    },
    tests: tests.rows,
    approvals: approvals.rows,
    github: github.rows[0] || null,
    github_cards: github.rows,
    comments: comments.rows,
    attachments: attachments.rows,
    events: events.rows,
    submissions: submissions.rows,
    intervals: intervals.rows,
    related_bugs: relatedBugs.rows,
    workflow: stages.rows.map((stageItem) => stageItem.code),
    workflow_stages: stages.rows,
    timer_events: timerEvents.rows,
    stage_touch_by_user: touchByUser.rows.map((item) => ({
      ...item,
      active_seconds: Number(item.active_seconds)
    }))
  };
}

async function loadTransitionContext(client, task) {
  const [submission, tests, approvals, github] = await Promise.all([
    client.query(
      `SELECT * FROM task_stage_submissions
       WHERE task_id=$1 AND company_id=$2 AND stage_id=$3`,
      [task.id, task.company_id, task.current_stage_id]
    ),
    client.query(
      'SELECT * FROM task_tests WHERE task_id=$1 AND company_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC',
      [task.id, task.company_id]
    ),
    client.query(
      'SELECT * FROM task_approvals WHERE task_id=$1 AND company_id=$2 ORDER BY created_at DESC',
      [task.id, task.company_id]
    ),
    client.query(
      'SELECT * FROM task_github_metadata WHERE task_id=$1 AND company_id=$2 AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1',
      [task.id, task.company_id]
    )
  ]);
  return {
    submission: submission.rows[0],
    tests: tests.rows,
    approvals: approvals.rows,
    github: github.rows[0]
  };
}

async function transitionTask(req, taskId, targetStageValue, reason) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  let updated;
  try {
    await client.query('BEGIN');
    const task = await getTask(taskId, companyId, client, req.user);
    const locked = (await client.query(
      'SELECT * FROM tasks WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [taskId, companyId]
    )).rows[0];
    Object.assign(task, locked);
    assert(task.state === 'ACTIVE', 'TASK_NOT_ACTIVE', 'A tarefa precisa estar ativa para mudar de etapa.', 409);
    const stages = await loadStages(client, companyId, task.workflow_id);
    const currentStage = stages.find((item) => item.id === task.current_stage_id);
    const targetStage = stages.find((item) => item.id === targetStageValue || item.code === targetStageValue);
    assert(targetStage, 'TRANSITION_INVALID', 'Etapa de destino inválida.', 409);
    const direction = workflow.transitionDirection(task, targetStage.id, stages);
    assert(direction !== 'INVALID', 'TRANSITION_INVALID', 'Transição de etapa inválida.', 409);
    assert(
      workflow.canOperateStage(req.user, task, currentStage),
      'TRANSITION_FORBIDDEN',
      'Você não é responsável por esta etapa.',
      403
    );
    if (direction === 'FORWARD') {
      const missing = workflow.missingRequirements(
        task,
        await loadTransitionContext(client, task),
        currentStage
      );
      assert(!missing.length, 'STAGE_REQUIREMENTS_MISSING', 'Preencha os requisitos antes de avançar.', 409, missing);
    } else {
      assert(
        hasPermission(req.user, 'tasks.manage') || req.user.profiles?.includes('MANAGER'),
        'TRANSITION_FORBIDDEN',
        'Somente administradores ou gestores podem retroceder etapas.',
        403
      );
      assert(String(reason || '').trim().length >= 5, 'TRANSITION_REASON_REQUIRED', 'Informe o motivo do retrocesso.');
    }
    const timerBeforeTransition = timing.timingSnapshot(task);
    await timing.closeActiveTouchSessions(client, {
      companyId,
      taskId,
      stageId: currentStage.id,
      endReason: 'STAGE_TRANSITION'
    });
    await client.query(
      `UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP
       WHERE task_id=$1 AND company_id=$2 AND ended_at IS NULL`,
      [taskId, companyId]
    );
    const tracksTargetTime = stageTracksTime(targetStage);
    const startsNow = !task.started_at && tracksTargetTime;
    updated = (await client.query(
      `UPDATE tasks SET
         current_stage_id=$3,
         current_stage_entered_at=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END,
         state=CASE WHEN $4 THEN 'COMPLETED' ELSE state END,
         started_at=CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE started_at END,
         completed_at=CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE completed_at END,
         active_elapsed_seconds=0,
         paused_elapsed_seconds=0,
         timer_status=CASE WHEN $4 THEN 'completed' ELSE 'not_started' END,
         timer_last_started_at=NULL,
         timer_paused_at=NULL,
         timer_ended_at=CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE NULL END,
         timer_started_by=NULL,
         timer_paused_by=NULL,
         timer_resumed_by=NULL,
         is_overdue=FALSE,
         rework_count=rework_count+CASE WHEN $6 THEN 1 ELSE 0 END,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [taskId, companyId, targetStage.id, targetStage.completes_task, startsNow, direction === 'BACKWARD', tracksTargetTime]
    )).rows[0];
    if (tracksTargetTime) {
      await client.query(
        `INSERT INTO task_stage_intervals (
           company_id,task_id,stage_id,stage_code_snapshot,stage_name_snapshot,started_at
         ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
        [companyId, taskId, targetStage.id, targetStage.code, targetStage.name]
      );
    }
    await addEvent(
      client,
      req,
      taskId,
      direction === 'FORWARD' ? 'STAGE_ADVANCED' : 'STAGE_RETURNED',
      `${currentStage.name} → ${targetStage.name}${reason ? `: ${reason}` : ''}`,
      { stage_id: currentStage.id, stage: currentStage.code, state: task.state },
      { stage_id: targetStage.id, stage: targetStage.code, state: updated.state }
    );
    if (['running', 'paused'].includes(task.timer_status)) {
      await client.query(
        `INSERT INTO task_timer_events (
           company_id,task_id,stage_id,event_type,actor_id,previous_status,new_status,
           new_estimate_seconds,active_elapsed_seconds
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          companyId, taskId, currentStage.id,
          targetStage.completes_task ? 'COMPLETED' : 'PAUSED', req.user.id,
          task.timer_status, targetStage.completes_task ? 'completed' : 'not_started',
          task.estimated_duration_seconds, timerBeforeTransition.active_elapsed_seconds
        ]
      );
    }
    updated = {
      ...updated,
      stage: targetStage.code,
      stage_name: targetStage.name,
      stage_responsibility: targetStage.responsibility,
      current_stage_id: targetStage.id
    };
    await notifyStageChange(updated, client);
    if (isRoadmap(task) && !isRoadmap(updated)) await notifyAssignments(updated, {}, client);
    if (targetStage.completes_task) await notifyCompleted(updated, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return updated;
}

async function setTaskState(req, taskId, action, reason) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = (await client.query(
      'SELECT * FROM tasks WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [taskId, companyId]
    )).rows[0];
    assert(task, 'TASK_NOT_FOUND', 'Tarefa não encontrada.', 404);
    assert(hasPermission(req.user, 'tasks.manage'), 'PERMISSION_DENIED', 'Ação não permitida.', 403);
    assert(String(reason || '').trim().length >= 5, 'TASK_REASON_REQUIRED', 'Informe um motivo com pelo menos 5 caracteres.');
    const currentStageForState = (await client.query(
      'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
      [task.current_stage_id, companyId]
    )).rows[0];
    const timerBeforeState = timing.timingSnapshot(task);
    let nextState;
    if (action === 'pause') {
      assert(task.state === 'ACTIVE', 'TASK_STATE_INVALID', 'Somente tarefas ativas podem ser pausadas.', 409);
      nextState = 'PAUSED';
    } else if (action === 'reopen') {
      assert(['PAUSED', 'CANCELED', 'COMPLETED'].includes(task.state), 'TASK_STATE_INVALID', 'A tarefa não pode ser reaberta.', 409);
      nextState = 'ACTIVE';
      const currentStage = (await client.query(
        'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
        [task.current_stage_id, companyId]
      )).rows[0];
      if (stageTracksTime(currentStage) && task.state !== 'PAUSED') {
        await client.query(
          `INSERT INTO task_stage_intervals (
             company_id,task_id,stage_id,stage_code_snapshot,stage_name_snapshot,started_at
           ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
          [companyId, taskId, currentStage.id, currentStage.code, currentStage.name]
        );
      }
    } else if (action === 'cancel') {
      assert(!['CANCELED', 'COMPLETED'].includes(task.state), 'TASK_STATE_INVALID', 'A tarefa não pode ser cancelada.', 409);
      nextState = 'CANCELED';
      await client.query(
        `UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP
         WHERE task_id=$1 AND company_id=$2 AND ended_at IS NULL`,
        [taskId, companyId]
      );
    } else {
      throw new AppError('TASK_ACTION_INVALID', 'Ação administrativa inválida.');
    }
    if (['pause', 'cancel'].includes(action)) {
      await timing.closeActiveTouchSessions(client, {
        companyId,
        taskId,
        stageId: task.current_stage_id,
        endReason: action === 'pause' ? 'TASK_PAUSED' : 'TASK_CANCELLED'
      });
    }
    const updated = (await client.query(
      `UPDATE tasks SET state=$3,
         paused_at=CASE WHEN $3='PAUSED' THEN CURRENT_TIMESTAMP ELSE NULL END,
         canceled_at=CASE WHEN $3='CANCELED' THEN CURRENT_TIMESTAMP WHEN $3='ACTIVE' THEN NULL ELSE canceled_at END,
         completed_at=CASE WHEN $3='ACTIVE' THEN NULL ELSE completed_at END,
         current_stage_entered_at=CASE WHEN $3='CANCELED' THEN NULL WHEN $3='ACTIVE' AND $5 AND $6<>'PAUSED' THEN CURRENT_TIMESTAMP ELSE current_stage_entered_at END,
         active_elapsed_seconds=CASE WHEN $3 IN ('PAUSED','CANCELED') AND timer_status='running' THEN $4 ELSE active_elapsed_seconds END,
         timer_status=CASE WHEN $3='CANCELED' AND timer_status NOT IN ('completed','cancelled') THEN 'cancelled' WHEN $3='PAUSED' AND timer_status='running' THEN 'paused' WHEN $3='ACTIVE' AND timer_status IN ('cancelled','completed') THEN 'not_started' ELSE timer_status END,
         timer_last_started_at=CASE WHEN $3 IN ('PAUSED','CANCELED') THEN NULL ELSE timer_last_started_at END,
         timer_paused_at=CASE WHEN $3='PAUSED' AND timer_status='running' THEN CURRENT_TIMESTAMP WHEN $3='ACTIVE' THEN NULL ELSE timer_paused_at END,
         timer_ended_at=CASE WHEN $3='CANCELED' AND timer_status<>'not_started' THEN CURRENT_TIMESTAMP WHEN $3='ACTIVE' THEN NULL ELSE timer_ended_at END,
         is_overdue=CASE WHEN $3='CANCELED' THEN FALSE ELSE is_overdue END,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [taskId, companyId, nextState, timerBeforeState.active_elapsed_seconds, stageTracksTime(currentStageForState), task.state]
    )).rows[0];
    await addEvent(client, req, taskId, `TASK_${action.toUpperCase()}`, reason, { state: task.state }, { state: nextState });
    if (action === 'cancel' && !['not_started', 'completed', 'cancelled'].includes(task.timer_status)) {
      await client.query(`INSERT INTO task_timer_events (company_id,task_id,stage_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,$3,'CANCELLED',$4,$5,'cancelled',$6,$7)`, [companyId, taskId, task.current_stage_id, req.user.id, task.timer_status, task.estimated_duration_seconds, timerBeforeState.active_elapsed_seconds]);
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AppError) throw error;
    if (error?.code === '22P02') {
      throw new AppError('TASK_ID_INVALID', 'Identificador da tarefa invalido.', 400);
    }
    if (['23502', '23503', '23505', '23514', '40001', '40P01'].includes(error?.code)) {
      throw new AppError(
        'TASK_STATE_CONFLICT',
        'Nao foi possivel alterar o estado da tarefa no estado atual.',
        409
      );
    }
    console.error('[DevFlow task state] Falha interna sanitizada.', {
      code: String(error?.code || 'UNKNOWN').slice(0, 40),
      request_id: req.requestId || null,
      action
    });
    throw new AppError('TASK_STATE_UPDATE_FAILED', 'Erro interno ao atualizar estado', 500);
  } finally {
    client.release();
  }
}

async function updateAdministration(req, taskId, payload) {
  const companyId = req.user.company_id;
  assert(hasPermission(req.user, 'tasks.manage'), 'PERMISSION_DENIED', 'Ação não permitida.', 403);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const before = await getTask(taskId, companyId, client, req.user);
    const assignees = [payload.backend_assignee_id, payload.frontend_assignee_id].filter(Boolean);
    if (assignees.length) {
      const validUsers = await client.query(
        `SELECT user_id FROM company_memberships
         WHERE company_id=$1 AND user_id=ANY($2::uuid[]) AND is_active=TRUE`,
        [companyId, assignees]
      );
      assert(validUsers.rowCount === new Set(assignees).size, 'TASK_USER_INVALID', 'Responsável inválido.');
    }
    if (payload.priority_id) {
      const priority = await client.query(
        'SELECT 1 FROM priorities WHERE id=$1 AND company_id=$2 AND is_active=TRUE',
        [payload.priority_id, companyId]
      );
      assert(priority.rowCount, 'PRIORITY_INVALID', 'Prioridade inválida.');
    }
    const timerSnapshot = timing.timingSnapshot(before);
    const overdueAfterEstimate = payload.estimated_duration_seconds !== undefined
      ? timerSnapshot.active_elapsed_seconds >= payload.estimated_duration_seconds
      : before.is_overdue;
    const updated = (await client.query(
      `UPDATE tasks SET priority_id=COALESCE($3,priority_id),
         backend_assignee_id=COALESCE($4,backend_assignee_id),
         frontend_assignee_id=COALESCE($5,frontend_assignee_id),
         estimated_duration_seconds=COALESCE($6,estimated_duration_seconds),
         is_overdue=$7,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [
        taskId, companyId, payload.priority_id,
        payload.backend_assignee_id, payload.frontend_assignee_id,
        payload.estimated_duration_seconds, overdueAfterEstimate
      ]
    )).rows[0];
    await addEvent(
      client,
      req,
      taskId,
      'TASK_ADMIN_UPDATED',
      'Dados administrativos alterados.',
      {
        priority_id: before.priority_id,
        backend_assignee_id: before.backend_assignee_id,
        frontend_assignee_id: before.frontend_assignee_id,
        estimated_duration_seconds: before.estimated_duration_seconds
      },
      payload
    );
    if (payload.estimated_duration_seconds !== undefined) {
      await client.query(
        `INSERT INTO task_timer_events (
           company_id,task_id,stage_id,event_type,actor_id,previous_status,new_status,
           previous_estimate_seconds,new_estimate_seconds,active_elapsed_seconds
         ) VALUES ($1,$2,$3,'ESTIMATE_CHANGED',$4,$5,$5,$6,$7,$8)`,
        [companyId, taskId, before.current_stage_id, req.user.id, before.timer_status, before.estimated_duration_seconds, payload.estimated_duration_seconds, timerSnapshot.active_elapsed_seconds]
      );
    }
    const notificationTask = {
      ...updated,
      stage: before.stage,
      stage_name: before.stage_name,
      stage_responsibility: before.stage_responsibility
    };
    await notifyAssignments(notificationTask, before, client);
    if (overdueAfterEstimate && !before.is_overdue) await notifyOverdue(notificationTask, client);
    await client.query('COMMIT');
    return { ...updated, became_overdue: overdueAfterEstimate && !before.is_overdue };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveSubmission(req, taskId, payload) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = await getTask(taskId, companyId, client, req.user);
    const stage = (await client.query(
      'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
      [task.current_stage_id, companyId]
    )).rows[0];
    assert(workflow.canOperateStage(req.user, task, stage), 'STAGE_FORBIDDEN', 'Você não é responsável por esta etapa.', 403);
    const submission = (await client.query(
      `INSERT INTO task_stage_submissions (
         company_id,task_id,stage_id,technical_notes,observations,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (task_id,stage_id) DO UPDATE SET
         technical_notes=EXCLUDED.technical_notes,observations=EXCLUDED.observations,
         updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [
        companyId, taskId, stage.id, payload.technical_notes || null,
        payload.observations || null, req.user.id
      ]
    )).rows[0];
    await addEvent(client, req, taskId, 'STAGE_SUBMISSION_SAVED', `Entrega técnica salva em ${stage.name}.`, {}, {
      stage_id: stage.id
    });
    await client.query('COMMIT');
    return { ...submission, stage: stage.code, stage_name: stage.name };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function addTest(req, taskId, payload) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = await getTask(taskId, companyId, client, req.user);
    const stage = (await client.query(
      'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
      [task.current_stage_id, companyId]
    )).rows[0];
    assert(workflow.canOperateStage(req.user, task, stage), 'STAGE_FORBIDDEN', 'Você não é responsável por esta etapa.', 403);
    const test = (await client.query(
      `INSERT INTO task_tests (
         company_id,task_id,stage_id,description,result,evidence,
         tested_as_super_admin,tested_as_admin,tested_as_user,created_by,
         author_id,context,validated_profiles,environment,backend_info,frontend_info,testing_notes,status
       ) VALUES ($1,$2,$3,$4,$5,$6,FALSE,FALSE,FALSE,$7,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        companyId, taskId, stage.id, payload.context,
        payload.status === 'APPROVED' ? 'PASSED' : 'FAILED', payload.testing_notes || null,
        req.user.id, payload.context, payload.validated_profiles, payload.environment,
        payload.backend_info, payload.frontend_info, payload.testing_notes, payload.status
      ]
    )).rows[0];
    await addEvent(client, req, taskId, 'TASK_TEST_ADDED', `Teste ${stage.name}: ${payload.status}.`, {}, {
      test_id: test.id,
      stage_id: stage.id,
      status: test.status
    });
    await client.query('COMMIT');
    return { ...test, stage: stage.code, stage_name: stage.name };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function canChangeTest(user, test) {
  return isAdmin(user) || user?.profiles?.includes('MANAGER') || test.author_id === user?.id;
}

async function updateTest(req, taskId, testId, payload) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await getTask(taskId, companyId, client, req.user);
    const current = (await client.query(
      `SELECT * FROM task_tests
       WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL
       FOR UPDATE`,
      [testId, taskId, companyId]
    )).rows[0];
    assert(current, 'TEST_NOT_FOUND', 'Teste nao encontrado.', 404);
    assert(canChangeTest(req.user, current), 'TEST_UPDATE_FORBIDDEN', 'Voce nao pode editar este teste.', 403);
    const updated = (await client.query(
      `UPDATE task_tests SET
         description=$4,result=$5,evidence=$6,context=$4,validated_profiles=$7,
         environment=$8,backend_info=$9,frontend_info=$10,testing_notes=$11,status=$12,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND task_id=$2 AND company_id=$3
       RETURNING *`,
      [testId, taskId, companyId, payload.context,
        payload.status === 'APPROVED' ? 'PASSED' : 'FAILED', payload.testing_notes || null,
        payload.validated_profiles, payload.environment, payload.backend_info,
        payload.frontend_info, payload.testing_notes, payload.status]
    )).rows[0];
    await addEvent(client, req, taskId, 'TASK_TEST_UPDATED', 'Registro de teste atualizado.', {
      test_id: current.id,
      status: current.status
    }, { test_id: updated.id, status: updated.status });
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function softDeleteTest(req, taskId, testId) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await getTask(taskId, companyId, client, req.user);
    const current = (await client.query(
      `SELECT * FROM task_tests
       WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL
       FOR UPDATE`,
      [testId, taskId, companyId]
    )).rows[0];
    assert(current, 'TEST_NOT_FOUND', 'Teste nao encontrado.', 404);
    assert(canChangeTest(req.user, current), 'TEST_DELETE_FORBIDDEN', 'Voce nao pode excluir este teste.', 403);
    await client.query(
      `UPDATE task_tests SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$4,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND task_id=$2 AND company_id=$3`,
      [testId, taskId, companyId, req.user.id]
    );
    await addEvent(client, req, taskId, 'TASK_TEST_REMOVED', 'Registro de teste removido logicamente.', {
      test_id: current.id,
      status: current.status
    }, {});
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function addApproval(req, taskId, payload) {
  const companyId = req.user.company_id;
  assert(
    hasPermission(req.user, 'tasks.manage') || req.user.profiles?.includes('MANAGER'),
    'APPROVAL_FORBIDDEN',
    'Somente administradores ou gestores podem aprovar.',
    403
  );
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = await getTask(taskId, companyId, client, req.user);
    const stage = (await client.query(
      'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
      [task.current_stage_id, companyId]
    )).rows[0];
    assert(stage.requirements?.approval, 'APPROVAL_CONTEXT_INVALID', 'A etapa atual não exige aprovação.', 409);
    const approval = (await client.query(
      `INSERT INTO task_approvals (
         company_id,task_id,stage_id,decision,notes,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [companyId, taskId, stage.id, payload.decision, payload.notes, req.user.id]
    )).rows[0];
    await addEvent(client, req, taskId, 'TASK_APPROVAL_ADDED', `${stage.name}: ${payload.decision}.`, {}, {
      approval_id: approval.id,
      stage_id: stage.id,
      decision: approval.decision
    });
    await client.query('COMMIT');
    return { ...approval, stage: stage.code, stage_name: stage.name };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveGithub(req, taskId, payload, cardId = null) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const task = await getTask(taskId, companyId, client, req.user);
    const stage = (await client.query(
      'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
      [task.current_stage_id, companyId]
    )).rows[0];
    assert(workflow.canOperateStage(req.user, task, stage), 'STAGE_FORBIDDEN', 'Você não é responsável por esta etapa.', 403);
    let before = {};
    let github;
    if (cardId) {
      before = (await client.query(
        'SELECT * FROM task_github_metadata WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL FOR UPDATE',
        [cardId, taskId, companyId]
      )).rows[0];
      assert(before, 'GITHUB_CARD_NOT_FOUND', 'Registro GitHub nao encontrado.', 404);
      const value = (field) => Object.prototype.hasOwnProperty.call(payload, field) ? payload[field] : before[field];
      github = (await client.query(
        `UPDATE task_github_metadata SET
           technical_area=$4,title=$5,repository_url=$6,branch=$7,commit_sha=$8,pull_request_url=$9,
           release=$10,notes_code=$11,file_name=$12,language=$13,code_content=$14,
           explanation=$15,updated_by=$16,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL RETURNING *`,
        [cardId, taskId, companyId, value('technical_area'), value('title'), value('repository_url'), value('branch'),
          value('commit_sha'), value('pull_request_url'), value('release'), value('notes_code'),
          value('file_name'), value('language'), value('code_content'), value('explanation'), req.user.id]
      )).rows[0];
    } else {
      const title = payload.title || payload.file_name || 'Anotacao GitHub';
      github = (await client.query(
        `INSERT INTO task_github_metadata (
           company_id,task_id,technical_area,title,repository_url,branch,commit_sha,pull_request_url,
           release,notes_code,file_name,language,code_content,explanation,created_by,author_id,
           stage_id,updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$15) RETURNING *`,
        [companyId, taskId, payload.technical_area || 'BOTH', title, payload.repository_url || null, payload.branch || null,
          payload.commit_sha || null, payload.pull_request_url || null, payload.release || null,
          payload.notes_code || null, payload.file_name || null, payload.language || 'plaintext',
          payload.code_content || null, payload.explanation || null, req.user.id, task.current_stage_id]
      )).rows[0];
    }
    await addEvent(client, req, taskId, cardId ? 'TASK_GITHUB_UPDATED' : 'TASK_GITHUB_ADDED',
      cardId ? 'Registro GitHub atualizado.' : 'Registro GitHub adicionado.',
      before.id ? { id: before.id, file_name: before.file_name, language: before.language } : {},
      { id: github.id, file_name: github.file_name, language: github.language, stage_id: github.stage_id });
    await client.query('COMMIT');
    return github;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function softDeleteGithub(req, taskId, cardId) {
  assert(hasPermission(req.user, 'tasks.manage'), 'GITHUB_CARD_DELETE_FORBIDDEN', 'Somente administradores podem excluir anotacoes.', 403);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await getTask(taskId, req.user.company_id, client, req.user);
    const result = await client.query(
      `UPDATE task_github_metadata
       SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$4,updated_by=$4,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL
       RETURNING id,file_name,language,stage_id`,
      [cardId, taskId, req.user.company_id, req.user.id]
    );
    assert(result.rowCount, 'GITHUB_CARD_NOT_FOUND', 'Registro GitHub nao encontrado.', 404);
    const removed = result.rows[0];
    await addEvent(client, req, taskId, 'TASK_GITHUB_REMOVED', 'Registro GitHub removido logicamente.',
      { id: removed.id, file_name: removed.file_name, language: removed.language, stage_id: removed.stage_id }, {});
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function addComment(req, taskId, content) {
  const companyId = req.user.company_id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await getTask(taskId, companyId, client, req.user);
    const comment = (await client.query(
      `INSERT INTO task_comments (company_id,task_id,content,created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [companyId, taskId, content, req.user.id]
    )).rows[0];
    await addEvent(client, req, taskId, 'TASK_COMMENT_ADDED', 'Comentário adicionado.', {}, {
      comment_id: comment.id
    });
    await client.query('COMMIT');
    return comment;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  addEvent,
  createTask,
  listTasks,
  listTrash,
  getListPreference,
  saveListPreference,
  softDeleteTask,
  restoreTask,
  emptyTrash,
  getTask,
  getTaskDetail,
  transitionTask,
  setTaskState,
  updateAdministration,
  saveSubmission,
  addTest,
  updateTest,
  softDeleteTest,
  addApproval,
  saveGithub,
  softDeleteGithub,
  addComment,
  timerAction: timing.timerAction,
  canViewTask,
  isRoadmap
};
