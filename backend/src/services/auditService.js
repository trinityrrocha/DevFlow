const db = require('../config/database');
const { safeLogError } = require('../utils/safeLogger');

const sanitizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const forbidden = /password|secret|token|passphrase|authorization|cookie/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .slice(0, 50)
  );
};

async function recordAudit({
  req,
  operation,
  entityType,
  entityId,
  previousValues,
  newValues,
  status = 'SUCCESS',
  queryable = db
}) {
  try {
    await queryable.query(
      `INSERT INTO audit_events (
         company_id,actor_id, actor_email, operation, entity_type, entity_id,
         previous_values, new_values, ip_address, user_agent, request_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        req?.user?.company_id || null,
        req?.user?.id || null,
        req?.user?.email || null,
        operation,
        entityType || null,
        entityId || null,
        sanitizeObject(previousValues),
        sanitizeObject(newValues),
        req?.ip || null,
        String(req?.get?.('user-agent') || '').slice(0, 1000) || null,
        req?.requestId || null,
        status
      ]
    );
  } catch (error) {
    safeLogError('Falha ao registrar auditoria.', error);
  }
}

module.exports = { recordAudit, sanitizeObject };
