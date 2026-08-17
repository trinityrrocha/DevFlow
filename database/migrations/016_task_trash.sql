-- Lixeira auditavel de tarefas e suporte ao purge permanente controlado.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS deleted_by UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tasks_deleted_by_membership_fk'
          AND conrelid = 'tasks'::regclass
    ) THEN
        ALTER TABLE tasks
            ADD CONSTRAINT tasks_deleted_by_membership_fk
            FOREIGN KEY (company_id, deleted_by)
            REFERENCES company_memberships(company_id, user_id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_trash
    ON tasks (company_id, deleted_at DESC, task_number)
    WHERE deleted_at IS NOT NULL;

-- A exclusao permanente e a unica excecao para remover registros do dossie.
-- O backend habilita esta flag apenas dentro da transacao protegida do purge.
CREATE OR REPLACE FUNCTION prevent_immutable_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('devflow.task_purge', TRUE) = 'enabled' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Registros históricos são imutáveis';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE task_stage_touch_sessions
    DROP CONSTRAINT IF EXISTS task_stage_touch_sessions_end_reason_check;

ALTER TABLE task_stage_touch_sessions
    ADD CONSTRAINT task_stage_touch_sessions_end_reason_check
    CHECK (
        end_reason IS NULL OR end_reason IN (
            'PAUSED','STAGE_TRANSITION','TASK_PAUSED','TASK_CANCELLED','TASK_DELETED'
        )
    );
