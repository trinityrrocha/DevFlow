const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const UPDATE_ENGINE = 'scripts/update.sh';
const UPDATE_OPERATIONS = Object.freeze(['install-update']);

function getUpdateCapabilities() {
  return Object.freeze({
    enabled: env.UPDATE_API_ENABLED,
    executionAvailable: env.UPDATE_API_ENABLED,
    engine: UPDATE_ENGINE,
    version: env.DEVFLOW_VERSION,
    operations: UPDATE_OPERATIONS,
    transport: 'signed-private-queue'
  });
}

function createSignedRequest(actorEmail) {
  if (!env.UPDATE_API_ENABLED) {
    throw new AppError('UPDATE_API_DISABLED', 'Atualizacao pela API esta desabilitada.', 503);
  }
  const request = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    operation: 'install-update',
    requestedAt: new Date().toISOString(),
    requestedBy: String(actorEmail).toLowerCase(),
    nonce: crypto.randomBytes(32).toString('hex')
  };
  const canonical = JSON.stringify(request);
  request.signature = crypto.createHmac('sha256', env.UPDATE_REQUEST_SECRET).update(canonical).digest('hex');
  fs.mkdirSync(env.UPDATE_REQUEST_DIR, { recursive: true, mode: 0o700 });
  const destination = path.join(env.UPDATE_REQUEST_DIR, `${request.id}.json`);
  const temporary = path.join(env.UPDATE_REQUEST_DIR, `.${request.id}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(request)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, destination);
  return { id: request.id, operation: request.operation, status: 'queued', requestedAt: request.requestedAt };
}

module.exports = { getUpdateCapabilities, createSignedRequest, UPDATE_ENGINE, UPDATE_OPERATIONS };
