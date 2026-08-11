-- Insere a aprovacao do frontend nos fluxos existentes sem alterar IDs de etapas ou tarefas.
-- A atualizacao descendente preserva a restricao UNIQUE (workflow_id, sort_order).

DO $$
DECLARE
    workflow_record RECORD;
    stage_record RECORD;
BEGIN
    FOR workflow_record IN
        SELECT frontend.company_id,
               frontend.workflow_id,
               frontend.sort_order AS frontend_sort_order
        FROM workflow_stages frontend
        WHERE frontend.code = 'FRONTEND'
          AND frontend.is_active = TRUE
          AND NOT EXISTS (
              SELECT 1
              FROM workflow_stages approval
              WHERE approval.workflow_id = frontend.workflow_id
                AND approval.code = 'FRONTEND_APPROVAL'
          )
    LOOP
        FOR stage_record IN
            SELECT id, sort_order
            FROM workflow_stages
            WHERE workflow_id = workflow_record.workflow_id
              AND sort_order > workflow_record.frontend_sort_order
            ORDER BY sort_order DESC
        LOOP
            UPDATE workflow_stages
            SET sort_order = stage_record.sort_order + 10,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = stage_record.id;
        END LOOP;

        INSERT INTO workflow_stages (
            company_id, workflow_id, code, name, sort_order, responsibility,
            requirements, tracks_time, completes_task, is_active
        ) VALUES (
            workflow_record.company_id,
            workflow_record.workflow_id,
            'FRONTEND_APPROVAL',
            'Aprovação do Frontend',
            workflow_record.frontend_sort_order + 10,
            'MANAGER',
            '{"approval": true}'::jsonb,
            TRUE,
            FALSE,
            TRUE
        );
    END LOOP;
END $$;

UPDATE workflow_stages
SET name = 'Aprovação do Frontend',
    responsibility = 'MANAGER',
    requirements = jsonb_set(COALESCE(requirements, '{}'::jsonb), '{approval}', 'true'::jsonb, TRUE),
    tracks_time = TRUE,
    completes_task = FALSE,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'FRONTEND_APPROVAL'
  AND EXISTS (
      SELECT 1
      FROM workflow_stages frontend
      WHERE frontend.workflow_id = workflow_stages.workflow_id
        AND frontend.code = 'FRONTEND'
  );
