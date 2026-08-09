const db = require('../config/database');
const { enqueueEmail, smtpConfigured } = require('./emailOutboxService');

const taskCode = (task) => `DF-${String(task.task_number).padStart(6, '0')}`;

async function recipientsForStage(task, queryable = db) {
  if (task.stage_responsibility === 'BACKEND_ASSIGNEE') return [task.backend_assignee_id];
  if (task.stage_responsibility === 'FRONTEND_ASSIGNEE') return [task.frontend_assignee_id];
  const result = await queryable.query(
    `SELECT DISTINCT u.id FROM company_memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN membership_technical_profiles mp ON mp.membership_id=m.id
     LEFT JOIN technical_profiles tp ON tp.id=mp.profile_id
     LEFT JOIN membership_roles mr ON mr.membership_id=m.id
     LEFT JOIN role_permissions rp ON rp.role_id=mr.role_id
     LEFT JOIN permissions p ON p.id=rp.permission_id
     WHERE m.company_id=$1 AND m.is_active=TRUE AND u.is_active=TRUE AND u.deleted_at IS NULL
       AND (tp.code='MANAGER' OR p.code='tasks.manage')`, [task.company_id]
  );
  return result.rows.map((row) => row.id);
}

async function roadmapRecipients(task, queryable) {
  const authorized = await queryable.query(
    `SELECT DISTINCT m.user_id FROM company_memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN membership_roles mr ON mr.membership_id=m.id
     LEFT JOIN role_permissions rp ON rp.role_id=mr.role_id
     LEFT JOIN permissions p ON p.id=rp.permission_id
     WHERE m.company_id=$1 AND m.is_active=TRUE AND u.is_active=TRUE AND u.deleted_at IS NULL
       AND (u.is_super_admin=TRUE OR p.code='tasks.manage')`, [task.company_id]
  );
  return [task.created_by, ...authorized.rows.map((row) => row.user_id)];
}

const categoryColumn = {
  movement: 'task_movement', assignment: 'assignments', overdue: 'overdue', security: 'security'
};

async function deliver(queryable, { task, recipientIds, type, title, body, category, idempotencyBase, linkPath }) {
  const ids = [...new Set(recipientIds.filter(Boolean))];
  if (!ids.length) return [];
  const column = categoryColumn[category] || 'task_movement';
  const users = await queryable.query(
    `SELECT u.id,u.name,u.email,
       COALESCE(np.internal_enabled,TRUE) AS internal_enabled,
       COALESCE(np.email_enabled,TRUE) AS email_enabled,
       COALESCE(np.${column},TRUE) AS category_enabled
     FROM users u JOIN company_memberships m ON m.user_id=u.id AND m.company_id=$2
     LEFT JOIN notification_preferences np ON np.company_id=m.company_id AND np.user_id=u.id
     WHERE u.id=ANY($1::uuid[]) AND u.is_active=TRUE AND u.deleted_at IS NULL AND m.is_active=TRUE`,
    [ids, task.company_id]
  );
  const emailAvailable = await smtpConfigured();
  const notificationIds = [];
  for (const user of users.rows) {
    if (!user.category_enabled && category !== 'security') continue;
    const internalEnabled = category === 'security' || user.internal_enabled;
    const emailEnabled = category === 'security' || user.email_enabled;
    let notificationId = null;
    if (internalEnabled) {
      const inserted = await queryable.query(
        `INSERT INTO notifications (company_id,user_id,task_id,notification_type,title,body,email_status,link_path,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (company_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [task.company_id, user.id, task.id || null, type, title, body,
          emailAvailable && emailEnabled ? 'PENDING' : 'SKIPPED', linkPath || null, `${idempotencyBase}:internal:${user.id}`]
      );
      notificationId = inserted.rows[0]?.id || null;
      if (notificationId) notificationIds.push(notificationId);
    }
    if (emailEnabled && emailAvailable) await enqueueEmail(queryable, {
      companyId: task.company_id,
      userId: user.id,
      notificationId,
      email: user.email,
      template: category === 'security' ? 'SECURITY_ALERT' : 'TASK_EVENT',
      data: { name: user.name, title, body, task_id: task.id },
      idempotencyKey: `${idempotencyBase}:email:${user.id}`
    });
  }
  return notificationIds;
}

async function notifyStageChange(task, queryable = db) {
  const roadmap = String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
  const recipients = roadmap ? await roadmapRecipients(task, queryable) : await recipientsForStage(task, queryable);
  const stageName = task.stage_name || task.stage;
  return deliver(queryable, {
    task,
    recipientIds: recipients,
    type: 'STAGE_CHANGED',
    title: `${taskCode(task)} em ${stageName}`,
    body: `A tarefa "${task.title}" foi movida para a etapa "${stageName}" e esta sob sua responsabilidade.`,
    category: 'movement',
    idempotencyBase: `stage:${task.id}:${task.current_stage_id}:${new Date(task.updated_at || task.created_at).toISOString()}`,
    linkPath: `/task/${task.id}`
  });
}

async function notifyAssignments(task, previous, queryable = db) {
  if (String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap') return [];
  const changed = [
    ['backend', task.backend_assignee_id, previous?.backend_assignee_id],
    ['frontend', task.frontend_assignee_id, previous?.frontend_assignee_id]
  ].filter(([, current, before]) => current && current !== before);
  for (const [role, recipient] of changed) await deliver(queryable, {
    task,
    recipientIds: [recipient],
    type: 'TASK_ASSIGNED',
    title: `${taskCode(task)} atribuida a voce`,
    body: `Voce foi definido como responsavel ${role} pela tarefa "${task.title}".`,
    category: 'assignment',
    idempotencyBase: `assignment:${task.id}:${role}:${recipient}:${task.updated_at || task.created_at}`,
    linkPath: `/task/${task.id}`
  });
}

async function notifyOverdue(task, queryable = db) {
  const roadmap = String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
  return deliver(queryable, {
    task,
    recipientIds: roadmap ? await roadmapRecipients(task, queryable)
      : [task.created_by, task.requester_id, task.backend_assignee_id, task.frontend_assignee_id],
    type: 'TASK_OVERDUE', title: `${taskCode(task)} em atraso`,
    body: `A tarefa "${task.title}" ultrapassou a estimativa ativa.`, category: 'overdue',
    idempotencyBase: `overdue:${task.id}:${task.estimated_duration_seconds}:${new Date(task.updated_at).toISOString()}`, linkPath: `/task/${task.id}`
  });
}

async function notifyCompleted(task, queryable = db) {
  return deliver(queryable, {
    task,
    recipientIds: [task.created_by, task.requester_id, task.backend_assignee_id, task.frontend_assignee_id],
    type: 'TASK_COMPLETED', title: `${taskCode(task)} concluida`,
    body: `A tarefa "${task.title}" foi concluida.`, category: 'movement',
    idempotencyBase: `completed:${task.id}:${new Date(task.updated_at).toISOString()}`, linkPath: `/task/${task.id}`
  });
}

module.exports = { notifyStageChange, notifyAssignments, notifyOverdue, notifyCompleted, recipientsForStage, deliver, taskCode };
