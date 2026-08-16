const { listBackups, assertBackupExists, resolveBackupDownload } = require('../services/backupOperationService');
const {
  assertQueueReady, createSignedRequest, persistRequest, getRequestStatus, backupIsInActiveOperation,
  queueDirectories, REQUEST_ID_PATTERN
} = require('../services/operationalRequestService');
const { recordAudit } = require('../services/auditService');
const { safeLogError } = require('../utils/safeLogger');
const { AppError } = require('../utils/errors');
const db = require('../config/database');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');

const REQUESTED_AUDIT = Object.freeze({
  'create-backup': 'BACKUP_CREATE_REQUESTED', 'verify-backup': 'BACKUP_VERIFY_REQUESTED',
  'restore-backup': 'BACKUP_RESTORE_REQUESTED', 'delete-backup': 'BACKUP_DELETE_REQUESTED'
});

const BACKUP_OPERATIONS = new Set(['create-backup', 'verify-backup', 'restore-backup', 'delete-backup']);

async function reconcileTerminalAudits(req, {
  filesystem = fs,
  directories = queueDirectories(),
  statusDirectory,
  statusReader = (id) => getRequestStatus(id, { filesystem, directories, statusDirectory }),
  auditRecorder = recordTerminalAudit,
  errorLogger = safeLogError
} = {}) {
  const terminalDirectories = directories.filter((entry) => ['completed', 'failed'].includes(entry.status));
  const ids = terminalDirectories.flatMap((entry) => {
    try {
      return filesystem.readdirSync(entry.directory)
        .map((name) => path.basename(name, '.json'))
        .filter((id) => REQUEST_ID_PATTERN.test(id))
        .slice(-100);
    }
    catch { return []; }
  });
  for (const id of [...new Set(ids)]) {
    try {
      const state = statusReader(id);
      if (BACKUP_OPERATIONS.has(state.operation)) await auditRecorder(req, state);
    } catch (error) {
      errorLogger('Reconciliacao de auditoria operacional ignorou item historico invalido.', error);
    }
  }
}

async function getBackups(req, res, next) {
  try { await reconcileTerminalAudits(req); res.json(listBackups()); }
  catch (error) { next(error); }
}

async function download(req, res, next) {
  try {
    const resolved = resolveBackupDownload(req.params.id);
    await recordAudit({ req, operation: 'BACKUP_DOWNLOADED', entityType: 'SYSTEM_BACKUP', entityId: resolved.backup.id, newValues: { backupId: resolved.backup.id, filename: resolved.backup.filename }, strict: true });
    const encoded = encodeURIComponent(resolved.backup.filename);
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(resolved.size));
    res.setHeader('Content-Disposition', `attachment; filename="${resolved.backup.filename}"; filename*=UTF-8''${encoded}`);
    pipeline(fs.createReadStream(resolved.file), res, (error) => {
      if (error && !res.headersSent) next(error);
      else if (error) safeLogError('Falha no streaming de backup.', error);
    });
  } catch (error) { next(error); }
}

async function queue(req, res, next, operation, backupId = null) {
  try {
    assertQueueReady();
    if (backupId) assertBackupExists(backupId);
    if (backupId && backupIsInActiveOperation(backupId)) throw new AppError('BACKUP_OPERATION_ACTIVE', 'Este backup ja participa de uma operacao ativa.', 409);
    const request = createSignedRequest({ actorEmail: req.user.email, operation, backupId });
    const destination = persistRequest(request);
    console.log('[OPERATION_QUEUE] Solicitacao gravada em:', destination);
    await recordAudit({ req, operation: REQUESTED_AUDIT[operation], entityType: 'SYSTEM_BACKUP', entityId: backupId || request.id, newValues: { request_id: request.id, backupId, result: 'queued' }, strict: true });
    res.status(202).json({ id: request.id, operation, backupId, status: 'pending', requestedAt: request.requestedAt });
  } catch (error) { next(error); }
}

function create(req, res, next) { return queue(req, res, next, 'create-backup'); }
function verify(req, res, next) { return queue(req, res, next, 'verify-backup', req.params.id); }
function restore(req, res, next) {
  if (req.body?.confirmation !== 'RESTAURAR') return next(new AppError('RESTORE_CONFIRMATION_INVALID', 'Digite RESTAURAR para confirmar.', 400));
  return queue(req, res, next, 'restore-backup', req.params.id);
}
function remove(req, res, next) {
  if (req.body?.confirmation !== 'EXCLUIR') return next(new AppError('DELETE_CONFIRMATION_INVALID', 'Digite EXCLUIR para confirmar.', 400));
  return queue(req, res, next, 'delete-backup', req.params.id);
}
const SUCCESS_AUDIT = Object.freeze({
  'create-backup': 'BACKUP_CREATED', 'verify-backup': 'BACKUP_VERIFIED',
  'restore-backup': 'BACKUP_RESTORED', 'delete-backup': 'BACKUP_DELETED'
});

async function recordTerminalAudit(req, state) {
  if (!['completed', 'failed'].includes(state.status)) return;
  const operation = state.status === 'completed'
    ? SUCCESS_AUDIT[state.operation]
    : state.operation === 'restore-backup' ? 'RESTORE_FAILED' : 'BACKUP_FAILED';
  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [state.id]);
    const exists = await client.query('SELECT 1 FROM audit_events WHERE entity_id=$1 AND operation=$2 LIMIT 1', [state.id, operation]);
    if (exists.rowCount) return;
    await recordAudit({ req, operation, entityType: 'SYSTEM_BACKUP', entityId: state.id, newValues: { request_id: state.id, backupId: state.backupId, result: state.status }, status: state.status === 'failed' ? 'FAILED' : 'SUCCESS', queryable: client, strict: true });
  });
}

async function status(req, res, next) {
  try {
    const state = getRequestStatus(req.params.id);
    await recordTerminalAudit(req, state);
    res.json(state);
  } catch (error) { next(error); }
}

module.exports = { getBackups, download, create, verify, restore, remove, status, reconcileTerminalAudits };
