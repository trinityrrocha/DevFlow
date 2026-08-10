-- Reconciliacao para ambientes que registraram a versao antiga da migration 012
-- quando task_tests ainda estava vazia e o trigger imutavel nao chegou a disparar.

DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests;

ALTER TABLE task_attachments
    ADD COLUMN IF NOT EXISTS source_section VARCHAR(50);

ALTER TABLE task_attachments
    ALTER COLUMN source_section TYPE VARCHAR(50)
    USING source_section::VARCHAR(50);
