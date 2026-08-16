const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const BACKUP_FILENAME = /^devflow-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dfbackup$/;
const BACKUP_ID = /^[0-9a-f]{32}$/;
const BACKUP_STATES = Object.freeze(['available', 'verified']);
const optionalString = (value, pattern) => value === null || (typeof value === 'string' && (!pattern || pattern.test(value)));

function parseBackupEntry(backup) {
  const valid = backup && typeof backup === 'object' && !Array.isArray(backup)
    && BACKUP_ID.test(backup.id)
    && BACKUP_FILENAME.test(backup.filename)
    && crypto.createHash('sha256').update(backup.filename).digest('hex').slice(0, 32) === backup.id
    && Number.isSafeInteger(backup.sizeBytes) && backup.sizeBytes >= 0
    && typeof backup.createdAt === 'string' && Number.isFinite(Date.parse(backup.createdAt))
    && BACKUP_STATES.includes(backup.status)
    && optionalString(backup.applicationVersion, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/)
    && optionalString(backup.applicationCommit, /^[0-9a-f]{40}$/)
    && optionalString(backup.databaseMigration, /^[0-9]{3}_[A-Za-z0-9_]+\.sql$/)
    && optionalString(backup.format, /^devflow-backup-v[12]$/)
    && optionalString(backup.verifiedAt)
    && (backup.verifiedAt === null || Number.isFinite(Date.parse(backup.verifiedAt)));
  if (!valid) throw new Error('backup-schema');
  return Object.freeze({
    id: backup.id,
    filename: backup.filename,
    createdAt: backup.createdAt,
    sizeBytes: backup.sizeBytes,
    status: backup.status,
    applicationVersion: backup.applicationVersion,
    applicationCommit: backup.applicationCommit,
    databaseMigration: backup.databaseMigration,
    format: backup.format,
    verifiedAt: backup.verifiedAt
  });
}

function readCatalog({ filesystem = fs, catalogFile = env.DEVFLOW_BACKUP_CATALOG_FILE } = {}) {
  try {
    const stat = filesystem.lstatSync(catalogFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('unsafe');
    const catalog = JSON.parse(filesystem.readFileSync(catalogFile, 'utf8'));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.backups)) throw new Error('schema');
    return catalog.backups.map(parseBackupEntry);
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

function resolveBackupDownload(id, {
  filesystem = fs,
  catalogFile = env.DEVFLOW_BACKUP_CATALOG_FILE,
  backupRoot = env.DEVFLOW_BACKUP_DIR
} = {}) {
  const backup = assertBackupExists(id, { filesystem, catalogFile });
  try {
    const canonicalRoot = filesystem.realpathSync(backupRoot);
    const rootStat = filesystem.lstatSync(canonicalRoot);
    if (!rootStat.isDirectory()) throw new Error('backup-root-not-directory');
    const candidate = path.resolve(canonicalRoot, backup.filename);
    if (path.dirname(candidate) !== canonicalRoot) throw new Error('backup-path-outside-root');
    const candidateStat = filesystem.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw new Error('backup-file-unsafe');
    const canonicalFile = filesystem.realpathSync(candidate);
    const fileStat = filesystem.lstatSync(canonicalFile);
    if (path.dirname(canonicalFile) !== canonicalRoot || !fileStat.isFile()) throw new Error('backup-file-unsafe');
    if (fileStat.size !== backup.sizeBytes) throw new Error('backup-size-mismatch');
    return Object.freeze({ backup, file: canonicalFile, size: fileStat.size });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('BACKUP_FILE_UNAVAILABLE', 'Arquivo de backup indisponivel para download.', 404);
  }
}

module.exports = {
  BACKUP_FILENAME, BACKUP_ID, BACKUP_STATES, parseBackupEntry,
  readCatalog, assertBackupExists, listBackups, resolveBackupDownload
};
