-- Codigos publicos gerados e contexto de colaboracao do dossie tecnico.

UPDATE clients
SET code = 'CLI_' || UPPER(REPLACE(id::text, '-', ''))
WHERE code IS NULL OR BTRIM(code) = '';

ALTER TABLE clients ALTER COLUMN code SET NOT NULL;

ALTER TABLE task_tests
    ADD COLUMN IF NOT EXISTS tested_as_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tested_as_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tested_as_user BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE task_github_metadata
    ADD COLUMN IF NOT EXISTS code_reference TEXT;

ALTER TABLE task_tests
    ADD CONSTRAINT task_tests_attachment_scope UNIQUE (id, company_id, task_id);

ALTER TABLE task_comments
    ADD CONSTRAINT task_comments_attachment_scope UNIQUE (id, company_id, task_id);

ALTER TABLE task_attachments
    ADD COLUMN IF NOT EXISTS test_id UUID,
    ADD COLUMN IF NOT EXISTS comment_id UUID;

ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attachments_single_context;
ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_single_context
    CHECK (NOT (test_id IS NOT NULL AND comment_id IS NOT NULL));

ALTER TABLE task_attachments
    ADD CONSTRAINT task_attachments_test_scope
        FOREIGN KEY (test_id, company_id, task_id)
        REFERENCES task_tests(id, company_id, task_id) ON DELETE RESTRICT,
    ADD CONSTRAINT task_attachments_comment_scope
        FOREIGN KEY (comment_id, company_id, task_id)
        REFERENCES task_comments(id, company_id, task_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_task_attachments_test
    ON task_attachments (company_id, task_id, test_id, created_at DESC)
    WHERE deleted_at IS NULL AND test_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_attachments_comment
    ON task_attachments (company_id, task_id, comment_id, created_at)
    WHERE deleted_at IS NULL AND comment_id IS NOT NULL;
