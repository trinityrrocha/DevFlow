const { listBackups, assertBackupExists } = require('../services/backupOperationService');
const {
  assertQueueReady, createSignedRequest, persistRequest, getRequestStatus, backupIsInActiveOperation,
  queueDirectories
} = require('../services/operationalRequestService');
const { recordAudit } = require('../services/auditService');
const { AppError } = require('../utils/errors');
const db = require('../config/database');
const fs = require('node:fs');
const path = require('node:path');

const REQUESTED_AUDIT = Object.freeze({
  'create-backup': 'BACKUP_CREATE_REQUESTED', 'verify-backup': 'BACKUP_VERIFY_REQUESTED',
  'restore-backup': 'BACKUP_RESTORE_REQUESTED', 'delete-backup': 'BACKUP_DELETE_REQUESTED'
});

async function reconcileTerminalAudits(req) {
  const terminalDirectories = queueDirectories().filter((entry) => ['completed', 'failed'].includes(entry.status));
  const ids = terminalDirectories.flatMap((entry) => {
    try { return fs.readdirSync(entry.directory).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).slice(-100).map((name) => path.basename(name, '.json')); }
    catch { return []; }
  });
  for (const id of [...new Set(ids)]) {
    const state = getRequestStatus(id);
    if (state.operation !== 'install-update') await recordTerminalAudit(req, state);
  }
}

async function getBackups(req, res, next) {
  try { await reconcileTerminalAudits(req); res.json(listBackups()); }
  catch (error) { next(error); }
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

module.exports = { getBackups, create, verify, restore, remove, status };
