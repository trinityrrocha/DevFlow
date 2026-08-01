const fs = require('fs/promises');
const path = require('path');
const db = require('../src/config/database');

const migrationsDirectory = path.resolve(process.env.MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'database', 'migrations'));

async function migrate() {
  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  const client = await db.pool.connect();
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
      if (exists.rowCount) continue;
      const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migration aplicada: ${file}`);
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

migrate()
  .then(() => db.pool.end())
  .catch((error) => {
    console.error('Falha ao aplicar migrations.', { code: error.code });
    process.exitCode = 1;
  });
