const { z } = require('zod');
const db = require('../config/database');
const env = require('../config/env');
const { enqueueEmail, smtpConfigured } = require('../services/emailOutboxService');
const { recordAudit } = require('../services/auditService');
const { AppError } = require('../utils/errors');

const visibility = `(n.task_id IS NULL OR $3::boolean
  OR ((UPPER(s.code)='ROADMAP' OR LOWER(TRIM(s.name))='roadmap') AND t.created_by=$2)
  OR ((UPPER(s.code)<>'ROADMAP' AND LOWER(TRIM(s.name))<>'roadmap') AND (
    $2::uuid IN (t.created_by,t.requester_id,t.backend_assignee_id,t.frontend_assignee_id)
    OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=t.company_id AND pr.project_id=t.project_id AND pr.user_id=$2)
  )))`;

async function listNotifications(req, res) {
  const { page, limit } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  }).parse(req.query);
  const parameters = [req.user.company_id, req.user.id, req.user.is_super_admin || req.user.permissions?.includes('tasks.manage')];
  const result = await db.query(
    `SELECT n.*,t.task_number FROM notifications n
     LEFT JOIN tasks t ON t.id=n.task_id AND t.company_id=n.company_id
     LEFT JOIN workflow_stages s ON s.id=t.current_stage_id
     WHERE n.company_id=$1 AND n.user_id=$2 AND ${visibility}
     ORDER BY n.created_at DESC LIMIT $4 OFFSET $5`, [...parameters, limit, (page - 1) * limit]
  );
  const counts = await db.query(
    `SELECT COUNT(*)::integer AS total,COUNT(*) FILTER (WHERE n.read_at IS NULL)::integer AS unread_count
     FROM notifications n LEFT JOIN tasks t ON t.id=n.task_id AND t.company_id=n.company_id
     LEFT JOIN workflow_stages s ON s.id=t.current_stage_id
     WHERE n.company_id=$1 AND n.user_id=$2 AND ${visibility}`, parameters
  );
  res.json({ notifications: result.rows, ...counts.rows[0], page, limit });
}

async function markRead(req, res) {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(req.body);
  const result = await db.query(
    `UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
     WHERE company_id=$1 AND user_id=$2 AND id=ANY($3::uuid[]) RETURNING id`,
    [req.user.company_id, req.user.id, ids]
  );
  res.json({ read: result.rowCount });
}

async function markAllRead(req, res) {
  const result = await db.query(
    `UPDATE notifications SET read_at=CURRENT_TIMESTAMP
     WHERE company_id=$1 AND user_id=$2 AND read_at IS NULL`, [req.user.company_id, req.user.id]
  );
  res.json({ read: result.rowCount });
}

async function getPreferences(req, res) {
  const result = await db.query(
    `SELECT internal_enabled,email_enabled,task_movement,assignments,overdue,security
     FROM notification_preferences WHERE company_id=$1 AND user_id=$2`, [req.user.company_id, req.user.id]
  );
  res.json({ preferences: result.rows[0] || {
    internal_enabled: true, email_enabled: true, task_movement: true,
    assignments: true, overdue: true, security: true
  } });
}

async function updatePreferences(req, res) {
  const payload = z.object({
    internal_enabled: z.boolean(), email_enabled: z.boolean(), task_movement: z.boolean(),
    assignments: z.boolean(), overdue: z.boolean()
  }).parse(req.body);
  const result = await db.query(
    `INSERT INTO notification_preferences (company_id,user_id,internal_enabled,email_enabled,task_movement,assignments,overdue,security)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
     ON CONFLICT (company_id,user_id) DO UPDATE SET internal_enabled=EXCLUDED.internal_enabled,
       email_enabled=EXCLUDED.email_enabled,task_movement=EXCLUDED.task_movement,
       assignments=EXCLUDED.assignments,overdue=EXCLUDED.overdue,security=TRUE,updated_at=CURRENT_TIMESTAMP
     RETURNING internal_enabled,email_enabled,task_movement,assignments,overdue,security`,
    [req.user.company_id, req.user.id, payload.internal_enabled, payload.email_enabled,
      payload.task_movement, payload.assignments, payload.overdue]
  );
  await recordAudit({ req, operation: 'NOTIFICATION_PREFERENCES_UPDATED', entityType: 'USER', entityId: req.user.id, newValues: payload });
  res.json({ preferences: result.rows[0] });
}

function emailStatus(_req, res) {
  res.json({
    enabled: env.SMTP_ENABLED,
    configured: smtpConfigured(),
    host_configured: Boolean(env.SMTP_HOST),
    sender_configured: Boolean(env.SMTP_FROM),
    host: env.SMTP_HOST || null,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    authentication_configured: Boolean(env.SMTP_USER),
    from: env.SMTP_FROM || null,
    reply_to: env.SMTP_REPLY_TO || null,
    configuration_source: '/opt/devflow/config/devflow.env',
    worker: 'email_outbox'
  });
}

async function testEmail(req, res) {
  if (!smtpConfigured()) throw new AppError('SMTP_NOT_CONFIGURED', 'Configure e habilite o SMTP antes de enviar um teste.', 409);
  const idempotencyKey = `smtp-test:${req.user.id}:${Date.now()}`;
  await enqueueEmail(db, {
    companyId: req.user.company_id, userId: req.user.id, email: req.user.email,
    template: 'SMTP_TEST', data: { name: req.user.name }, idempotencyKey
  });
  await recordAudit({ req, operation: 'SMTP_TEST_QUEUED', entityType: 'USER', entityId: req.user.id });
  res.status(202).json({ message: 'E-mail de teste colocado na fila.', idempotency_key: idempotencyKey });
}

module.exports = { listNotifications, markRead, markAllRead, getPreferences, updatePreferences, emailStatus, testEmail };
