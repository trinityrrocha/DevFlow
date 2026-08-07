const { getUpdateCapabilities, createSignedRequest, getRequestStatus } = require('../services/updateOperationService');
const { recordAudit } = require('../services/auditService');

async function getCapabilities(_req, res, next) {
  try { res.json(await getUpdateCapabilities()); } catch (error) { next(error); }
}

async function createRequest(req, res) {
  const request = createSignedRequest(req.user.email);
  await recordAudit({
    req,
    operation: 'UPDATE_REQUESTED',
    entityType: 'SYSTEM_UPDATE',
    entityId: request.id,
    newValues: { operation: request.operation, status: request.status }
  });
  res.status(202).json(request);
}

function getStatus(req, res) {
  res.json(getRequestStatus(req.params.id));
}

module.exports = { getCapabilities, createRequest, getStatus };
