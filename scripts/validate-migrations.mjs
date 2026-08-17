import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Migration test failed: ${label}`);
  checks.push(label);
};

process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_USER = 'devflow_test';
process.env.DB_PASSWORD = 'migration-test-placeholder';
process.env.DB_NAME = 'devflow_test';
process.env.JWT_SECRET = 'migration-test-jwt-placeholder-that-is-long-enough-for-validation-000000';
process.env.ADMIN_BOOTSTRAP_TOKEN = 'migration-test-bootstrap-placeholder-that-is-long-enough-000000';
process.env.UPDATE_REQUEST_SECRET = 'migration-test-update-request-secret-placeholder-that-is-long-enough-000000';
process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
process.env.SUPER_ADMIN_EMAIL = 'migration-test@example.invalid';
const require = createRequire(import.meta.url);
const { discoverMigrationFiles, migrate } = require('../backend/scripts/migrate.js');

const dockerfile = read('backend/Dockerfile');
const compose = read('docker-compose.yml');
const common = read('scripts/lib/common.sh');
const install = read('scripts/install.sh');
const transaction = read('scripts/lib/install-transaction.sh');
const update = read('scripts/update.sh');
const migrationSource = read('backend/scripts/migrate.js');
const qaMigration = read('database/migrations/012_qa_tests_and_attachment_sources.sql');
const qaRepairMigration = read('database/migrations/013_qa_tests_idempotency_repair.sql');
const frontendApprovalMigration = read('database/migrations/014_frontend_approval_stage.sql');
const taskTrashMigration = read('database/migrations/016_task_trash.sql');
const taskListPreferencesMigration = read('database/migrations/017_task_list_preferences.sql');
const initialMigration = resolve(root, 'database/migrations/001_initial_schema.sql');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-migrations-'));

const captureLogs = async (operation) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...values) => lines.push(values.join(' '));
  try { return { value: await operation(), lines }; } finally { console.log = originalLog; }
};

const fakeDatabase = ({ alreadyApplied = false, failSql = false } = {}) => {
  const queries = [];
  const client = {
    async query(sql, parameters) {
      const normalized = String(sql).trim();
      queries.push({ sql: normalized, parameters });
      if (normalized.startsWith('SELECT 1 FROM schema_migrations')) {
        return { rowCount: alreadyApplied ? 1 : 0 };
      }
      if (normalized === 'SELECT migration_test_statement;' && failSql) {
        const error = new Error('synthetic SQL failure');
        error.code = 'TEST_SQL_FAILURE';
        throw error;
      }
      return { rowCount: 0 };
    },
    release() { queries.push({ sql: 'RELEASE' }); },
  };
  return {
    queries,
    database: { pool: { async connect() { return client; } } },
  };
};

try {
  check('/database/migrations source and image validation exist', existsSync(resolve(root, 'database/migrations'))
    && common.includes('validate_backend_migration_image'));
  check('initial migration exists', existsSync(initialMigration));
  check('MIGRATIONS_DIR is permanent in image', dockerfile.includes('ENV MIGRATIONS_DIR=/database/migrations'));
  check('MIGRATIONS_DIR is explicit in Compose', /MIGRATIONS_DIR:\s*\/database\/migrations/u.test(compose));
  check('Compose run uses centralized official command', common.includes('run --rm --no-deps backend node scripts/migrate.js')
    && install.includes('run_devflow_migrations') && update.includes('run_devflow_migrations'));
  check('backend CMD runs the same migration script', dockerfile.includes('CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]'));

  const missing = resolve(temporary, 'missing');
  let missingError;
  try { await captureLogs(() => discoverMigrationFiles(missing)); } catch (error) { missingError = error; }
  check('missing directory is rejected with path and ENOENT', missingError?.code === 'ENOENT'
    && missingError.migrationDirectory === missing
    && migrationSource.includes('Diretório de migrations não encontrado.')
    && migrationSource.includes('console.error(`path=${error.migrationDirectory || migrationsDirectory}`)'));

  const empty = resolve(temporary, 'empty');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(empty));
  let emptyError;
  try { await captureLogs(() => discoverMigrationFiles(empty)); } catch (error) { emptyError = error; }
  check('empty directory is blocked', emptyError?.code === 'MIGRATIONS_EMPTY');

  const fixture = resolve(temporary, 'fixture');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(fixture));
  writeFileSync(resolve(fixture, '001_test.sql'), 'SELECT migration_test_statement;\n');
  writeFileSync(resolve(fixture, 'README.md'), 'ignored\n');
  const discovered = await captureLogs(() => discoverMigrationFiles(fixture));
  check('existing SQL file is detected', discovered.value.length === 1
    && discovered.value[0] === '001_test.sql' && discovered.lines.includes('migration_files_detected=1'));

  const applied = fakeDatabase();
  const appliedLogs = await captureLogs(() => migrate({ directory: fixture, database: applied.database }));
  check('migration is applied and recorded', applied.queries.some(({ sql }) => sql === 'INSERT INTO schema_migrations (version) VALUES ($1)')
    && appliedLogs.lines.includes('migration_applied=001_test.sql'));

  const existing = fakeDatabase({ alreadyApplied: true });
  const existingLogs = await captureLogs(() => migrate({ directory: fixture, database: existing.database }));
  check('already applied migration is skipped', !existing.queries.some(({ sql }) => sql === 'BEGIN')
    && existingLogs.lines.includes('migration_already_applied=001_test.sql'));

  const failed = fakeDatabase({ failSql: true });
  let sqlError;
  try { await captureLogs(() => migrate({ directory: fixture, database: failed.database })); } catch (error) { sqlError = error; }
  check('SQL failure rolls back', sqlError?.code === 'TEST_SQL_FAILURE'
    && failed.queries.some(({ sql }) => sql === 'ROLLBACK'));
  check('advisory lock is acquired and released', applied.queries.some(({ sql }) => sql.includes('pg_advisory_lock'))
    && applied.queries.some(({ sql }) => sql.includes('pg_advisory_unlock')));
  check('ARM64 remains supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64')
    && dockerfile.startsWith('FROM node:22-alpine'));
  check('PostgreSQL 16 Alpine remains selected', compose.includes('image: postgres:16-alpine'));

  check('resume retains migration stage', install.includes('--resume') && transaction.includes('11-migrations'));
  check('backend image is always built before migrations', install.indexOf('build backend frontend') < install.indexOf('run_devflow_migrations'));
  check('database is preserved on installation failure', !install.includes('down --volumes')
    && install.includes('Containers existentes foram preservados'));
  check('migration runtime is non-root', dockerfile.includes('USER devflow') && !common.includes('--user root'));
  check('migration flow is independent from neighboring applications', !install.toLowerCase().includes('fullpassword') && !update.toLowerCase().includes('fullpassword'));
  check('QA migration creates table and indexes defensively', qaMigration.includes('CREATE TABLE IF NOT EXISTS task_tests')
    && qaMigration.includes('CREATE INDEX IF NOT EXISTS idx_task_tests_context')
    && qaMigration.includes('CREATE INDEX IF NOT EXISTS idx_task_tests_active_timeline'));
  check('QA migration removes immutable trigger before backfill', qaMigration.includes('DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests')
    && qaMigration.indexOf('DROP TRIGGER IF EXISTS trg_task_tests_immutable') < qaMigration.indexOf('UPDATE task_tests'));
  check('QA migration has no forced exception or enum', !qaMigration.includes('RAISE EXCEPTION')
    && !/CREATE\s+TYPE[\s\S]*ENUM/iu.test(qaMigration));
  check('attachment source column is repeat-safe varchar', qaMigration.includes('ADD COLUMN IF NOT EXISTS source_section VARCHAR(50)'));
  check('QA constraints are replaced idempotently', [
    'task_tests_environment_check', 'task_tests_status_check', 'task_tests_author_membership_fk',
    'task_tests_deleted_by_membership_fk', 'task_attachments_source_section_check',
  ].every((constraint) => qaMigration.includes(`DROP CONSTRAINT IF EXISTS ${constraint}`)
    && qaMigration.includes(`ADD CONSTRAINT ${constraint}`)));
  check('QA repair covers databases that already recorded migration 012',
    qaRepairMigration.includes('DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests')
    && qaRepairMigration.includes('ADD COLUMN IF NOT EXISTS source_section VARCHAR(50)')
    && qaRepairMigration.includes('ALTER COLUMN source_section TYPE VARCHAR(50)')
    && !qaRepairMigration.includes('RAISE EXCEPTION'));
  check('frontend approval is inserted repeat-safely after Frontend',
    frontendApprovalMigration.includes("frontend.code = 'FRONTEND'")
    && frontendApprovalMigration.includes("approval.code = 'FRONTEND_APPROVAL'")
    && frontendApprovalMigration.includes('ORDER BY sort_order DESC')
    && frontendApprovalMigration.includes("'{\"approval\": true}'::jsonb")
    && !frontendApprovalMigration.includes('RAISE EXCEPTION'));
  check('task trash adds deletion actor and partial index incrementally',
    taskTrashMigration.includes('ADD COLUMN IF NOT EXISTS deleted_by UUID')
    && taskTrashMigration.includes('CREATE INDEX IF NOT EXISTS idx_tasks_trash')
    && taskTrashMigration.includes('WHERE deleted_at IS NOT NULL'));
  check('task trash deletion actor keeps tenant membership integrity',
    taskTrashMigration.includes('tasks_deleted_by_membership_fk')
    && taskTrashMigration.includes('REFERENCES company_memberships(company_id, user_id)'));
  check('immutable dossier deletion requires explicit transactional purge flag',
    taskTrashMigration.includes("current_setting('devflow.task_purge', TRUE) = 'enabled'")
    && taskTrashMigration.includes("TG_OP = 'DELETE'"));
  check('task deletion closes touch sessions with a dedicated reason',
    taskTrashMigration.includes("'TASK_DELETED'"));
  check('task list preferences are incremental and scoped by membership',
    taskListPreferencesMigration.includes('CREATE TABLE IF NOT EXISTS user_task_list_preferences')
    && taskListPreferencesMigration.includes('PRIMARY KEY (company_id, user_id)')
    && taskListPreferencesMigration.includes('REFERENCES company_memberships(company_id, user_id)'));
  check('task grouping preference accepts only the five supported modes',
    taskListPreferencesMigration.includes("CHECK (grouping IN ('none', 'stage', 'user', 'priority', 'type'))"));
  check('Report Bug keeps its canonical code while receiving the domain label',
    taskListPreferencesMigration.includes("WHERE code = 'BUG_REPORT'")
    && taskListPreferencesMigration.includes("SET name = 'Report Bug'")
    && !taskListPreferencesMigration.includes('SET code'));
  if (checks.length !== 34) throw new Error(`Expected 34 checks, got ${checks.length}`);
  console.log(`Migration tests passed: ${checks.length} scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
