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

  check('resume retains migration stage', install.includes('--resume') && transaction.includes('08-migrations'));
  check('backend image is always built before migrations', install.indexOf('build backend frontend') < install.indexOf('run_devflow_migrations'));
  check('database is preserved on installation failure', !install.includes('down --volumes') && install.includes('dados, logs e imagens foram preservados'));
  check('migration runtime is non-root', dockerfile.includes('USER devflow') && !common.includes('--user root'));
  check('migration flow is independent from neighboring applications', !install.toLowerCase().includes('fullpassword') && !update.toLowerCase().includes('fullpassword'));
  if (checks.length !== 20) throw new Error(`Expected 20 checks, got ${checks.length}`);
  console.log(`Migration tests passed: ${checks.length} scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
