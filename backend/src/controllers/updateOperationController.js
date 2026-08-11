const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { getUpdateCapabilities, createSignedRequest, writeStatus, getRequestStatus, assertUpdaterQueueReady } = require('../services/updateOperationService');
const { recordAudit } = require('../services/auditService');

async function getCapabilities(_req, res, next) {
  try { res.json(await getUpdateCapabilities()); } catch (error) { next(error); }
}

function persistUpdateRequest(request, {
  filesystem = fs,
  queueDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR,
  statusDirectory = env.DEVFLOW_UPDATER_STATUS_DIR,
  statusWriter = writeStatus
} = {}) {
  const destination = path.join(queueDirectory, `${request.id}.json`);
  const temporary = path.join(queueDirectory, `.${request.id}.${process.pid}.tmp`);
  try {
    filesystem.mkdirSync(queueDirectory, { recursive: true, mode: 0o700 });
    filesystem.chmodSync(queueDirectory, 0o700);
    filesystem.writeFileSync(temporary, `${JSON.stringify(request)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    statusWriter(request.id, 'pending', request.requestedAt);
    filesystem.renameSync(temporary, destination);
  } catch (error) {
    filesystem.rmSync(temporary, { force: true });
    filesystem.rmSync(path.join(statusDirectory, `${request.id}.json`), { force: true });
    console.error('[DevFlow updater] Falha sanitizada ao gravar solicitacao.', {
      code: String(error?.code || 'UNKNOWN').slice(0, 40),
      request_id: request.id
    });
    throw new AppError('UPDATE_REQUEST_WRITE_FAILED', 'Nao foi possivel registrar a atualizacao na fila privada.', 503);
  }
  return destination;
}

async function createRequest(req, res) {
  assertUpdaterQueueReady();
  const request = createSignedRequest(req.user.email);
  const destination = persistUpdateRequest(request);
  console.log('[UPDATER_QUEUE] Arquivo de solicitação gravado em:', destination);
  await recordAudit({
    req,
    operation: 'UPDATE_REQUESTED',
    entityType: 'SYSTEM_UPDATE',
    entityId: request.id,
    newValues: { operation: request.operation, status: request.status }
  });
  res.status(202).json({ id: request.id, operation: request.operation, status: 'pending', requestedAt: request.requestedAt });
}

function getStatus(req, res, next) {
  try {
    return res.json(getRequestStatus(req.params.id));
  } catch (error) {
    return next(error);
  }
}

module.exports = { getCapabilities, createRequest, getStatus, persistUpdateRequest };
