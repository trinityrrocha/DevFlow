const { z } = require('zod');
const db = require('../config/database');

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

module.exports = { listAuditEvents };
