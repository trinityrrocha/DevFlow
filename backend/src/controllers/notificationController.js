const { z } = require('zod');
const db = require('../config/database');

async function listNotifications(req, res) {
  const result = await db.query(
    `SELECT n.*,t.task_number
     FROM notifications n
     LEFT JOIN tasks t ON t.id=n.task_id AND t.company_id=n.company_id
     WHERE n.company_id=$1 AND n.user_id=$2
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.company_id, req.user.id]
  );
  const unread = result.rows.filter((item) => !item.read_at).length;
  res.json({ notifications: result.rows, unread_count: unread });
}

async function markRead(req, res) {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(req.body);
  await db.query(
    `UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
     WHERE company_id=$1 AND user_id=$2 AND id=ANY($3::uuid[])`,
    [req.user.company_id, req.user.id, ids]
  );
  res.json({ read: ids.length });
}

module.exports = { listNotifications, markRead };
