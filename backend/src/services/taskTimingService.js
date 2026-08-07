const db = require('../config/database');
const { assert } = require('../utils/errors');
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
  return db.transaction(async (client) => {
    const task = (await client.query(`SELECT t.*,s.responsibility,s.tracks_time,s.completes_task,s.code AS stage,s.name AS stage_name FROM tasks t JOIN workflow_stages s ON s.id=t.current_stage_id WHERE t.id=$1 AND t.company_id=$2 AND t.deleted_at IS NULL FOR UPDATE OF t`, [taskId, req.user.company_id])).rows[0];
    assert(task, 'TASK_NOT_FOUND', 'Tarefa nao encontrada.', 404);
    assert(canOperateTimer(req.user, task, task), 'TIMER_FORBIDDEN', 'Voce nao pode operar o cronometro desta etapa.', 403);
    const allowed = { start: ['not_started'], pause: ['running'], resume: ['paused'], complete: ['running', 'paused'], cancel: ['not_started', 'running', 'paused'] };
    assert(allowed[action]?.includes(task.timer_status), 'TIMER_STATE_INVALID', 'Transicao de cronometro invalida.', 409);
    const snapshot = timingSnapshot(task);
    const next = { start: 'running', pause: 'paused', resume: 'running', complete: 'completed', cancel: 'cancelled' }[action];
    const active = snapshot.active_elapsed_seconds;
    const overdue = snapshot.estimated_duration_seconds != null && active >= snapshot.estimated_duration_seconds && !['completed', 'cancelled'].includes(next);
    const updated = (await client.query(
      `UPDATE tasks SET timer_status=$3,
         started_at=CASE WHEN $3='running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
         timer_last_started_at=CASE WHEN $3='running' THEN CURRENT_TIMESTAMP ELSE NULL END,
         paused_elapsed_seconds=paused_elapsed_seconds+CASE WHEN $6='resume' AND timer_paused_at IS NOT NULL THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-timer_paused_at))::bigint ELSE 0 END,
         timer_paused_at=CASE WHEN $3='paused' THEN CURRENT_TIMESTAMP WHEN $6='resume' THEN NULL ELSE timer_paused_at END,
         timer_ended_at=CASE WHEN $3 IN ('completed','cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END,
         active_elapsed_seconds=$4,is_overdue=$5,
         timer_started_by=CASE WHEN $6='start' THEN $7 ELSE timer_started_by END,
         timer_paused_by=CASE WHEN $6='pause' THEN $7 ELSE timer_paused_by END,
         timer_resumed_by=CASE WHEN $6='resume' THEN $7 ELSE timer_resumed_by END,
         updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND company_id=$2 RETURNING *`,
      [taskId, req.user.company_id, next, active, overdue, action, req.user.id]
    )).rows[0];
    await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.user.company_id, taskId, action.toUpperCase() === 'START' ? 'STARTED' : action.toUpperCase() === 'RESUME' ? 'RESUMED' : `${action.toUpperCase()}D`, req.user.id, task.timer_status, next, task.estimated_duration_seconds, active]);
    if (overdue && !task.is_overdue) await client.query(`INSERT INTO task_timer_events (company_id,task_id,event_type,actor_id,previous_status,new_status,new_estimate_seconds,active_elapsed_seconds) VALUES ($1,$2,'OVERDUE',$3,$4,$4,$5,$6)`, [req.user.company_id, taskId, req.user.id, next, task.estimated_duration_seconds, active]);
    if (overdue && !task.is_overdue) await notifyOverdue({ ...task, ...updated }, client);
    return { ...updated, ...timingSnapshot(updated), became_overdue: overdue && !task.is_overdue };
  });
}

module.exports = { MAX_ESTIMATE_SECONDS, timingSnapshot, canOperateTimer, updateEstimate, timerAction };
