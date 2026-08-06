const { z } = require('zod');
const db = require('../config/database');

async function listNotifications(req, res) {
  const result = await db.query(
    `SELECT n.*,t.task_number
     FROM notifications n
     LEFT JOIN tasks t ON t.id=n.task_id AND t.company_id=n.company_id
     LEFT JOIN workflow_stages s ON s.id=t.current_stage_id
     WHERE n.company_id=$1 AND n.user_id=$2
       AND (n.task_id IS NULL OR $3::boolean
         OR ((UPPER(s.code)='ROADMAP' OR LOWER(TRIM(s.name))='roadmap') AND t.created_by=$2)
         OR ((UPPER(s.code)<>'ROADMAP' AND LOWER(TRIM(s.name))<>'roadmap') AND (
           $2::uuid IN (t.created_by,t.requester_id,t.backend_assignee_id,t.frontend_assignee_id)
           OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=t.company_id AND pr.project_id=t.project_id AND pr.user_id=$2)
         )))
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.company_id, req.user.id, req.user.is_super_admin || req.user.permissions?.includes('tasks.manage')]
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
