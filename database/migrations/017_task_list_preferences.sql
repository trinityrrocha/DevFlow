CREATE TABLE IF NOT EXISTS user_task_list_preferences (
    company_id UUID NOT NULL,
    user_id UUID NOT NULL,
    grouping VARCHAR(16) NOT NULL DEFAULT 'none',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, user_id),
    CONSTRAINT user_task_list_preferences_membership_fk
        FOREIGN KEY (company_id, user_id)
        REFERENCES company_memberships(company_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT user_task_list_preferences_grouping_check
        CHECK (grouping IN ('none', 'stage', 'user', 'priority', 'type'))
);

-- O tipo canônico mantém o código/ID e apenas explicita seu nome de domínio.
UPDATE task_types
SET name = 'Report Bug', updated_at = CURRENT_TIMESTAMP
WHERE code = 'BUG_REPORT'
  AND is_system = TRUE
  AND name = 'Bug';
