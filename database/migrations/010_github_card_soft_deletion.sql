-- Exclusao logica e auditavel das anotacoes GitHub, sem apagar o dossie tecnico.

ALTER TABLE task_github_metadata
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID,
    ADD CONSTRAINT task_github_metadata_deleted_by_fkey
        FOREIGN KEY (company_id,deleted_by)
        REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT;

CREATE INDEX idx_task_github_metadata_active_task
    ON task_github_metadata (company_id,task_id,created_at DESC)
    WHERE deleted_at IS NULL;
