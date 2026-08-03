const fs = require('fs/promises');
const path = require('path');
const db = require('../src/config/database');

const migrationsDirectory = path.resolve(process.env.MIGRATIONS_DIR || '/database/migrations');

async function discoverMigrationFiles(directory = migrationsDirectory, filesystem = fs) {
  try {
    await filesystem.access(directory);
  } catch (error) {
    error.migrationDirectory = directory;
    throw error;
  }

  console.log(`migration_directory=${directory}`);
  console.log('migration_directory_exists=true');
  const files = (await filesystem.readdir(directory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  console.log(`migration_files_detected=${files.length}`);
  if (files.length === 0) {
    console.log('migration_status=blocked');
    const error = new Error('Nenhum arquivo SQL de migration foi encontrado.');
    error.code = 'MIGRATIONS_EMPTY';
    error.migrationDirectory = directory;
    throw error;
  }
  return files;
}

async function migrate({ directory = migrationsDirectory, filesystem = fs, database = db } = {}) {
  const files = await discoverMigrationFiles(directory, filesystem);

  const client = await database.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('devflow:migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (exists.rowCount) {
        console.log(`migration_already_applied=${file}`);
        continue;
      }
      const sql = await filesystem.readFile(path.join(directory, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migration_applied=${file}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('devflow:migrations'))").catch(() => {});
    client.release();
  }
}

async function runCli() {
  try {
    await migrate();
    await db.pool.end();
    console.log('migration_exit_code=0');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('Diretório de migrations não encontrado.');
      console.error(`path=${error.migrationDirectory || migrationsDirectory}`);
      console.error('code=ENOENT');
    } else {
      console.error('Falha ao aplicar migrations.');
      console.error(`code=${error.code || 'UNKNOWN'}`);
    }
    console.error('migration_exit_code=1');
    await db.pool.end().catch(() => {});
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = {
  discoverMigrationFiles,
  migrate,
  migrationsDirectory,
  runCli,
};
