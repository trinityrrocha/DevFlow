-- Registros estruturados de QA e rastreabilidade da origem dos anexos.

CREATE TABLE IF NOT EXISTS task_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    description TEXT NOT NULL,
    result VARCHAR(16) NOT NULL CHECK (result IN ('PASSED', 'FAILED', 'BLOCKED')),
    evidence TEXT,
    tested_as_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    tested_as_admin BOOLEAN NOT NULL DEFAULT FALSE,
    tested_as_user BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id, company_id) REFERENCES tasks(id, company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id, company_id) REFERENCES workflow_stages(id, company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, created_by) REFERENCES company_memberships(company_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_task_tests_context
    ON task_tests (company_id, task_id, stage_id, created_at DESC);

ALTER TABLE task_tests
    ADD COLUMN IF NOT EXISTS tested_as_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tested_as_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tested_as_user BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS author_id UUID,
    ADD COLUMN IF NOT EXISTS context TEXT,
    ADD COLUMN IF NOT EXISTS validated_profiles TEXT,
    ADD COLUMN IF NOT EXISTS environment VARCHAR(24),
    ADD COLUMN IF NOT EXISTS backend_info TEXT,
    ADD COLUMN IF NOT EXISTS frontend_info TEXT,
    ADD COLUMN IF NOT EXISTS testing_notes TEXT,
    ADD COLUMN IF NOT EXISTS status VARCHAR(24),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- A partir desta revisao, testes de QA aceitam edicao auditada e exclusao logica.
-- O trigger legado tambem impedia o backfill abaixo e gerava SQLSTATE P0001.
DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests;

UPDATE task_tests
SET author_id = COALESCE(author_id, created_by),
    context = COALESCE(context, description),
    validated_profiles = COALESCE(validated_profiles, NULLIF(CONCAT_WS(', ',
        CASE WHEN tested_as_super_admin THEN 'Super Admin' END,
        CASE WHEN tested_as_admin THEN 'Admin' END,
        CASE WHEN tested_as_user THEN 'Usuario' END
    ), ''), 'Nao informado'),
    environment = COALESCE(environment, 'local'),
    backend_info = COALESCE(backend_info, ''),
    frontend_info = COALESCE(frontend_info, ''),
    testing_notes = COALESCE(testing_notes, evidence, ''),
    status = COALESCE(status, CASE WHEN result = 'PASSED' THEN 'APPROVED' ELSE 'NOT_APPROVED' END),
    updated_at = COALESCE(updated_at, created_at);

ALTER TABLE task_tests
    ALTER COLUMN author_id SET NOT NULL,
    ALTER COLUMN context SET NOT NULL,
    ALTER COLUMN validated_profiles SET NOT NULL,
    ALTER COLUMN environment SET NOT NULL,
    ALTER COLUMN backend_info SET NOT NULL,
    ALTER COLUMN frontend_info SET NOT NULL,
    ALTER COLUMN testing_notes SET NOT NULL,
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE task_tests DROP CONSTRAINT IF EXISTS task_tests_environment_check;
ALTER TABLE task_tests ADD CONSTRAINT task_tests_environment_check
    CHECK (environment IN ('local', 'local_nuvem'));

ALTER TABLE task_tests DROP CONSTRAINT IF EXISTS task_tests_status_check;
ALTER TABLE task_tests ADD CONSTRAINT task_tests_status_check
    CHECK (status IN ('APPROVED', 'NOT_APPROVED'));

ALTER TABLE task_tests DROP CONSTRAINT IF EXISTS task_tests_author_membership_fk;
ALTER TABLE task_tests ADD CONSTRAINT task_tests_author_membership_fk
    FOREIGN KEY (company_id, author_id)
    REFERENCES company_memberships(company_id, user_id) ON DELETE RESTRICT;

ALTER TABLE task_tests DROP CONSTRAINT IF EXISTS task_tests_deleted_by_membership_fk;
ALTER TABLE task_tests ADD CONSTRAINT task_tests_deleted_by_membership_fk
    FOREIGN KEY (company_id, deleted_by)
    REFERENCES company_memberships(company_id, user_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_task_tests_active_timeline
    ON task_tests (company_id, task_id, created_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE task_attachments
    ADD COLUMN IF NOT EXISTS source_section VARCHAR(50);

UPDATE task_attachments
SET source_section = CASE
    WHEN test_id IS NOT NULL THEN 'testes'
    WHEN comment_id IS NOT NULL THEN 'comentarios'
    ELSE COALESCE(source_section, 'geral')
END;

ALTER TABLE task_attachments
    ALTER COLUMN source_section SET DEFAULT 'geral',
    ALTER COLUMN source_section SET NOT NULL;

ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attachments_source_section_check;
ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_source_section_check
    CHECK (source_section IN ('geral', 'backend', 'frontend', 'testes', 'github', 'comentarios'));

CREATE INDEX IF NOT EXISTS idx_task_attachments_source_timeline
    ON task_attachments (company_id, task_id, source_section, created_at DESC)
    WHERE deleted_at IS NULL;
