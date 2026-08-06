const { z } = require('zod');
const db = require('../config/database');
const { recordAudit } = require('../services/auditService');
const { revokeSessionById, revokeUserSessions } = require('../services/sessionService');
const { assert } = require('../utils/errors');

async function listAuditEvents(req, res) {
  const filters = z.object({
    operation: z.string().trim().max(100).optional(),
    actor_email: z.string().trim().max(320).optional(),
    entity_type: z.string().trim().max(80).optional(),
    status: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
  }).parse(req.query);
  const conditions = ['company_id=$1'];
  const values = [req.user.company_id];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };
  if (filters.operation) add('operation ILIKE ?', `%${filters.operation}%`);
  if (filters.actor_email) add('actor_email ILIKE ?', `%${filters.actor_email}%`);
  if (filters.entity_type) add('entity_type = ?', filters.entity_type);
  if (filters.status) add('status = ?', filters.status);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = await db.query(`SELECT COUNT(*)::integer AS total FROM audit_events ${where}`, values);
  const result = await db.query(
    `SELECT id,actor_email,operation,entity_type,entity_id,previous_values,new_values,
            ip_address,request_id,status,created_at
     FROM audit_events ${where}
     ORDER BY created_at DESC,id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, (filters.page - 1) * filters.limit]
  );
  res.json({
    events: result.rows,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: total.rows[0].total,
      total_pages: Math.ceil(total.rows[0].total / filters.limit)
    }
  });
}

async function listSessions(req, res) {
  const filters = z.object({
    search: z.string().trim().max(160).optional(),
    status: z.enum(['all', 'active', 'expired', 'revoked']).default('active'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
  }).parse(req.query);
  const values = [req.user.company_id];
  const conditions = ['s.company_id=$1'];
  const add = (condition, value) => { values.push(value); conditions.push(condition.replace('?', `$${values.length}`)); };
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (filters.status === 'active') conditions.push('s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND s.idle_expires_at>CURRENT_TIMESTAMP');
  if (filters.status === 'expired') conditions.push("(s.revoke_reason='expired' OR (s.revoked_at IS NULL AND (s.expires_at<=CURRENT_TIMESTAMP OR s.idle_expires_at<=CURRENT_TIMESTAMP)))");
  if (filters.status === 'revoked') conditions.push("s.revoked_at IS NOT NULL AND COALESCE(s.revoke_reason,'')<>'expired'");
  if (filters.from) add('s.created_at>=?', filters.from);
  if (filters.to) add('s.created_at<=?', filters.to);
  const where = conditions.join(' AND ');
  const total = Number((await db.query(`SELECT COUNT(*) FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE ${where}`, values)).rows[0].count);
  const queryValues = [...values, filters.limit, (filters.page - 1) * filters.limit];
  const result = await db.query(
    `SELECT s.id,s.user_id,u.name,u.email,s.created_at AS login_at,s.last_seen_at,
            s.ip_address,LEFT(COALESCE(s.user_agent,''),200) AS user_agent,
            s.expires_at,s.idle_expires_at,s.revoked_at,s.revoke_reason,
            (s.id=$${queryValues.length + 1}) AS is_current,
            COALESCE((SELECT array_agg(DISTINCT r.code) FROM company_memberships m
              JOIN membership_roles mr ON mr.membership_id=m.id JOIN company_roles r ON r.id=mr.role_id
              WHERE m.company_id=s.company_id AND m.user_id=s.user_id),'{}') AS roles,
            CASE WHEN s.revoked_at IS NOT NULL AND s.revoke_reason='expired' THEN 'expired'
                 WHEN s.revoked_at IS NOT NULL THEN 'revoked'
                 WHEN s.expires_at<=CURRENT_TIMESTAMP OR s.idle_expires_at<=CURRENT_TIMESTAMP THEN 'expired'
                 ELSE 'active' END AS status
     FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE ${where}
     ORDER BY s.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...queryValues, req.user.session_id]
  );
  res.json({ sessions: result.rows, pagination: { page: filters.page, limit: filters.limit, total, total_pages: Math.ceil(total / filters.limit) } });
}

async function revokeSession(req, res) {
  const session = await revokeSessionById(req.user.company_id, req.params.id, req.user.id);
  assert(session, 'SESSION_NOT_ACTIVE', 'Sessao nao encontrada ou ja encerrada.', 404);
  await recordAudit({ req, operation: 'SESSION_REVOKED', entityType: 'SESSION', entityId: req.params.id, newValues: { user_id: session.user_id, reason: 'admin_revoked' } });
  res.json({ message: 'Sessao encerrada.' });
}

async function revokeAllUserSessions(req, res) {
  const count = await revokeUserSessions(req.user.company_id, req.params.userId, req.user.id, 'admin_revoked', req.params.userId === req.user.id ? req.user.session_id : null);
  await recordAudit({ req, operation: 'USER_SESSIONS_REVOKED', entityType: 'USER', entityId: req.params.userId, newValues: { count } });
  res.json({ revoked: count });
}

module.exports = { listAuditEvents, listSessions, revokeSession, revokeAllUserSessions };
