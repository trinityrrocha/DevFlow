const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('modulo estruturado de QA e origem dos anexos', () => {
  const initialMigration = read('../database/migrations/001_initial_schema.sql');
  const migration = read('../database/migrations/012_qa_tests_and_attachment_sources.sql');
  const repairMigration = read('../database/migrations/013_qa_tests_idempotency_repair.sql');
  const controller = read('src/controllers/taskController.js');
  const service = read('src/services/taskService.js');
  const attachmentService = read('src/services/attachmentService.js');
  const routes = read('src/routes/taskRoutes.js');

  it('evolui task_tests sem perder o contrato legado e preserva exclusao logica', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS task_tests');
    expect(initialMigration).toContain("'task_events','task_comments','task_tests','task_approvals','audit_events'");
    expect(initialMigration).toContain("RAISE EXCEPTION 'Registros hist");
    for (const legacyColumn of ['tested_as_super_admin', 'tested_as_admin', 'tested_as_user']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${legacyColumn}`);
    }
    for (const column of ['author_id', 'context', 'validated_profiles', 'environment', 'backend_info', 'frontend_info', 'testing_notes', 'status', 'updated_at', 'deleted_at']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests');
    expect(migration.indexOf('DROP TRIGGER IF EXISTS trg_task_tests_immutable')).toBeLessThan(migration.indexOf('UPDATE task_tests'));
    expect(migration).not.toContain('RAISE EXCEPTION');
    expect(migration).not.toMatch(/CREATE\s+TYPE[\s\S]*ENUM/iu);
    expect(repairMigration).toContain('DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests');
    expect(repairMigration).not.toContain('RAISE EXCEPTION');
    expect(migration).toContain("CHECK (environment IN ('local', 'local_nuvem'))");
    expect(migration).toContain("CHECK (status IN ('APPROVED', 'NOT_APPROVED'))");
    expect(service).toContain('author_id,context,validated_profiles,environment');
    expect(service).toContain('test.author_id === user?.id');
    expect(service).toContain('SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$4');
    expect(service).toContain('AND test.deleted_at IS NULL');
  });

  it('deriva a autoria da sessao e expoe CRUD protegido para os testes', () => {
    expect(controller).not.toContain('req.body.author_id');
    expect(service).toContain('req.user.id, payload.context');
    expect(routes).toContain("router.patch('/:id/tests/:testId'");
    expect(routes).toContain("router.delete('/:id/tests/:testId'");
  });

  it('valida e persiste a origem em todos os contextos de anexo', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_section VARCHAR(50)');
    for (const source of ['geral', 'backend', 'frontend', 'testes', 'github', 'comentarios']) {
      expect(migration).toContain(`'${source}'`);
      expect(controller).toContain(`'${source}'`);
    }
    expect(attachmentService).toContain('context.sourceSection === \'testes\'');
    expect(attachmentService).toContain('context.sourceSection === \'comentarios\'');
    expect(attachmentService).toContain('source_section,created_at');
  });
});
