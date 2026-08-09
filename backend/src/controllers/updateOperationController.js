const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { getUpdateCapabilities, createSignedRequest, writeStatus, getRequestStatus } = require('../services/updateOperationService');
const { recordAudit } = require('../services/auditService');

async function getCapabilities(_req, res, next) {
  try { res.json(await getUpdateCapabilities()); } catch (error) { next(error); }
}

async function createRequest(req, res) {
  const request = createSignedRequest(req.user.email);
  const destination = path.join(env.UPDATE_REQUEST_DIR, `${request.id}.json`);
  const temporary = path.join(env.UPDATE_REQUEST_DIR, `.${request.id}.${process.pid}.tmp`);
  try {
    fs.mkdirSync(env.UPDATE_REQUEST_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(env.UPDATE_REQUEST_DIR, 0o700);
    fs.writeFileSync(temporary, `${JSON.stringify(request)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    writeStatus(request.id, 'pending', request.requestedAt);
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(path.join(env.UPDATE_STATUS_DIR, `${request.id}.json`), { force: true });
    console.error('[DevFlow updater] Falha sanitizada ao gravar solicitacao.', {
      code: String(error?.code || 'UNKNOWN').slice(0, 40),
      request_id: request.id
    });
    throw new AppError('UPDATE_REQUEST_WRITE_FAILED', 'Nao foi possivel registrar a atualizacao na fila privada.', 503);
  }
  await recordAudit({
    req,
    operation: 'UPDATE_REQUESTED',
    entityType: 'SYSTEM_UPDATE',
    entityId: request.id,
    newValues: { operation: request.operation, status: request.status }
  });
  res.status(202).json({ id: request.id, operation: request.operation, status: 'pending', requestedAt: request.requestedAt });
}

function getStatus(req, res) {
  res.json(getRequestStatus(req.params.id));
}

module.exports = { getCapabilities, createRequest, getStatus };
