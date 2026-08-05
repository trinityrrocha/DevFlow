const { getUpdateCapabilities, createSignedRequest } = require('../services/updateOperationService');
const { recordAudit } = require('../services/auditService');

function getCapabilities(_req, res) {
  res.json(getUpdateCapabilities());
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

module.exports = { getCapabilities, createRequest };
