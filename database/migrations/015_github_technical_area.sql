-- Classificacao semantica das anotacoes GitHub para a timeline tecnica.
ALTER TABLE task_github_metadata
    ADD COLUMN IF NOT EXISTS technical_area VARCHAR(16) NOT NULL DEFAULT 'BOTH';

ALTER TABLE task_github_metadata
    DROP CONSTRAINT IF EXISTS task_github_metadata_technical_area_check;

ALTER TABLE task_github_metadata
    ADD CONSTRAINT task_github_metadata_technical_area_check
    CHECK (technical_area IN ('BACKEND','FRONTEND','BOTH'));

CREATE INDEX IF NOT EXISTS idx_task_github_metadata_technical_area
    ON task_github_metadata (company_id,task_id,technical_area,created_at DESC)
    WHERE deleted_at IS NULL;

UPDATE metric_refresh_state
SET status='IDLE',error_code=NULL
WHERE status IN ('SUCCESS','FAILED');
