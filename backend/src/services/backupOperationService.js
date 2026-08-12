const fs = require('node:fs');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const BACKUP_FILENAME = /^devflow-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dfbackup$/;
const BACKUP_ID = /^[0-9a-f]{32}$/;

function readCatalog({ filesystem = fs, catalogFile = env.DEVFLOW_BACKUP_CATALOG_FILE } = {}) {
  try {
    const stat = filesystem.lstatSync(catalogFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('unsafe');
    const catalog = JSON.parse(filesystem.readFileSync(catalogFile, 'utf8'));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.backups)) throw new Error('schema');
    return catalog.backups.filter((backup) => BACKUP_ID.test(backup.id)
      && BACKUP_FILENAME.test(backup.filename)
      && Number.isSafeInteger(backup.sizeBytes) && backup.sizeBytes >= 0
      && typeof backup.createdAt === 'string')
      .map((backup) => Object.freeze({
        id: backup.id,
        filename: backup.filename,
        createdAt: backup.createdAt,
        sizeBytes: backup.sizeBytes,
        status: backup.status === 'verified' ? 'verified' : 'available',
        applicationVersion: typeof backup.applicationVersion === 'string' ? backup.applicationVersion : null,
        applicationCommit: typeof backup.applicationCommit === 'string' ? backup.applicationCommit : null,
        databaseMigration: typeof backup.databaseMigration === 'string' ? backup.databaseMigration : null,
        format: typeof backup.format === 'string' ? backup.format : null,
        verifiedAt: typeof backup.verifiedAt === 'string' ? backup.verifiedAt : null
      }));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new AppError('BACKUP_CATALOG_INVALID', 'Catalogo seguro de backups indisponivel.', 503);
  }
}

function assertBackupExists(id, options) {
  if (!BACKUP_ID.test(id)) throw new AppError('BACKUP_ID_INVALID', 'Identificador de backup invalido.', 400);
  const backup = readCatalog(options).find((item) => item.id === id);
  if (!backup) throw new AppError('BACKUP_NOT_FOUND', 'Backup nao encontrado.', 404);
  return backup;
}

function listBackups(options) {
  return Object.freeze({ retentionDays: env.BACKUP_RETENTION_DAYS, backups: readCatalog(options) });
}

module.exports = { BACKUP_FILENAME, BACKUP_ID, readCatalog, assertBackupExists, listBackups };
