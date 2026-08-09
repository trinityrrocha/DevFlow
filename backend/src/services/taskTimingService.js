const db = require('../config/database');
const { AppError, assert } = require('../utils/errors');
const workflow = require('./workflowService');
const { hasPermission } = require('./tenantService');
const { notifyOverdue } = require('./notificationService');

const MAX_ESTIMATE_SECONDS = 365 * 24 * 60 * 60;

function timingSnapshot(task, now = new Date()) {
  const stored = Number(task.active_elapsed_seconds || 0);
  const current = task.timer_status === 'running' && task.timer_last_started_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(task.timer_last_started_at).getTime()) / 1000))
    : 0;
  const active = stored + current;
  const estimate = task.estimated_duration_seconds == null ? null : Number(task.estimated_duration_seconds);
  const remaining = estimate == null ? null : estimate - active;
  const end = task.timer_ended_at ? new Date(task.timer_ended_at) : now;
  const elapsed = task.started_at ? Math.max(0, Math.floor((end.getTime() - new Date(task.started_at).getTime()) / 1000)) : 0;
  return { active_elapsed_seconds: active, estimated_duration_seconds: estimate, remaining_seconds: remaining, elapsed_since_start_seconds: elapsed, is_overdue: estimate != null && remaining <= 0 && !['completed', 'cancelled'].includes(task.timer_status) };
}

function canOperateTimer(user, task, stage) {
  return hasPermission(user, 'tasks.manage') || user.profiles?.includes('MANAGER') || workflow.canOperateStage(user, task, stage);
}

async function updateEstimate(req, taskId, seconds) {
  assert(Number.isInteger(seconds) && seconds >= 60 && seconds <= MAX_ESTIMATE_SECONDS, 'ESTIMATE_INVALID', 'A estimativa deve estar entre 1 minuto e 365 dias.');
  return db.transaction(async (client) => {
    const task = (await client.query(`SELECT t.*,s.responsibility,s.code AS stage,s.name AS stage_name FROM tasks t JOIN workflow_stages s ON s.id=t.current_stage_id WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NULL FOR UPDATE OF t`, [taskId, req.user.company_id])).rows[0];
    assert(task, 'TASK_NOT_FOUND', 'Tarefa nao encontrada.', 404);
    assert(hasPermission(req.user, 'tasks.manage'), 'PERMISSION_DENIED', 'Somente administradores podem alterar a estimativa.', 403);
    const snapshot = timingSnapshot(task);
    const overdue = snapshot.active_elapsed_seconds >= seconds && !['completed', 'cancelled'].includes(task.timer_status);
    const updated = (await client.query('UPDATE tasks SET estimated_duration_seconds=$3,is_overdue=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND company_id=$2 RETURNING *', [taskId, req.user.company_id, seconds, overdue])).rows[0];
    await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,previous_estimate_seconds,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,'ESTIMATE_CHANGED',$3,$4,$4,$5,$6,$7)`, [req.user.company_id, taskId, req.user.id, task.timer_status, task.estimated_duration_seconds, seconds, snapshot.active_elapsed_seconds]);
    if (overdue && !task.is_overdue) await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,'OVERDUE',$3,$4,$4,$5,$6)`, [req.user.company_id, taskId, req.user.id, task.timer_status, seconds, snapshot.active_elapsed_seconds]);
    if (overdue && !task.is_overdue) await notifyOverdue({ ...task, ...updated }, client);
    return { ...updated, ...timingSnapshot(updated), became_overdue: overdue && !task.is_overdue };
  });
}

async function timerAction(req, taskId, action) {
  const actorId = req.user?.id;
  const companyId = req.user?.company_id;
  assert(actorId, 'AUTH_REQUIRED', 'Usuario autenticado nao identificado.', 401);
  assert(companyId, 'COMPANY_ACCESS_DENIED', 'Empresa autenticada nao identificada.', 403);

  try {
    return await db.transaction(async (client) => {
      const task = (await client.query(
        `SELECT t.*,s.responsibility,s.tracks_time,s.completes_task,
                s.code AS stage,s.name AS stage_name
         FROM tasks t
         JOIN workflow_stages s
           ON s.id=t.current_stage_id AND s.company_id=t.company_id
         WHERE t.id=$1::uuid AND t.company_id=$2::uuid AND t.deleted_at IS NULL
         FOR UPDATE OF t`,
        [taskId, companyId]
      )).rows[0];

      assert(task, 'TASK_NOT_FOUND', 'Tarefa nao encontrada.', 404);
      assert(canOperateTimer(req.user, task, task), 'TIMER_FORBIDDEN', 'Voce nao pode operar o cronometro desta etapa.', 403);
      assert(task.state === 'ACTIVE', 'TIMER_TASK_STATE_INVALID', 'A tarefa precisa estar ativa para operar o cronometro.', 409);
      assert(task.tracks_time === true, 'TIMER_STAGE_DISABLED', 'A etapa atual nao permite controle de tempo.', 409);

      if (action === 'start' && task.timer_status === 'running') {
        const activeActorId = task.timer_resumed_by || task.timer_started_by;
        assert(
          activeActorId !== actorId,
          'TIMER_ALREADY_RUNNING',
          'Ja existe um cronometro ativo para esta tarefa.',
          409
        );
        throw new AppError('TIMER_ALREADY_RUNNING', 'A tarefa ja possui um cronometro ativo.', 409);
      }

      const allowed = { start: ['not_started'], pause: ['running'], resume: ['paused'], complete: ['running', 'paused'] };
      assert(allowed[action]?.includes(task.timer_status), 'TIMER_STATE_INVALID', 'Transicao de cronometro invalida.', 409);

      const snapshot = timingSnapshot(task);
      const next = { start: 'running', pause: 'paused', resume: 'running', complete: 'completed' }[action];
      const active = snapshot.active_elapsed_seconds;
      const overdue = snapshot.estimated_duration_seconds != null
        && active >= snapshot.estimated_duration_seconds
        && !['completed', 'cancelled'].includes(next);
      const updated = (await client.query(
        `UPDATE tasks SET timer_status=$3::varchar(20),
           started_at=CASE WHEN $3::varchar(20)='running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
           timer_last_started_at=CASE WHEN $3::varchar(20)='running' THEN CURRENT_TIMESTAMP ELSE NULL END,
           paused_elapsed_seconds=paused_elapsed_seconds+CASE WHEN $6::text='resume' AND timer_paused_at IS NOT NULL THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-timer_paused_at))::bigint ELSE 0 END,
           timer_paused_at=CASE WHEN $3::varchar(20)='paused' THEN CURRENT_TIMESTAMP WHEN $6::text='resume' THEN NULL ELSE timer_paused_at END,
           timer_ended_at=CASE WHEN $3::varchar(20) IN ('completed','cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END,
           active_elapsed_seconds=$4::bigint,is_overdue=$5::boolean,
           timer_started_by=CASE WHEN $6::text='start' THEN $7::uuid ELSE timer_started_by END,
           timer_paused_by=CASE WHEN $6::text='pause' THEN $7::uuid ELSE timer_paused_by END,
           timer_resumed_by=CASE WHEN $6::text='resume' THEN $7::uuid ELSE timer_resumed_by END,
           updated_at=CURRENT_TIMESTAMP
         WHERE id=$1::uuid AND company_id=$2::uuid
         RETURNING *`,
        [taskId, companyId, next, active, overdue, action, actorId]
      )).rows[0];

      assert(updated, 'TIMER_UPDATE_CONFLICT', 'A tarefa foi alterada durante a operacao do cronometro.', 409);
      const eventTypes = { start: 'STARTED', pause: 'PAUSED', resume: 'RESUMED', complete: 'COMPLETED' };
      await client.query(
        `INSERT INTO task_timer_events (
           company_id,task_id,event_type,actor_id,previous_status,new_status,
           new_estimate_seconds,active_elapsed_seconds
         ) VALUES ($1::uuid,$2::uuid,$3::varchar(32),$4::uuid,$5::varchar(20),$6::varchar(20),$7::bigint,$8::bigint)`,
        [companyId, taskId, eventTypes[action], actorId, task.timer_status, next, task.estimated_duration_seconds, active]
      );
      if (overdue && !task.is_overdue) {
        await client.query(
          `INSERT INTO task_timer_events (
             company_id,task_id,event_type,actor_id,previous_status,new_status,
             new_estimate_seconds,active_elapsed_seconds
           ) VALUES ($1::uuid,$2::uuid,'OVERDUE',$3::uuid,$4::varchar(20),$4::varchar(20),$5::bigint,$6::bigint)`,
          [companyId, taskId, actorId, next, task.estimated_duration_seconds, active]
        );
        await notifyOverdue({ ...task, ...updated }, client);
      }
      return { ...updated, ...timingSnapshot(updated), became_overdue: overdue && !task.is_overdue };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.code === '22P02') {
      throw new AppError('TASK_ID_INVALID', 'Identificador da tarefa invalido.', 400);
    }
    if (['23502', '23503', '23505', '23514', '40001', '40P01'].includes(error?.code)) {
      throw new AppError('TIMER_CONFLICT', 'Nao foi possivel iniciar o cronometro no estado atual da tarefa.', 409);
    }
    throw error;
  }
}

module.exports = { MAX_ESTIMATE_SECONDS, timingSnapshot, canOperateTimer, updateEstimate, timerAction };
