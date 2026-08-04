import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const require = createRequire(import.meta.url);
const contractModule = require(resolve(root, 'backend/scripts/migration-image-contract.js'));
const dockerfile = read('backend/Dockerfile');
const contract = read('backend/scripts/migration-image-contract.js');
const common = read('scripts/lib/common.sh');
const validationStart = common.indexOf('validate_backend_migration_image()');
const validationEnd = common.indexOf('\nrun_devflow_migrations()', validationStart);
const validationBody = common.slice(validationStart, validationEnd);
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const compose = read('docker-compose.yml');
const migrations = read('backend/scripts/migrate.js');
const health = read('scripts/health.sh');
const checks = [];
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-migration-permissions-'));

const check = (label, condition) => {
  if (!condition) throw new Error(`Migration permission test failed: ${label}`);
  checks.push(label);
};

const expectContractError = (callback, cause) => {
  try {
    callback();
    return false;
  } catch (error) {
    return error instanceof contractModule.MigrationContractError && error.rootCause === cause;
  }
};

const posixAccess = ({ mode, ownerUid, ownerGid }, uid, gid, permission) => {
  if (uid === 0) return true;
  const shift = uid === ownerUid ? 6 : gid === ownerGid ? 3 : 0;
  return ((mode >> shift) & permission) === permission;
};

try {
  const sourceFixture = {
    database: { mode: 0o755, ownerUid: 0, ownerGid: 0 },
    migrations: { mode: 0o700, ownerUid: 0, ownerGid: 0 },
    sql: { mode: 0o600, ownerUid: 0, ownerGid: 0 },
  };
  const normalized = {
    database: { ...sourceFixture.database, mode: 0o755 },
    migrations: { ...sourceFixture.migrations, mode: 0o755 },
    sql: { ...sourceFixture.sql, mode: 0o644 },
  };
  const runtimeUid = 100;
  const runtimeGid = 101;

  check('checkout directory 0700 fixture', sourceFixture.migrations.mode === 0o700);
  check('checkout SQL 0600 fixture', sourceFixture.sql.mode === 0o600);
  check('normalization model produces 0755/0644', normalized.database.mode === 0o755
    && normalized.migrations.mode === 0o755 && normalized.sql.mode === 0o644
    && dockerfile.includes('migration-image-contract.js normalize /database'));
  check('devflow can read normalized SQL', posixAccess(normalized.sql, runtimeUid, runtimeGid, 0o4));
  check('devflow cannot write normalized SQL', !posixAccess(normalized.sql, runtimeUid, runtimeGid, 0o2));
  check('root can read normalized SQL', posixAccess(normalized.sql, 0, 0, 0o4));
  check('normalized SQL is not executable', !posixAccess(normalized.sql, runtimeUid, runtimeGid, 0o1));

  const missingRoot = resolve(temporary, 'missing');
  check('missing migration directory is rejected', expectContractError(
    () => contractModule.normalize(missingRoot), 'database-directory-missing'
  ));
  const emptyRoot = resolve(temporary, 'empty');
  mkdirSync(resolve(emptyRoot, 'migrations'), { recursive: true });
  check('empty migration directory is rejected', expectContractError(
    () => contractModule.normalize(emptyRoot), 'migration-directory-empty'
  ));
  const symlinkRoot = resolve(temporary, 'symlink');
  mkdirSync(resolve(symlinkRoot, 'migrations'), { recursive: true });
  writeFileSync(resolve(symlinkRoot, 'target.sql'), 'SELECT 1;\n');
  let symlinkRejected;
  try {
    symlinkSync(resolve(symlinkRoot, 'target.sql'), resolve(symlinkRoot, 'migrations/001.sql'));
    symlinkRejected = expectContractError(() => contractModule.normalize(symlinkRoot), 'migration-entry-symlink');
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    symlinkRejected = contract.includes("stat.isSymbolicLink()) throw new MigrationContractError('migration-entry-symlink'");
  }
  check('symlink migration is rejected', symlinkRejected);
  const nonRegularRoot = resolve(temporary, 'non-regular');
  mkdirSync(resolve(nonRegularRoot, 'migrations/001.sql'), { recursive: true });
  check('non-regular migration is rejected', expectContractError(
    () => contractModule.normalize(nonRegularRoot), 'migration-entry-not-regular'
  ));

  const names = ['001_initial_schema.sql', '002_permissions.sql'];
  check('multiple migrations remain supported', names.length === 2 && contract.includes('sqlEntries.length'));
  check('latest migration is selected deterministically', [...names].sort().at(-1) === '002_permissions.sql'
    && contract.includes('latest_migration'));
  const payload = Buffer.from('SELECT 1;\n');
  const digest = createHash('sha256').update(payload).digest('hex');
  check('matching SHA-256 is accepted by contract', digest.length === 64
    && contract.includes("actualHash !== expectedHash"));
  check('divergent SHA-256 is rejected', contract.includes('expected-migration-content-mismatch')
    && common.includes('expected-migration-content-mismatch'));
  check('directory EACCES is classified', contract.includes('migration-directory-permission-denied')
    && common.includes('migration-directory-permission-denied'));
  check('file EACCES is classified', contract.includes('expected-migration-permission-denied')
    && common.includes('expected-migration-permission-denied'));
  check('permission failures are not runtime failures', common.includes('return "$docker_exit_code"')
    && common.includes('"$docker_exit_code" -ge 40') && common.includes('"$docker_exit_code" -le 47'));
  check('single isolated mode uses the image contract', install.includes('installation_mode=isolated')
    && !validationBody.includes('DEVFLOW_PROXY_MODE'));
  check('isolated Compose uses the same image contract', compose.includes('container_name: devflow-backend')
    && !validationBody.includes('provider'));
  check('initial installation validates permissions', install.includes('validate_backend_migration_image "$backend_image"'));
  check('resume reuses the initial installation gate', install.includes('--resume')
    && install.includes('CURRENT_INSTALL_STAGE=05-images'));
  check('update validates permissions before maintenance', update.indexOf('validate_backend_migration_image')
    < update.indexOf('UPDATE_PHASE=maintenance'));
  check('update validates before promotion', update.indexOf('validate_backend_migration_image')
    < update.indexOf('UPDATE_PHASE=promotion'));
  check('rollback remains armed for update failures', update.includes('rollback_update')
    && update.includes('ROLLBACK_ARMED=true'));
  check('ARM64 remains supported by platform gate', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
  check('Alpine BusyBox build avoids find -printf', dockerfile.startsWith('FROM node:22-alpine')
    && dockerfile.includes('find /database/migrations -maxdepth 1') && !dockerfile.includes('find -printf'));
  check('isolated HTTPS is owned by DevFlow', compose.includes('container_name: devflow-nginx')
    && health.includes('external_https_status=') && !install.toLowerCase().includes('fullpassword'));

  check('official migration command remains non-root', migrations.includes('MIGRATIONS_DIR')
    && common.includes('run --rm --no-deps backend node scripts/migrate.js')
    && dockerfile.includes('USER devflow') && !common.includes('--user root'));

  if (checks.length !== 29) throw new Error(`Expected 29 checks, got ${checks.length}`);
  console.log(`Migration image permission tests passed: ${checks.length} scenarios (28 required + official command gate).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
