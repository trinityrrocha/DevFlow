const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;

class MigrationContractError extends Error {
  constructor(rootCause, exitCode, details = {}) {
    super(rootCause);
    this.name = 'MigrationContractError';
    this.rootCause = rootCause;
    this.exitCode = exitCode;
    this.details = details;
  }
}

const modeOf = (stat) => stat.mode & 0o777;
const isPermissionError = (error) => error?.code === 'EACCES' || error?.code === 'EPERM';

const safeStat = (target, missingCause, permissionCause) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new MigrationContractError(missingCause, 40);
    if (isPermissionError(error)) throw new MigrationContractError(permissionCause, 45);
    throw error;
  }
};

const assertDirectory = (target, missingCause, permissionCause) => {
  const stat = safeStat(target, missingCause, permissionCause);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new MigrationContractError('migration-directory-not-regular', 43);
  }
  return stat;
};

const readEntries = (migrationsDirectory) => {
  let names;
  try {
    names = fs.readdirSync(migrationsDirectory);
  } catch (error) {
    if (isPermissionError(error)) {
      throw new MigrationContractError('migration-directory-permission-denied', 45, {
        migration_directory_present: true,
        migration_directory_readable: false,
      });
    }
    throw error;
  }
  const entries = names.map((name) => {
    const target = path.join(migrationsDirectory, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new MigrationContractError('migration-entry-symlink', 43);
    if (!stat.isFile()) throw new MigrationContractError('migration-entry-not-regular', 43);
    return { name, target, stat };
  });
  const sqlEntries = entries.filter(({ name }) => name.endsWith('.sql'))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (sqlEntries.length === 0) throw new MigrationContractError('migration-directory-empty', 41);
  return { entries, sqlEntries };
};

const assertExactOwnershipAndMode = (target, expectedMode, rootCause) => {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new MigrationContractError('migration-entry-symlink', 43);
  if (modeOf(stat) !== expectedMode || (process.platform !== 'win32' && (stat.uid !== 0 || stat.gid !== 0))) {
    throw new MigrationContractError(rootCause, 47, {
      actual_mode: modeOf(stat).toString(8),
      actual_uid: stat.uid,
      actual_gid: stat.gid,
    });
  }
};

const normalize = (databaseRoot = '/database') => {
  const migrationsDirectory = path.join(databaseRoot, 'migrations');
  assertDirectory(databaseRoot, 'database-directory-missing', 'database-directory-permission-denied');
  assertDirectory(migrationsDirectory, 'migration-directory-missing', 'migration-directory-permission-denied');
  const { entries, sqlEntries } = readEntries(migrationsDirectory);

  if (process.platform !== 'win32') {
    fs.chownSync(databaseRoot, 0, 0);
    fs.chownSync(migrationsDirectory, 0, 0);
  }
  fs.chmodSync(databaseRoot, DIRECTORY_MODE);
  fs.chmodSync(migrationsDirectory, DIRECTORY_MODE);
  for (const entry of entries) {
    if (process.platform !== 'win32') fs.chownSync(entry.target, 0, 0);
    fs.chmodSync(entry.target, FILE_MODE);
  }

  assertExactOwnershipAndMode(databaseRoot, DIRECTORY_MODE, 'database-permission-contract-invalid');
  assertExactOwnershipAndMode(migrationsDirectory, DIRECTORY_MODE, 'migration-directory-permission-contract-invalid');
  for (const entry of entries) {
    assertExactOwnershipAndMode(entry.target, FILE_MODE, 'migration-file-permission-contract-invalid');
  }
  return { migrationCount: sqlEntries.length, latestMigration: sqlEntries.at(-1).name };
};

const accessAllowed = (target, mode) => {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch (error) {
    if (isPermissionError(error)) return false;
    throw error;
  }
};

const probeRuntime = (databaseRoot = '/database', expectedName = '', expectedHash = '') => {
  const migrationsDirectory = path.join(databaseRoot, 'migrations');
  assertDirectory(databaseRoot, 'database-directory-missing', 'database-directory-permission-denied');
  assertDirectory(migrationsDirectory, 'migration-directory-missing', 'migration-directory-permission-denied');

  if (!accessAllowed(migrationsDirectory, fs.constants.R_OK | fs.constants.X_OK)) {
    throw new MigrationContractError('migration-directory-permission-denied', 45, {
      migration_directory_present: true,
      migration_directory_readable: false,
      migration_directory_traversable: false,
    });
  }
  if (accessAllowed(migrationsDirectory, fs.constants.W_OK)) {
    throw new MigrationContractError('migration-directory-writable-by-runtime-user', 47);
  }

  const { entries, sqlEntries } = readEntries(migrationsDirectory);
  const expected = sqlEntries.find(({ name }) => name === expectedName);
  if (!expected) {
    throw new MigrationContractError('expected-migration-missing', 41, {
      migration_directory_present: true,
      migration_directory_readable: true,
      expected_migration_present: false,
    });
  }
  if (expected.name !== sqlEntries.at(-1).name) {
    throw new MigrationContractError('expected-migration-not-latest', 47);
  }
  if (!accessAllowed(expected.target, fs.constants.R_OK)) {
    throw new MigrationContractError('expected-migration-permission-denied', 46, {
      migration_directory_present: true,
      migration_directory_readable: true,
      expected_migration_present: true,
      expected_migration_readable: false,
    });
  }
  if (accessAllowed(expected.target, fs.constants.W_OK)) {
    throw new MigrationContractError('expected-migration-writable-by-runtime-user', 47);
  }
  if (accessAllowed(expected.target, fs.constants.X_OK)) {
    throw new MigrationContractError('expected-migration-executable', 47);
  }

  assertExactOwnershipAndMode(databaseRoot, DIRECTORY_MODE, 'database-permission-contract-invalid');
  assertExactOwnershipAndMode(migrationsDirectory, DIRECTORY_MODE, 'migration-directory-permission-contract-invalid');
  for (const entry of entries) {
    assertExactOwnershipAndMode(entry.target, FILE_MODE, 'migration-file-permission-contract-invalid');
  }

  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(expected.target)).digest('hex');
  if (expectedHash && actualHash !== expectedHash) {
    throw new MigrationContractError('expected-migration-content-mismatch', 44);
  }
  return {
    runtime_uid: typeof process.getuid === 'function' ? process.getuid() : -1,
    runtime_gid: typeof process.getgid === 'function' ? process.getgid() : -1,
    migration_count: sqlEntries.length,
    latest_migration: sqlEntries.at(-1).name,
    migration_directory_present: true,
    migration_directory_readable: true,
    migration_directory_traversable: true,
    migration_directory_writable_by_runtime_user: false,
    expected_migration_present: true,
    expected_migration_regular_file: true,
    expected_migration_readable: true,
    expected_migration_writable_by_runtime_user: false,
    expected_migration_executable: false,
    expected_migration_content_match: true,
    expected_migration_sha256: actualHash,
  };
};

const printFields = (fields) => {
  for (const [key, value] of Object.entries(fields)) console.log(`${key}=${value}`);
};

const main = () => {
  const [mode, databaseRoot = '/database', expectedName = '', expectedHash = ''] = process.argv.slice(2);
  try {
    if (mode === 'normalize') {
      printFields(normalize(databaseRoot));
      console.log('migration_image_contract=normalized');
    } else if (mode === 'probe') {
      const result = probeRuntime(databaseRoot, expectedName, expectedHash);
      console.log('devflow_image_validation_result=passed');
      printFields(result);
    } else {
      throw new Error('usage: migration-image-contract.js normalize|probe [ROOT] [EXPECTED] [SHA256]');
    }
  } catch (error) {
    if (error instanceof MigrationContractError) {
      console.log('devflow_image_validation_result=failed');
      console.log(`devflow_image_validation_root_cause=${error.rootCause}`);
      printFields(error.details);
      process.exitCode = error.exitCode;
      return;
    }
    console.error(`devflow_image_probe_error=${error?.code || 'unexpected'}`);
    process.exitCode = 49;
  }
};

if (require.main === module) main();

module.exports = {
  DIRECTORY_MODE,
  FILE_MODE,
  MigrationContractError,
  normalize,
  probeRuntime,
};
