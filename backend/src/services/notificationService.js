const nodemailer = require('nodemailer');
const db = require('../config/database');
const env = require('../config/env');
const { safeLogError } = require('../utils/safeLogger');

function transport() {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  });
}

async function recipientsForStage(task, queryable = db) {
  if (task.stage_responsibility === 'BACKEND_ASSIGNEE') return [task.backend_assignee_id];
  if (task.stage_responsibility === 'FRONTEND_ASSIGNEE') return [task.frontend_assignee_id];
  const result = await queryable.query(
    `SELECT DISTINCT u.id
     FROM company_memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN membership_technical_profiles mp ON mp.membership_id=m.id
     LEFT JOIN technical_profiles tp ON tp.id=mp.profile_id
     LEFT JOIN membership_roles mr ON mr.membership_id=m.id
     LEFT JOIN role_permissions rp ON rp.role_id=mr.role_id
     LEFT JOIN permissions p ON p.id=rp.permission_id
     WHERE m.company_id=$1 AND m.is_active=TRUE
       AND u.is_active=TRUE AND u.deleted_at IS NULL
       AND (tp.code='MANAGER' OR p.code='tasks.manage')`,
    [task.company_id]
  );
  return result.rows.map((row) => row.id);
}

async function notifyStageChange(task) {
  let recipientIds = [...new Set(await recipientsForStage(task))].filter(Boolean);
  const roadmap = String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
  if (roadmap) {
    const authorized = await db.query(
      `SELECT DISTINCT m.user_id FROM company_memberships m
       JOIN users u ON u.id=m.user_id
       LEFT JOIN membership_roles mr ON mr.membership_id=m.id
       LEFT JOIN role_permissions rp ON rp.role_id=mr.role_id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE m.company_id=$1 AND m.is_active=TRUE AND (u.is_super_admin=TRUE OR p.code='tasks.manage')`,
      [task.company_id]
    );
    recipientIds = [...new Set([task.created_by, ...authorized.rows.map((row) => row.user_id)])].filter(Boolean);
  }
  if (!recipientIds.length) return;
  const stageName = task.stage_name || task.stage;
  const title = `${taskCode(task)} em ${stageName}`;
  const body = `A tarefa "${task.title}" avançou para ${stageName}.`;
  const users = await db.query(
    `SELECT u.id,u.name,u.email FROM users u
     JOIN company_memberships m ON m.user_id=u.id
     WHERE u.id = ANY($1::uuid[]) AND m.company_id=$2
       AND u.is_active=TRUE AND m.is_active=TRUE`,
    [recipientIds, task.company_id]
  );
  const mailer = transport();
  for (const user of users.rows) {
    const inserted = await db.query(
      `INSERT INTO notifications (company_id,user_id,task_id,notification_type,title,body,email_status)
       VALUES ($1,$2,$3,'STAGE_CHANGED',$4,$5,$6) RETURNING id`,
      [task.company_id, user.id, task.id, title, body, mailer ? 'PENDING' : 'SKIPPED']
    );
    if (!mailer) continue;
    try {
      await mailer.sendMail({
        from: env.SMTP_FROM,
        to: user.email,
        subject: `[DevFlow] ${title}`,
        text: `${user.name},\n\n${body}\n\nAcesse ${env.APP_ORIGIN}/task/${task.id}`
      });
      await db.query("UPDATE notifications SET email_status='SENT' WHERE id=$1", [inserted.rows[0].id]);
    } catch (error) {
      safeLogError('Falha ao enviar notificação por e-mail.', error);
      await db.query("UPDATE notifications SET email_status='FAILED' WHERE id=$1", [inserted.rows[0].id]);
    }
  }
}

const taskCode = (task) => `DF-${String(task.task_number).padStart(6, '0')}`;

module.exports = { notifyStageChange, recipientsForStage, taskCode };
