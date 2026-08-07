BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS link_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(240);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency
  ON notifications (company_id,user_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE notification_preferences (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    internal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    task_movement BOOLEAN NOT NULL DEFAULT TRUE,
    assignments BOOLEAN NOT NULL DEFAULT TRUE,
    overdue BOOLEAN NOT NULL DEFAULT TRUE,
    security BOOLEAN NOT NULL DEFAULT TRUE CHECK (security = TRUE),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id,user_id),
    FOREIGN KEY (company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE CASCADE
);

CREATE TABLE email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
    recipient_email VARCHAR(320) NOT NULL,
    template_code VARCHAR(80) NOT NULL,
    encrypted_payload TEXT NOT NULL,
    idempotency_key VARCHAR(240) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email_outbox_delivery
  ON email_outbox (status,available_at,created_at)
  WHERE status IN ('PENDING','PROCESSING');

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_reset_user_active
  ON password_reset_tokens (user_id,expires_at DESC)
  WHERE used_at IS NULL;

COMMIT;
