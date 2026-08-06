ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(32),
    ADD COLUMN IF NOT EXISTS pending_email VARCHAR(320),
    ADD COLUMN IF NOT EXISTS email_verification_token_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verification_requested_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pending_email_unique
    ON users (LOWER(pending_email))
    WHERE pending_email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_verification_expiry
    ON users (email_verification_expires_at)
    WHERE email_verification_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_events (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN ('LOGIN','LOGOUT','EXPIRED','REVOKED','PASSWORD_CHANGED','USER_DISABLED','MEMBERSHIP_CHANGED')),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(80),
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_created
    ON session_events (session_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_events_company_user
    ON session_events (company_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_company_status
    ON user_sessions (company_id,revoked_at,expires_at,last_seen_at DESC);
