CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(180) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO permissions (code,name,description) VALUES
    ('dashboard.view','Visualizar dashboard','Acessar métricas da empresa'),
    ('tasks.view','Visualizar tarefas','Consultar dossiês técnicos'),
    ('tasks.create','Criar tarefas','Cadastrar solicitações e bugs'),
    ('tasks.operate','Operar etapas','Registrar entregas e avançar etapas atribuídas'),
    ('tasks.manage','Administrar tarefas','Alterar responsáveis, prioridade e estado'),
    ('projects.manage','Administrar projetos','Gerenciar clientes, projetos e responsáveis'),
    ('catalogs.manage','Administrar catálogos','Gerenciar ambientes, tipos, prioridades e fluxos'),
    ('users.manage','Administrar usuários','Gerenciar associações, papéis e perfis'),
    ('audit.view','Visualizar auditoria','Consultar a trilha de auditoria da empresa')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    email VARCHAR(320) NOT NULL,
    password_hash TEXT NOT NULL,
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    must_configure_mfa BOOLEAN NOT NULL DEFAULT TRUE,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_users_email_unique
    ON users (LOWER(email)) WHERE deleted_at IS NULL;

CREATE TABLE company_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,user_id),
    UNIQUE (id,company_id)
);

CREATE UNIQUE INDEX idx_membership_one_default
    ON company_memberships (user_id) WHERE is_default=TRUE AND is_active=TRUE;
CREATE INDEX idx_memberships_company_active
    ON company_memberships (company_id,is_active,user_id);

CREATE TABLE company_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE TABLE role_permissions (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id,permission_id),
    FOREIGN KEY (role_id,company_id) REFERENCES company_roles(id,company_id) ON DELETE CASCADE
);

CREATE TABLE membership_roles (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    role_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id,role_id),
    FOREIGN KEY (membership_id,company_id) REFERENCES company_memberships(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY (role_id,company_id) REFERENCES company_roles(id,company_id) ON DELETE RESTRICT
);

CREATE TABLE technical_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE TABLE membership_technical_profiles (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    profile_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (membership_id,profile_id),
    FOREIGN KEY (membership_id,company_id) REFERENCES company_memberships(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id,company_id) REFERENCES technical_profiles(id,company_id) ON DELETE RESTRICT
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    token_version INTEGER NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(64),
    user_agent VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(80),
    FOREIGN KEY (membership_id,company_id) REFERENCES company_memberships(id,company_id) ON DELETE RESTRICT
);

CREATE INDEX idx_user_sessions_active
    ON user_sessions (user_id,company_id,revoked_at,expires_at);

CREATE TABLE user_mfa_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_secret TEXT,
    pending_encrypted_secret TEXT,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_mfa_recovery_codes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(180) NOT NULL,
    code VARCHAR(64),
    contact_name VARCHAR(160),
    contact_email VARCHAR(320),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE (company_id,name),
    UNIQUE (id,company_id)
);

CREATE TABLE environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    color_token VARCHAR(32) NOT NULL DEFAULT 'slate',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE TABLE priorities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    weight NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (weight > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    color_token VARCHAR(32) NOT NULL DEFAULT 'slate',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE TABLE task_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    applicable_kind VARCHAR(16) NOT NULL DEFAULT 'BOTH'
        CHECK (applicable_kind IN ('REQUEST','BUG','BOTH')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    task_kind VARCHAR(16) NOT NULL CHECK (task_kind IN ('REQUEST','BUG','BOTH')),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id)
);

CREATE UNIQUE INDEX idx_workflows_default_kind
    ON workflows (company_id,task_kind) WHERE is_default=TRUE AND is_active=TRUE;

CREATE TABLE workflow_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    workflow_id UUID NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    responsibility VARCHAR(32) NOT NULL
        CHECK (responsibility IN ('MANAGER','BACKEND_ASSIGNEE','FRONTEND_ASSIGNEE','ANY')),
    requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
    tracks_time BOOLEAN NOT NULL DEFAULT TRUE,
    completes_task BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workflow_id,company_id) REFERENCES workflows(id,company_id) ON DELETE RESTRICT,
    UNIQUE (workflow_id,code),
    UNIQUE (workflow_id,sort_order),
    UNIQUE (id,company_id),
    UNIQUE (id,workflow_id,company_id)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL,
    default_environment_id UUID NOT NULL,
    name VARCHAR(180) NOT NULL,
    code VARCHAR(64) NOT NULL,
    description TEXT,
    github_repository_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    FOREIGN KEY (client_id,company_id) REFERENCES clients(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (default_environment_id,company_id) REFERENCES environments(id,company_id) ON DELETE RESTRICT,
    UNIQUE (company_id,code),
    UNIQUE (id,company_id),
    UNIQUE (id,client_id,company_id)
);

CREATE TABLE project_responsibles (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    responsibility_code VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id,user_id,responsibility_code),
    FOREIGN KEY (project_id,company_id) REFERENCES projects(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY (company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_number BIGSERIAL NOT NULL,
    project_id UUID NOT NULL,
    client_id UUID NOT NULL,
    task_type_id UUID NOT NULL,
    priority_id UUID NOT NULL,
    environment_id UUID NOT NULL,
    workflow_id UUID NOT NULL,
    current_stage_id UUID NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('REQUEST','BUG')),
    title VARCHAR(240) NOT NULL,
    initial_description TEXT NOT NULL,
    requester_id UUID NOT NULL,
    client_environment VARCHAR(240),
    product_affected VARCHAR(240),
    related_requirement TEXT,
    related_task_id UUID,
    bug_area VARCHAR(16) CHECK (bug_area IS NULL OR bug_area IN ('BACKEND','FRONTEND','BOTH')),
    initial_evidence TEXT,
    backend_assignee_id UUID NOT NULL,
    frontend_assignee_id UUID NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (state IN ('ACTIVE','PAUSED','CANCELED','COMPLETED')),
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rework_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    FOREIGN KEY (project_id,client_id,company_id) REFERENCES projects(id,client_id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (task_type_id,company_id) REFERENCES task_types(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (priority_id,company_id) REFERENCES priorities(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id,company_id) REFERENCES environments(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (workflow_id,company_id) REFERENCES workflows(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_stage_id,workflow_id,company_id)
        REFERENCES workflow_stages(id,workflow_id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,requester_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,backend_assignee_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,frontend_assignee_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,created_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (related_task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    UNIQUE (company_id,task_number),
    UNIQUE (id,company_id),
    CHECK (
        (kind='REQUEST')
        OR (kind='BUG' AND product_affected IS NOT NULL AND related_requirement IS NOT NULL
            AND bug_area IS NOT NULL AND initial_evidence IS NOT NULL)
    )
);

CREATE INDEX idx_tasks_company_filters
    ON tasks (company_id,state,current_stage_id,priority_id,kind,created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_company_assignees
    ON tasks (company_id,backend_assignee_id,frontend_assignee_id,state);

CREATE TABLE task_stage_intervals (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    stage_code_snapshot VARCHAR(64) NOT NULL,
    stage_name_snapshot VARCHAR(120) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id,company_id) REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX idx_task_stage_open_interval
    ON task_stage_intervals (task_id) WHERE ended_at IS NULL;
CREATE INDEX idx_task_stage_duration
    ON task_stage_intervals (company_id,task_id,stage_id);

CREATE TABLE task_stage_submissions (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    technical_notes TEXT,
    observations TEXT,
    updated_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id,stage_id),
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id,company_id) REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,updated_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE task_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    description TEXT NOT NULL,
    result VARCHAR(16) NOT NULL CHECK (result IN ('PASSED','FAILED','BLOCKED')),
    evidence TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id,company_id) REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,created_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_task_tests_context
    ON task_tests (company_id,task_id,stage_id,created_at DESC);

CREATE TABLE task_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
    notes TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id,company_id) REFERENCES workflow_stages(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,created_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE task_github_metadata (
    task_id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    repository_url TEXT,
    branch VARCHAR(255),
    commit_sha VARCHAR(64),
    pull_request_url TEXT,
    release VARCHAR(255),
    updated_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,updated_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    content TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,created_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_task_comments_timeline
    ON task_comments (company_id,task_id,created_at);

CREATE TABLE task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256 CHAR(64) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,created_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,deleted_by) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE task_events (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    description TEXT NOT NULL,
    previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID NOT NULL,
    ip_address VARCHAR(64),
    request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id,actor_id) REFERENCES company_memberships(company_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_task_events_timeline
    ON task_events (company_id,task_id,created_at,id);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    task_id UUID,
    notification_type VARCHAR(80) NOT NULL,
    title VARCHAR(240) NOT NULL,
    body TEXT NOT NULL,
    email_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (email_status IN ('PENDING','SENT','SKIPPED','FAILED')),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id,company_id) REFERENCES tasks(id,company_id) ON DELETE RESTRICT
);

CREATE INDEX idx_notifications_user_unread
    ON notifications (company_id,user_id,read_at,created_at DESC);

CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(320),
    operation VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80),
    entity_id UUID,
    previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    user_agent VARCHAR(1000),
    request_id UUID,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS','DENIED','FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_events_company_created
    ON audit_events (company_id,created_at DESC);

CREATE TABLE company_metric_snapshots (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    formula_version INTEGER NOT NULL DEFAULT 1,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE developer_metric_snapshots (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id,user_id),
    FOREIGN KEY (company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE CASCADE
);

CREATE TABLE metric_refresh_state (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('IDLE','RUNNING','SUCCESS','FAILED')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    version INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION prevent_immutable_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Registros históricos são imutáveis';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    immutable_table TEXT;
BEGIN
    FOREACH immutable_table IN ARRAY ARRAY[
        'task_events','task_comments','task_tests','task_approvals','audit_events'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation()',
            immutable_table,
            immutable_table
        );
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION protect_super_admin()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_super_admin=TRUE AND (
        NEW.is_super_admin=FALSE OR NEW.is_active=FALSE OR NEW.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'O Super Admin não pode ser rebaixado, desativado ou excluído';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_super_admin
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION protect_super_admin();
