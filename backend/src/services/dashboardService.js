const db = require('../config/database');

async function calculateGeneral(client, companyId) {
  const [totals, distributions, durations, stageDurations] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::integer AS total_tasks,
              COUNT(*) FILTER (WHERE state='COMPLETED')::integer AS completed_tasks,
              COUNT(*) FILTER (WHERE state='ACTIVE')::integer AS active_tasks,
              COUNT(*) FILTER (WHERE state='PAUSED')::integer AS paused_tasks,
              COUNT(*) FILTER (WHERE kind='BUG')::integer AS total_bugs,
              COUNT(*) FILTER (WHERE kind='BUG' AND state='COMPLETED')::integer AS resolved_bugs,
              COUNT(*) FILTER (WHERE kind='BUG' AND state NOT IN ('COMPLETED','CANCELED'))::integer AS pending_bugs,
              COUNT(*) FILTER (WHERE kind='BUG' AND related_task_id IS NOT NULL AND bug_area IN ('BACKEND','BOTH') AND EXISTS (SELECT 1 FROM tasks parent WHERE parent.id=tasks.related_task_id AND parent.company_id=tasks.company_id AND parent.deleted_at IS NULL))::integer AS backend_bugs,
              COUNT(*) FILTER (WHERE kind='BUG' AND related_task_id IS NOT NULL AND bug_area IN ('FRONTEND','BOTH') AND EXISTS (SELECT 1 FROM tasks parent WHERE parent.id=tasks.related_task_id AND parent.company_id=tasks.company_id AND parent.deleted_at IS NULL))::integer AS frontend_bugs
       FROM tasks WHERE company_id=$1 AND deleted_at IS NULL`,
      [companyId]
    ),
    client.query(
      `SELECT 'priority' AS dimension,p.code AS value,p.name AS label,COUNT(*)::integer AS total
       FROM tasks t JOIN priorities p ON p.id=t.priority_id
       WHERE t.company_id=$1 AND t.deleted_at IS NULL GROUP BY p.code,p.name,p.sort_order
       UNION ALL
       SELECT 'environment',e.code,e.name,COUNT(*)::integer
       FROM tasks t JOIN environments e ON e.id=t.environment_id
       WHERE t.company_id=$1 AND t.deleted_at IS NULL GROUP BY e.code,e.name,e.sort_order
       UNION ALL
       SELECT 'kind',t.kind,t.kind,COUNT(*)::integer
       FROM tasks t WHERE t.company_id=$1 AND t.deleted_at IS NULL GROUP BY t.kind`,
      [companyId]
    ),
    client.query(
      `WITH totals AS (
         SELECT i.task_id,SUM(EXTRACT(EPOCH FROM (i.ended_at-i.started_at))) AS active_seconds
         FROM task_stage_intervals i JOIN tasks t ON t.id=i.task_id
         WHERE t.company_id=$1 AND t.state='COMPLETED' AND t.deleted_at IS NULL
           AND i.ended_at IS NOT NULL
           AND UPPER(i.stage_code_snapshot)<>'ROADMAP'
           AND LOWER(TRIM(i.stage_name_snapshot))<>'roadmap'
         GROUP BY i.task_id
       )
       SELECT COALESCE(AVG(active_seconds),0)::bigint AS average_completion_seconds FROM totals`,
      [companyId]
    ),
    client.query(
      `SELECT i.stage_code_snapshot AS stage,i.stage_name_snapshot AS stage_name,
              COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(i.ended_at,CURRENT_TIMESTAMP)-i.started_at))),0)::bigint AS average_seconds
       FROM task_stage_intervals i WHERE i.company_id=$1
         AND UPPER(i.stage_code_snapshot)<>'ROADMAP'
         AND LOWER(TRIM(i.stage_name_snapshot))<>'roadmap'
       GROUP BY i.stage_code_snapshot,i.stage_name_snapshot ORDER BY i.stage_name_snapshot`,
      [companyId]
    )
  ]);
  const grouped = { priority: [], environment: [], kind: [] };
  for (const row of distributions.rows) grouped[row.dimension].push({
    value: row.value, label: row.label, total: Number(row.total)
  });
  return {
    ...totals.rows[0],
    average_completion_seconds: Number(durations.rows[0].average_completion_seconds),
    average_by_stage: stageDurations.rows.map((row) => ({ ...row, average_seconds: Number(row.average_seconds) })),
    distributions: grouped
  };
}

async function calculateDevelopers(client, companyId) {
  const result = await client.query(
    `WITH developer_tasks AS (
       SELECT id AS task_id,backend_assignee_id AS user_id FROM tasks
       WHERE company_id=$1 AND deleted_at IS NULL
       UNION
       SELECT id,frontend_assignee_id FROM tasks WHERE company_id=$1 AND deleted_at IS NULL
     ),
     worked_intervals AS (
       SELECT session.user_id,session.task_id,stage.code AS stage,
              session.active_seconds
              + CASE WHEN session.ended_at IS NULL
                  THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-session.started_at))
                  ELSE 0 END AS seconds
       FROM task_stage_touch_sessions session
       JOIN workflow_stages stage
         ON stage.id=session.stage_id AND stage.company_id=session.company_id
       WHERE session.company_id=$1
         AND UPPER(stage.code)<>'ROADMAP'
         AND LOWER(TRIM(stage.name))<>'roadmap'
     ),
     work_by_task AS (
       SELECT user_id,task_id,SUM(seconds) AS seconds FROM worked_intervals
       WHERE user_id IS NOT NULL GROUP BY user_id,task_id
     ),
     work_stats AS (
       SELECT user_id,COALESCE(SUM(seconds),0)::bigint AS total_seconds,
              COALESCE(AVG(seconds),0)::bigint AS average_task_seconds
       FROM work_by_task GROUP BY user_id
     ),
     stage_averages AS (
       SELECT user_id,stage,COALESCE(AVG(seconds),0)::bigint AS average_seconds
       FROM worked_intervals WHERE user_id IS NOT NULL GROUP BY user_id,stage
     ),
     stage_json AS (
       SELECT user_id,jsonb_object_agg(stage,average_seconds) AS average_by_stage
       FROM stage_averages GROUP BY user_id
     ),
     task_stats AS (
       SELECT dt.user_id,
              COUNT(*) FILTER (WHERE t.state='COMPLETED')::integer AS completed_tasks,
              COALESCE(SUM(CASE WHEN t.state='COMPLETED' THEN p.weight ELSE 0 END),0)::numeric AS delivery_points,
              COALESCE(SUM(t.rework_count),0)::integer AS reworks
       FROM developer_tasks dt JOIN tasks t ON t.id=dt.task_id
       JOIN priorities p ON p.id=t.priority_id GROUP BY dt.user_id
     ),
     approval_stats AS (
       SELECT dt.user_id,
              COUNT(*) FILTER (WHERE a.decision='APPROVED')::integer AS approvals,
              COUNT(*) FILTER (WHERE a.decision='REJECTED')::integer AS rejections
       FROM developer_tasks dt JOIN task_approvals a ON a.task_id=dt.task_id
       GROUP BY dt.user_id
     ),
     fixed_bugs AS (
       SELECT dt.user_id,COUNT(DISTINCT t.id)::integer AS bugs_fixed
       FROM developer_tasks dt JOIN tasks t ON t.id=dt.task_id
       WHERE t.kind='BUG' AND t.state='COMPLETED' GROUP BY dt.user_id
     ),
     generated_bugs AS (
       SELECT affected.user_id,COUNT(*)::integer AS bugs_generated
       FROM tasks bug JOIN tasks parent ON parent.id=bug.related_task_id
       CROSS JOIN LATERAL (
         SELECT parent.backend_assignee_id AS user_id WHERE bug.bug_area IN ('BACKEND','BOTH')
         UNION SELECT parent.frontend_assignee_id WHERE bug.bug_area IN ('FRONTEND','BOTH')
       ) affected
       WHERE bug.company_id=$1 AND bug.kind='BUG' AND bug.deleted_at IS NULL
       GROUP BY affected.user_id
     )
     SELECT u.id,u.name,u.email,
            COALESCE(ts.completed_tasks,0) AS completed_tasks,
            COALESCE(fb.bugs_fixed,0) AS bugs_fixed,
            COALESCE(ws.total_seconds,0) AS total_seconds,
            COALESCE(ws.average_task_seconds,0) AS average_task_seconds,
            COALESCE(sj.average_by_stage,'{}'::jsonb) AS average_by_stage,
            COALESCE(ts.reworks,0) AS reworks,
            COALESCE(ap.approvals,0) AS approvals,
            COALESCE(ap.rejections,0) AS rejections,
            COALESCE(gb.bugs_generated,0) AS bugs_generated,
            COALESCE(ts.delivery_points,0) AS delivery_points
     FROM company_memberships m JOIN users u ON u.id=m.user_id
     LEFT JOIN task_stats ts ON ts.user_id=u.id
     LEFT JOIN work_stats ws ON ws.user_id=u.id
     LEFT JOIN stage_json sj ON sj.user_id=u.id
     LEFT JOIN approval_stats ap ON ap.user_id=u.id
     LEFT JOIN fixed_bugs fb ON fb.user_id=u.id
     LEFT JOIN generated_bugs gb ON gb.user_id=u.id
     WHERE m.company_id=$1 AND m.is_active=TRUE AND u.is_active=TRUE AND u.deleted_at IS NULL
     ORDER BY u.name`,
    [companyId]
  );
  return result.rows.map((row) => {
    const approvals = Number(row.approvals);
    const rejections = Number(row.rejections);
    const reworks = Number(row.reworks);
    const bugsGenerated = Number(row.bugs_generated);
    const bugsFixed = Number(row.bugs_fixed);
    const approvalRate = approvals + rejections ? (approvals / (approvals + rejections)) * 100 : 100;
    const quality = Math.max(0, Math.min(100, 100 - rejections * 15 - reworks * 10 - bugsGenerated * 8 + bugsFixed * 3));
    return {
      ...row,
      completed_tasks: Number(row.completed_tasks),
      bugs_fixed: bugsFixed,
      total_seconds: Number(row.total_seconds),
      average_task_seconds: Number(row.average_task_seconds),
      reworks,
      approvals,
      rejections,
      bugs_generated: bugsGenerated,
      delivery_points: Number(row.delivery_points),
      approval_rate: Math.round(approvalRate * 10) / 10,
      quality_index: quality,
      productivity_score: Math.round(Number(row.delivery_points) * approvalRate) / 100
    };
  }).sort((a, b) => b.productivity_score - a.productivity_score)
    .map((item, index) => ({ ...item, productivity_rank: index + 1 }));
}

async function refreshCompany(companyId) {
  try {
    return await db.transaction(async (client) => {
      const lock = await client.query(
        `UPDATE metric_refresh_state SET status='RUNNING',started_at=CURRENT_TIMESTAMP,error_code=NULL
         WHERE company_id=$1 AND status<>'RUNNING' RETURNING company_id`,
        [companyId]
      );
      if (!lock.rowCount) return false;
      const [general, developers, weights] = await Promise.all([
        calculateGeneral(client, companyId),
        calculateDevelopers(client, companyId),
        client.query('SELECT code,weight FROM priorities WHERE company_id=$1 AND is_active=TRUE', [companyId])
      ]);
      const payload = {
        generated_at: new Date().toISOString(),
        general,
        priority_weights: Object.fromEntries(weights.rows.map((row) => [row.code, Number(row.weight)])),
        formula_version: 3
      };
      await client.query(
        `INSERT INTO company_metric_snapshots (company_id,payload,formula_version,calculated_at)
         VALUES ($1,$2,3,CURRENT_TIMESTAMP)
         ON CONFLICT (company_id) DO UPDATE SET payload=EXCLUDED.payload,
           formula_version=EXCLUDED.formula_version,calculated_at=CURRENT_TIMESTAMP`,
        [companyId, payload]
      );
      await client.query('DELETE FROM developer_metric_snapshots WHERE company_id=$1', [companyId]);
      for (const developer of developers) {
        await client.query(
          `INSERT INTO developer_metric_snapshots (company_id,user_id,payload)
           VALUES ($1,$2,$3)`,
          [companyId, developer.id, developer]
        );
      }
      await client.query(
        `UPDATE metric_refresh_state SET status='SUCCESS',completed_at=CURRENT_TIMESTAMP,error_code=NULL
         WHERE company_id=$1`,
        [companyId]
      );
      return true;
    });
  } catch (error) {
    await db.query(
      `UPDATE metric_refresh_state SET status='FAILED',completed_at=CURRENT_TIMESTAMP,error_code=$2
       WHERE company_id=$1`,
      [companyId, String(error.code || 'METRICS_REFRESH_FAILED').slice(0, 100)]
    ).catch(() => {});
    throw error;
  }
}

async function refreshPending() {
  const companies = await db.query(
    `SELECT company_id FROM metric_refresh_state WHERE status IN ('IDLE','FAILED')
     ORDER BY completed_at NULLS FIRST LIMIT 20`
  );
  for (const row of companies.rows) {
    await refreshCompany(row.company_id).catch(() => {});
  }
}

async function dashboard(user) {
  const companyId = user.company_id;
  const administrator = user.is_super_admin === true || user.roles?.includes('ADMIN') || user.permissions?.includes('tasks.manage');
  if (!administrator) {
    const visible = `t.company_id=$1 AND t.deleted_at IS NULL AND (
      ((UPPER(s.code)='ROADMAP' OR LOWER(TRIM(s.name))='roadmap') AND t.created_by=$2)
      OR ((UPPER(s.code)<>'ROADMAP' AND LOWER(TRIM(s.name))<>'roadmap') AND (
        $2::uuid IN (t.created_by,t.requester_id,t.backend_assignee_id,t.frontend_assignee_id)
        OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=t.company_id AND pr.project_id=t.project_id AND pr.user_id=$2)
      ))
    )`;
    const counts = (await db.query(
      `SELECT COUNT(*)::integer AS total_tasks,
              COUNT(*) FILTER (WHERE t.state='COMPLETED')::integer AS completed_tasks,
              COUNT(*) FILTER (WHERE t.state='ACTIVE')::integer AS active_tasks,
              COUNT(*) FILTER (WHERE t.state='PAUSED')::integer AS paused_tasks,
              COUNT(*) FILTER (WHERE t.kind='BUG')::integer AS total_bugs,
              COUNT(*) FILTER (WHERE t.kind='BUG' AND t.state='COMPLETED')::integer AS resolved_bugs,
              COUNT(*) FILTER (WHERE t.kind='BUG' AND t.state NOT IN ('COMPLETED','CANCELED'))::integer AS pending_bugs,
              COUNT(*) FILTER (WHERE t.kind='BUG' AND t.related_task_id IS NOT NULL AND t.bug_area IN ('BACKEND','BOTH') AND EXISTS (SELECT 1 FROM tasks parent WHERE parent.id=t.related_task_id AND parent.company_id=t.company_id AND parent.deleted_at IS NULL))::integer AS backend_bugs,
              COUNT(*) FILTER (WHERE t.kind='BUG' AND t.related_task_id IS NOT NULL AND t.bug_area IN ('FRONTEND','BOTH') AND EXISTS (SELECT 1 FROM tasks parent WHERE parent.id=t.related_task_id AND parent.company_id=t.company_id AND parent.deleted_at IS NULL))::integer AS frontend_bugs
       FROM tasks t JOIN workflow_stages s ON s.id=t.current_stage_id WHERE ${visible}`,
      [companyId, user.id]
    )).rows[0];
    return {
      generated_at: new Date().toISOString(),
      general: { ...counts, average_completion_seconds: 0, average_by_stage: [], distributions: { priority: [], environment: [], kind: [] } },
      priority_weights: {}, formula_version: 3, developers: [],
      refresh: { status: 'FILTERED' }
    };
  }
  const [company, developers, state] = await Promise.all([
    db.query('SELECT payload,calculated_at FROM company_metric_snapshots WHERE company_id=$1', [companyId]),
    db.query(
      `SELECT payload FROM developer_metric_snapshots WHERE company_id=$1
       ORDER BY (payload->>'productivity_rank')::integer`,
      [companyId]
    ),
    db.query('SELECT status,started_at,completed_at FROM metric_refresh_state WHERE company_id=$1', [companyId])
  ]);
  const payload = company.rows[0]?.payload || {
    generated_at: null,
    general: {
      total_tasks: 0, completed_tasks: 0, active_tasks: 0, paused_tasks: 0,
      total_bugs: 0, resolved_bugs: 0, pending_bugs: 0, backend_bugs: 0, frontend_bugs: 0,
      average_completion_seconds: 0, average_by_stage: [],
      distributions: { priority: [], environment: [], kind: [] }
    },
    priority_weights: {},
    formula_version: 3
  };
  return {
    ...payload,
    developers: developers.rows.map((row) => row.payload),
    refresh: state.rows[0] || { status: 'IDLE' }
  };
}

const DETAIL_FILTERS = Object.freeze({
  total_tasks: 'TRUE',
  completed_tasks: "t.state='COMPLETED'",
  active_tasks: "t.state='ACTIVE'",
  paused_tasks: "t.state='PAUSED'",
  total_bugs: "t.kind='BUG'",
  resolved_bugs: "t.kind='BUG' AND t.state='COMPLETED'",
  pending_bugs: "t.kind='BUG' AND t.state NOT IN ('COMPLETED','CANCELED')",
  backend_bugs: "t.kind='BUG' AND t.related_task_id IS NOT NULL AND t.bug_area IN ('BACKEND','BOTH') AND parent.deleted_at IS NULL",
  frontend_bugs: "t.kind='BUG' AND t.related_task_id IS NOT NULL AND t.bug_area IN ('FRONTEND','BOTH') AND parent.deleted_at IS NULL"
});

async function dashboardDetails(user, metric, { page = 1, limit = 20 } = {}) {
  const metricFilter = DETAIL_FILTERS[metric];
  if (!metricFilter) return null;
  const administrator = user.is_super_admin === true || user.roles?.includes('ADMIN') || user.permissions?.includes('tasks.manage');
  const values = [user.company_id];
  let visibility = 'TRUE';
  if (!administrator) {
    values.push(user.id);
    visibility = `(
      ((UPPER(stage.code)='ROADMAP' OR LOWER(TRIM(stage.name))='roadmap') AND t.created_by=$2)
      OR ((UPPER(stage.code)<>'ROADMAP' AND LOWER(TRIM(stage.name))<>'roadmap') AND (
        $2::uuid IN (t.created_by,t.requester_id,t.backend_assignee_id,t.frontend_assignee_id)
        OR EXISTS (SELECT 1 FROM project_responsibles pr WHERE pr.company_id=t.company_id AND pr.project_id=t.project_id AND pr.user_id=$2)
      ))
    )`;
  }
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  values.push(safeLimit, (safePage - 1) * safeLimit);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;
  const side = metric === 'backend_bugs' ? "'BACKEND'" : metric === 'frontend_bugs' ? "'FRONTEND'" : 'NULL::text';
  const assignee = metric === 'backend_bugs' ? 'backend_user.name' : metric === 'frontend_bugs' ? 'frontend_user.name' : 'NULL::text';
  const result = await db.query(
    `SELECT COUNT(*) OVER()::integer AS total,
            CASE WHEN t.kind='BUG' AND parent.id IS NOT NULL THEN parent.id ELSE t.id END AS task_id,
            CASE WHEN t.kind='BUG' AND parent.id IS NOT NULL THEN 'DF-' || LPAD(parent.task_number::text,6,'0') ELSE 'DF-' || LPAD(t.task_number::text,6,'0') END AS task_code,
            t.id AS record_id,'DF-' || LPAD(t.task_number::text,6,'0') AS record_code,
            t.title,t.kind,t.state,${side} AS side,${assignee} AS assignee_name,
            CASE WHEN parent.id IS NOT NULL THEN parent.title ELSE NULL END AS related_task_title
     FROM tasks t
     JOIN workflow_stages stage ON stage.id=t.current_stage_id
     LEFT JOIN tasks parent ON parent.id=t.related_task_id AND parent.company_id=t.company_id
     LEFT JOIN users backend_user ON backend_user.id=parent.backend_assignee_id
     LEFT JOIN users frontend_user ON frontend_user.id=parent.frontend_assignee_id
     WHERE t.company_id=$1 AND t.deleted_at IS NULL AND (${metricFilter}) AND (${visibility})
     ORDER BY t.created_at DESC,t.id DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values
  );
  const total = Number(result.rows[0]?.total || 0);
  return { metric, items: result.rows.map(({ total: _total, ...item }) => item), pagination: { page: safePage, limit: safeLimit, total, total_pages: Math.ceil(total / safeLimit) } };
}

module.exports = { DETAIL_FILTERS, calculateGeneral, calculateDevelopers, refreshCompany, refreshPending, dashboard, dashboardDetails };
