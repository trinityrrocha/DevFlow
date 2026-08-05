ALTER TABLE users
    ALTER COLUMN must_configure_mfa SET DEFAULT FALSE;

UPDATE users
SET must_configure_mfa = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE must_configure_mfa = TRUE;

CREATE TABLE mfa_policy_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
    enforcement_mode VARCHAR(16) NOT NULL DEFAULT 'optional'
        CHECK (enforcement_mode IN ('optional','admins','all')),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mfa_policy_settings (singleton,enforcement_mode)
VALUES (TRUE,'optional')
ON CONFLICT (singleton) DO NOTHING;
