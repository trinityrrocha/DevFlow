-- Campos estruturados para anotacoes de codigo dos cards GitHub.

ALTER TABLE task_github_metadata
    ADD COLUMN file_name VARCHAR(500),
    ADD COLUMN language VARCHAR(64) NOT NULL DEFAULT 'plaintext',
    ADD COLUMN code_content TEXT,
    ADD COLUMN explanation TEXT,
    ADD COLUMN author_id UUID,
    ADD COLUMN stage_id UUID,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE task_github_metadata
SET author_id = created_by,
    explanation = COALESCE(explanation, notes_code),
    file_name = COALESCE(NULLIF(BTRIM(file_name),''), NULLIF(BTRIM(title),'')),
    language = COALESCE(NULLIF(BTRIM(language),''), 'plaintext'),
    created_at = updated_at;

ALTER TABLE task_github_metadata
    ALTER COLUMN author_id SET NOT NULL,
    ADD CONSTRAINT task_github_metadata_author_fkey
        FOREIGN KEY (company_id,author_id)
        REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    ADD CONSTRAINT task_github_metadata_stage_fkey
        FOREIGN KEY (stage_id) REFERENCES workflow_stages(id) ON DELETE RESTRICT,
    ADD CONSTRAINT task_github_metadata_language_check
        CHECK (language ~ '^[a-z0-9_+#.-]{1,64}$');

CREATE INDEX idx_task_github_metadata_author
    ON task_github_metadata (company_id,author_id,created_at DESC);
