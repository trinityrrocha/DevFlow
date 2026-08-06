ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS estimated_duration_seconds BIGINT
        CHECK (estimated_duration_seconds IS NULL OR estimated_duration_seconds BETWEEN 60 AND 31536000),
    ADD COLUMN IF NOT EXISTS timer_status VARCHAR(20) NOT NULL DEFAULT 'not_started'
        CHECK (timer_status IN ('not_started','running','paused','completed','cancelled')),
    ADD COLUMN IF NOT EXISTS timer_last_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timer_ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS active_elapsed_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_elapsed_seconds>=0),
    ADD COLUMN IF NOT EXISTS paused_elapsed_seconds BIGINT NOT NULL DEFAULT 0 CHECK (paused_elapsed_seconds>=0),
    ADD COLUMN IF NOT EXISTS timer_started_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS timer_paused_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS timer_resumed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS task_timer_events (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    event_type VARCHAR(32) NOT NULL
        CHECK (event_type IN ('STARTED','PAUSED','RESUMED','COMPLETED','CANCELLED','ESTIMATE_CHANGED','OVERDUE')),
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    previous_estimate_seconds BIGINT,
    new_estimate_seconds BIGINT,
    active_elapsed_seconds BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tasks_visibility_stage
    ON tasks (company_id,current_stage_id,created_by,state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_timer_status
    ON tasks (company_id,timer_status,is_overdue) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_timer_events_task
    ON task_timer_events (company_id,task_id,created_at DESC);
