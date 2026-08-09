const db = require('../config/database');
const { AppError, assert } = require('../utils/errors');
const workflow = require('./workflowService');
const { notifyStageChange, notifyAssignments, notifyOverdue, notifyCompleted, taskCode } = require('./notificationService');
const { hasPermission } = require('./tenantService');
const timing = require('./taskTimingService');

const isAdmin = (user) => user?.is_super_admin === true || user?.roles?.includes('ADMIN') || user?.permissions?.includes('tasks.manage');
const isRoadmap = (task) => String(task.stage || '').toUpperCase() === 'ROADMAP' || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';

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
         estimated_duration_seconds
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING *`,
      [
        companyId, project.id, project.client_id, payload.task_type_id, payload.priority_id,
        payload.environment_id, selectedWorkflow.id, firstStage.id, payload.kind,
        payload.title, payload.initial_description, payload.requester_id,
        payload.client_environment || null, payload.product_affected || null,
        payload.related_requirement || null, payload.related_task_id || null,
        payload.bug_area || null, payload.initial_evidence || null,
        payload.backend_assignee_id, payload.frontend_assignee_id, req.user.id,
        payload.estimated_duration_seconds || null
      ]
    )).rows[0];
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
  if (filters.stage) add('(s.id::text=? OR s.code=?)', filters.stage);
  if (filters.kind) add('t.kind=?', filters.kind);
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
    `SELECT t.*,s.code AS stage,s.name AS stage_name,
            p.code AS priority,p.name AS priority_name,p.color_token AS priority_color,
            e.code AS environment,e.name AS environment_name,
            tt.code AS request_type,tt.name AS task_type_name,
            project.name AS project_name,project.code AS project_code,
            client.name AS client_name,
            requester.name AS requester_name,
            backend.name AS backend_assignee_name,
            frontend.name AS frontend_assignee_name,
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at,CURRENT_TIMESTAMP)-i.started_at)))::bigint
              FROM task_stage_intervals i WHERE i.task_id=t.id
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

async function getTask(taskId, companyId, queryable = db, user = null) {
  const task = (await queryable.query(
    `SELECT t.*,s.code AS stage,s.name AS stage_name,s.responsibility,s.requirements,
            s.tracks_time,s.completes_task,
            p.code AS priority,p.name AS priority_name,p.color_token AS priority_color,
            e.code AS environment,e.name AS environment_name,
            tt.code AS request_type,tt.name AS task_type_name,
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
  const [tests, approvals, github, comments, attachments, events, submissions, intervals, stages, relatedBugs, timerEvents] = await Promise.all([
    db.query(
      `SELECT test.*,stage.code AS stage,stage.name AS stage_name,u.name AS created_by_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes
              ) ORDER BY a.created_at) FROM task_attachments a
              WHERE a.test_id=test.id AND a.deleted_at IS NULL),'[]'::jsonb) AS attachments
       FROM task_tests test JOIN workflow_stages stage ON stage.id=test.stage_id
       JOIN users u ON u.id=test.created_by
       WHERE test.task_id=$1 AND test.company_id=$2 ORDER BY test.created_at DESC`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT approval.*,stage.code AS stage,stage.name AS stage_name,u.name AS created_by_name
       FROM task_approvals approval JOIN workflow_stages stage ON stage.id=approval.stage_id
       JOIN users u ON u.id=approval.created_by
       WHERE approval.task_id=$1 AND approval.company_id=$2 ORDER BY approval.created_at DESC`,
      [taskId, companyId]
    ),
    db.query('SELECT * FROM task_github_metadata WHERE task_id=$1 AND company_id=$2 ORDER BY updated_at DESC,id DESC', [taskId, companyId]),
    db.query(
      `SELECT comment.*,u.name AS created_by_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes
              ) ORDER BY a.created_at) FROM task_attachments a
              WHERE a.comment_id=comment.id AND a.deleted_at IS NULL),'[]'::jsonb) AS attachments
       FROM task_comments comment JOIN users u ON u.id=comment.created_by
       WHERE comment.task_id=$1 AND comment.company_id=$2 ORDER BY comment.created_at`,
      [taskId, companyId]
    ),
    db.query(
      `SELECT attachment.id,attachment.original_name,attachment.mime_type,attachment.size_bytes,
              attachment.description,attachment.created_at,u.name AS created_by_name
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
      `SELECT event.*,u.name AS actor_name FROM task_timer_events event
       JOIN users u ON u.id=event.actor_id
       WHERE event.task_id=$1 AND event.company_id=$2 ORDER BY event.created_at DESC,event.id DESC`,
      [taskId, companyId]
    )
  ]);
  const totalSeconds = intervals.rows.reduce((sum, item) => sum + Number(item.seconds), 0);
  const currentStageSeconds = intervals.rows
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
    timer_events: timerEvents.rows
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
      'SELECT * FROM task_tests WHERE task_id=$1 AND company_id=$2 ORDER BY created_at DESC',
      [task.id, task.company_id]
    ),
    client.query(
      'SELECT * FROM task_approvals WHERE task_id=$1 AND company_id=$2 ORDER BY created_at DESC',
      [task.id, task.company_id]
    ),
    client.query(
      'SELECT * FROM task_github_metadata WHERE task_id=$1 AND company_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1',
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
    await client.query(
      `UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP
       WHERE task_id=$1 AND company_id=$2 AND ended_at IS NULL`,
      [taskId, companyId]
    );
    const startsNow = !task.started_at && targetStage.tracks_time;
    const timerBeforeTransition = timing.timingSnapshot(task);
    updated = (await client.query(
      `UPDATE tasks SET
         current_stage_id=$3,
         state=CASE WHEN $4 THEN 'COMPLETED' ELSE state END,
         started_at=CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE started_at END,
         completed_at=CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE completed_at END,
         active_elapsed_seconds=CASE WHEN $4 THEN $7 ELSE active_elapsed_seconds END,
         timer_status=CASE WHEN $4 AND timer_status NOT IN ('not_started','cancelled') THEN 'completed' ELSE timer_status END,
         timer_last_started_at=CASE WHEN $4 THEN NULL ELSE timer_last_started_at END,
         timer_ended_at=CASE WHEN $4 AND timer_status<>'not_started' THEN CURRENT_TIMESTAMP ELSE timer_ended_at END,
         is_overdue=CASE WHEN $4 THEN FALSE ELSE is_overdue END,
         rework_count=rework_count+CASE WHEN $6 THEN 1 ELSE 0 END,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [taskId, companyId, targetStage.id, targetStage.completes_task, startsNow, direction === 'BACKWARD', timerBeforeTransition.active_elapsed_seconds]
    )).rows[0];
    if (targetStage.tracks_time && !targetStage.completes_task) {
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
    if (targetStage.completes_task && !['not_started', 'completed', 'cancelled'].includes(task.timer_status)) {
      await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,'COMPLETED',$3,$4,'completed',$5,$6)`, [companyId, taskId, req.user.id, task.timer_status, task.estimated_duration_seconds, timerBeforeTransition.active_elapsed_seconds]);
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
    let nextState;
    if (action === 'pause') {
      assert(task.state === 'ACTIVE', 'TASK_STATE_INVALID', 'Somente tarefas ativas podem ser pausadas.', 409);
      nextState = 'PAUSED';
      await client.query(
        `UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP
         WHERE task_id=$1 AND company_id=$2 AND ended_at IS NULL`,
        [taskId, companyId]
      );
    } else if (action === 'reopen') {
      assert(['PAUSED', 'CANCELED', 'COMPLETED'].includes(task.state), 'TASK_STATE_INVALID', 'A tarefa não pode ser reaberta.', 409);
      nextState = 'ACTIVE';
      const currentStage = (await client.query(
        'SELECT * FROM workflow_stages WHERE id=$1 AND company_id=$2',
        [task.current_stage_id, companyId]
      )).rows[0];
      if (currentStage?.tracks_time && !currentStage.completes_task) {
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
    const updated = (await client.query(
      `UPDATE tasks SET state=$3,
         paused_at=CASE WHEN $3='PAUSED' THEN CURRENT_TIMESTAMP ELSE NULL END,
         canceled_at=CASE WHEN $3='CANCELED' THEN CURRENT_TIMESTAMP WHEN $3='ACTIVE' THEN NULL ELSE canceled_at END,
         completed_at=CASE WHEN $3='ACTIVE' THEN NULL ELSE completed_at END,
         active_elapsed_seconds=CASE WHEN $3='CANCELED' AND timer_status='running' THEN active_elapsed_seconds+EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-timer_last_started_at))::bigint ELSE active_elapsed_seconds END,
         timer_status=CASE WHEN $3='CANCELED' AND timer_status NOT IN ('completed','cancelled') THEN 'cancelled' WHEN $3='ACTIVE' AND timer_status IN ('cancelled','completed') THEN 'paused' ELSE timer_status END,
         timer_last_started_at=CASE WHEN $3='CANCELED' THEN NULL ELSE timer_last_started_at END,
         timer_ended_at=CASE WHEN $3='CANCELED' AND timer_status<>'not_started' THEN CURRENT_TIMESTAMP WHEN $3='ACTIVE' THEN NULL ELSE timer_ended_at END,
         is_overdue=CASE WHEN $3='CANCELED' THEN FALSE ELSE is_overdue END,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [taskId, companyId, nextState]
    )).rows[0];
    await addEvent(client, req, taskId, `TASK_${action.toUpperCase()}`, reason, { state: task.state }, { state: nextState });
    if (action === 'cancel' && !['not_started', 'completed', 'cancelled'].includes(task.timer_status)) {
      const active = timing.timingSnapshot(task).active_elapsed_seconds;
      await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,'CANCELLED',$3,$4,'cancelled',$5,$6)`, [companyId, taskId, req.user.id, task.timer_status, task.estimated_duration_seconds, active]);
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
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
           company_id,task_id,event_type,actor_id,previous_status,new_status,
           previous_estimate_seconds,new_estimate_seconds,active_elapsed_seconds
         ) VALUES ($1,$2,'ESTIMATE_CHANGED',$3,$4,$4,$5,$6,$7)`,
        [companyId, taskId, req.user.id, before.timer_status, before.estimated_duration_seconds, payload.estimated_duration_seconds, timerSnapshot.active_elapsed_seconds]
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
         tested_as_super_admin,tested_as_admin,tested_as_user,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        companyId, taskId, stage.id, payload.description,
        payload.result, payload.evidence || null,
        payload.tested_as_super_admin, payload.tested_as_admin, payload.tested_as_user, req.user.id
      ]
    )).rows[0];
    await addEvent(client, req, taskId, 'TASK_TEST_ADDED', `Teste ${stage.name}: ${payload.result}.`, {}, {
      test_id: test.id,
      stage_id: stage.id,
      result: test.result
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
        'SELECT * FROM task_github_metadata WHERE id=$1 AND task_id=$2 AND company_id=$3 FOR UPDATE',
        [cardId, taskId, companyId]
      )).rows[0];
      assert(before, 'GITHUB_CARD_NOT_FOUND', 'Registro GitHub nao encontrado.', 404);
      const value = (field) => Object.prototype.hasOwnProperty.call(payload, field) ? payload[field] : before[field];
      github = (await client.query(
        `UPDATE task_github_metadata SET
           title=$4,repository_url=$5,branch=$6,commit_sha=$7,pull_request_url=$8,
           release=$9,notes_code=$10,updated_by=$11,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND task_id=$2 AND company_id=$3 RETURNING *`,
        [cardId, taskId, companyId, value('title'), value('repository_url'), value('branch'),
          value('commit_sha'), value('pull_request_url'), value('release'), value('notes_code'), req.user.id]
      )).rows[0];
    } else {
      github = (await client.query(
        `INSERT INTO task_github_metadata (
           company_id,task_id,title,repository_url,branch,commit_sha,pull_request_url,
           release,notes_code,created_by,updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [companyId, taskId, payload.title, payload.repository_url || null, payload.branch || null,
          payload.commit_sha || null, payload.pull_request_url || null, payload.release || null,
          payload.notes_code || null, req.user.id]
      )).rows[0];
    }
    await addEvent(client, req, taskId, cardId ? 'TASK_GITHUB_UPDATED' : 'TASK_GITHUB_ADDED',
      cardId ? 'Registro GitHub atualizado.' : 'Registro GitHub adicionado.', before, github);
    await client.query('COMMIT');
    return github;
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
  getTask,
  getTaskDetail,
  transitionTask,
  setTaskState,
  updateAdministration,
  saveSubmission,
  addTest,
  addApproval,
  saveGithub,
  addComment,
  timerAction: timing.timerAction,
  canViewTask,
  isRoadmap
};
