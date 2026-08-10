ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS current_stage_entered_at TIMESTAMPTZ;

ALTER TABLE task_timer_events
    ADD COLUMN IF NOT EXISTS stage_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'task_timer_events_stage_company_fk'
    ) THEN
        ALTER TABLE task_timer_events
            ADD CONSTRAINT task_timer_events_stage_company_fk
            FOREIGN KEY (stage_id,company_id)
            REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_timer_events_stage
    ON task_timer_events (company_id,task_id,stage_id,created_at DESC);

CREATE TABLE IF NOT EXISTS task_stage_touch_sessions (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    user_id UUID NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds>=0),
    end_reason VARCHAR(32) CHECK (
        end_reason IS NULL OR end_reason IN (
            'PAUSED','STAGE_TRANSITION','TASK_PAUSED','TASK_CANCELLED'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id,company_id) REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    CHECK (ended_at IS NULL OR ended_at>=started_at),
    CHECK ((ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_stage_touch_open_user
    ON task_stage_touch_sessions (task_id,stage_id,user_id)
    WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_stage_touch_metrics
    ON task_stage_touch_sessions (company_id,task_id,stage_id,user_id,started_at);

UPDATE tasks task
SET current_stage_entered_at=COALESCE(
    (
        SELECT interval.started_at
        FROM task_stage_intervals interval
        WHERE interval.task_id=task.id
          AND interval.company_id=task.company_id
          AND interval.stage_id=task.current_stage_id
          AND interval.ended_at IS NULL
        ORDER BY interval.started_at DESC
        LIMIT 1
    ),
    task.started_at,
    task.created_at
)
FROM workflow_stages stage
WHERE stage.id=task.current_stage_id
  AND stage.company_id=task.company_id
  AND task.state='ACTIVE'
  AND stage.tracks_time=TRUE
  AND stage.completes_task=FALSE
  AND UPPER(stage.code)<>'ROADMAP'
  AND LOWER(TRIM(stage.name))<>'roadmap'
  AND task.current_stage_entered_at IS NULL;

INSERT INTO task_stage_touch_sessions (
    company_id,task_id,stage_id,user_id,started_at,ended_at,active_seconds,end_reason
)
SELECT task.company_id,task.id,task.current_stage_id,
       COALESCE(task.timer_resumed_by,task.timer_started_by,
           CASE stage.responsibility
               WHEN 'FRONTEND_ASSIGNEE' THEN task.frontend_assignee_id
               ELSE task.backend_assignee_id
           END),
       COALESCE(task.current_stage_entered_at,task.started_at,task.created_at),
       CURRENT_TIMESTAMP,
       task.active_elapsed_seconds,
       'PAUSED'
FROM tasks task
JOIN workflow_stages stage
  ON stage.id=task.current_stage_id AND stage.company_id=task.company_id
WHERE task.active_elapsed_seconds>0
  AND UPPER(stage.code)<>'ROADMAP'
  AND LOWER(TRIM(stage.name))<>'roadmap'
  AND NOT EXISTS (
      SELECT 1 FROM task_stage_touch_sessions session
      WHERE session.task_id=task.id
        AND session.company_id=task.company_id
        AND session.stage_id=task.current_stage_id
  );

INSERT INTO task_stage_touch_sessions (
    company_id,task_id,stage_id,user_id,started_at
)
SELECT task.company_id,task.id,task.current_stage_id,
       COALESCE(task.timer_resumed_by,task.timer_started_by,
           CASE stage.responsibility
               WHEN 'FRONTEND_ASSIGNEE' THEN task.frontend_assignee_id
               ELSE task.backend_assignee_id
           END),
       COALESCE(task.timer_last_started_at,CURRENT_TIMESTAMP)
FROM tasks task
JOIN workflow_stages stage
  ON stage.id=task.current_stage_id AND stage.company_id=task.company_id
WHERE task.timer_status='running'
  AND UPPER(stage.code)<>'ROADMAP'
  AND LOWER(TRIM(stage.name))<>'roadmap'
  AND NOT EXISTS (
      SELECT 1 FROM task_stage_touch_sessions session
      WHERE session.task_id=task.id
        AND session.company_id=task.company_id
        AND session.stage_id=task.current_stage_id
        AND session.ended_at IS NULL
  );
