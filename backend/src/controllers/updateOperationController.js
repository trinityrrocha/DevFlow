const { getUpdateCapabilities, createSignedRequest, getRequestStatus, assertUpdaterQueueReady } = require('../services/updateOperationService');
const { persistRequest } = require('../services/operationalRequestService');
const { recordAudit } = require('../services/auditService');

async function getCapabilities(_req, res, next) {
  try { res.json(await getUpdateCapabilities()); } catch (error) { next(error); }
}

const persistUpdateRequest = persistRequest;

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
    newValues: { operation: request.operation, status: 'queued' }
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
