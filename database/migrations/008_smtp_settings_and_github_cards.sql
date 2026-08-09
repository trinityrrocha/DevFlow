-- Configuracao SMTP global cifrada e registros GitHub 1:N por tarefa.

CREATE TABLE smtp_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    host VARCHAR(255) NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
    security VARCHAR(20) NOT NULL DEFAULT 'starttls'
        CHECK (security IN ('ssl_tls','starttls')),
    username VARCHAR(320) NOT NULL DEFAULT '',
    encrypted_password TEXT,
    from_name VARCHAR(160) NOT NULL DEFAULT 'DevFlow',
    from_email VARCHAR(320) NOT NULL DEFAULT '',
    reply_to VARCHAR(320),
    timeout_seconds INTEGER NOT NULL DEFAULT 15 CHECK (timeout_seconds BETWEEN 1 AND 120),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO smtp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE task_github_metadata
    ADD COLUMN id UUID DEFAULT gen_random_uuid(),
    ADD COLUMN title VARCHAR(160) DEFAULT 'Registro GitHub',
    ADD COLUMN notes_code TEXT,
    ADD COLUMN created_by UUID;

UPDATE task_github_metadata
SET notes_code = COALESCE(notes_code, code_reference),
    created_by = COALESCE(created_by, updated_by),
    title = COALESCE(NULLIF(BTRIM(title),''), NULLIF(BTRIM(branch),''), 'Registro GitHub');

ALTER TABLE task_github_metadata
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN title SET NOT NULL,
    ALTER COLUMN created_by SET NOT NULL,
    DROP CONSTRAINT task_github_metadata_pkey,
    ADD CONSTRAINT task_github_metadata_pkey PRIMARY KEY (id),
    ADD CONSTRAINT task_github_metadata_created_by_fkey
        FOREIGN KEY (company_id,created_by)
        REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT;

CREATE INDEX idx_task_github_metadata_task
    ON task_github_metadata (company_id,task_id,updated_at DESC);
