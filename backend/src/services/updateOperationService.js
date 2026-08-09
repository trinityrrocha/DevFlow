const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const UPDATE_ENGINE = 'scripts/update.sh';
const UPDATE_OPERATIONS = Object.freeze(['install-update']);
const UPDATE_STATES = Object.freeze(['pending', 'processing', 'backup', 'maintenance', 'migrations', 'containers', 'health', 'rollback', 'completed', 'failed']);
const REPOSITORY_API = 'https://api.github.com/repos/trinityrrocha/DevFlow';
const RAW_MAIN = 'https://raw.githubusercontent.com/trinityrrocha/DevFlow/main';

function changelogSection(content, version) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith('## ['));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join('\n').trim().slice(0, 12000);
}

async function fetchPublicText(url) {
  const response = await globalThis.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DevFlow-Updater' },
    signal: globalThis.AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`upstream-${response.status}`);
  return response.text();
}

async function getUpdateCapabilities() {
  let availableVersion = env.DEVFLOW_VERSION;
  let availableCommit = env.DEVFLOW_RELEASE_COMMIT;
  let changelog = '';
  let checkAvailable = false;
  if (env.UPDATE_API_ENABLED) {
    try {
      const [versionText, commitText, changelogText] = await Promise.all([
        fetchPublicText(`${RAW_MAIN}/VERSION`),
        fetchPublicText(`${REPOSITORY_API}/commits/main`),
        fetchPublicText(`${RAW_MAIN}/CHANGELOG.md`)
      ]);
      availableVersion = versionText.trim();
      availableCommit = JSON.parse(commitText).sha;
      if (!/^[0-9a-f]{40}$/.test(availableCommit) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(availableVersion)) throw new Error('identity');
      changelog = changelogSection(changelogText, availableVersion);
      if (!changelog) throw new Error('changelog');
      checkAvailable = true;
    } catch {
      checkAvailable = false;
    }
  }
  return Object.freeze({
    enabled: env.UPDATE_API_ENABLED,
    executionAvailable: env.UPDATE_API_ENABLED && checkAvailable,
    engine: UPDATE_ENGINE,
    installedVersion: env.DEVFLOW_VERSION,
    installedCommit: env.DEVFLOW_RELEASE_COMMIT,
    availableVersion,
    availableCommit,
    updateAvailable: checkAvailable && availableCommit !== env.DEVFLOW_RELEASE_COMMIT,
    changelog,
    safeguards: ['backup-validado', 'manutencao-http-503', 'rollback-automatico'],
    operations: UPDATE_OPERATIONS,
    transport: 'signed-private-queue'
  });
}

function writeStatus(id, state, requestedAt = new Date().toISOString()) {
  if (!UPDATE_STATES.includes(state)) throw new AppError('UPDATE_STATUS_INVALID', 'Estado de atualizacao invalido.', 500);
  fs.mkdirSync(env.UPDATE_STATUS_DIR, { recursive: true, mode: 0o700 });
  const destination = path.join(env.UPDATE_STATUS_DIR, `${id}.json`);
  const temporary = path.join(env.UPDATE_STATUS_DIR, `.${id}.${process.pid}.tmp`);
  const messages = {
    pending: 'Atualizacao aguardando processamento.', processing: 'Atualizacao em processamento.',
    backup: 'Backup de seguranca em andamento.', maintenance: 'Modo de manutencao ativo.',
    migrations: 'Migrations em processamento.', containers: 'Servicos da aplicacao em atualizacao.',
    health: 'Validando a saude da aplicacao.', rollback: 'Restauracao automatica em andamento.',
    completed: 'Atualizacao concluida com sucesso.', failed: 'Atualizacao interrompida. Consulte o diagnostico do servidor.'
  };
  fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, id, state, message: messages[state], requestedAt, updatedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function createSignedRequest(actorEmail) {
  if (!env.UPDATE_API_ENABLED) {
    throw new AppError('UPDATE_API_DISABLED', 'Atualizacao pela API esta desabilitada.', 503);
  }
  const request = {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    action: 'update',
    timestamp: new Date().toISOString(),
    requester: String(actorEmail).toLowerCase(),
    operation: 'install-update',
    requestedAt: null,
    requestedBy: String(actorEmail).toLowerCase(),
    nonce: crypto.randomBytes(32).toString('hex')
  };
  request.requestedAt = request.timestamp;
  const canonical = JSON.stringify(request);
  request.signature = crypto.createHmac('sha256', env.UPDATE_REQUEST_SECRET).update(canonical).digest('hex');
  return request;
}

function getRequestStatus(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('UPDATE_REQUEST_NOT_FOUND', 'Solicitacao de atualizacao nao encontrada.', 404);
  const source = path.join(env.UPDATE_STATUS_DIR, `${id}.json`);
  let stat; let payload;
  try {
    stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('unsafe');
    payload = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch {
    throw new AppError('UPDATE_REQUEST_NOT_FOUND', 'Solicitacao de atualizacao nao encontrada.', 404);
  }
  if (payload.schemaVersion !== 1 || payload.id !== id || !UPDATE_STATES.includes(payload.state)
    || typeof payload.message !== 'string' || payload.message.length > 240) {
    throw new AppError('UPDATE_STATUS_INVALID', 'Status de atualizacao invalido.', 503);
  }
  return Object.freeze({ id, state: payload.state, message: payload.message, requestedAt: payload.requestedAt, updatedAt: payload.updatedAt });
}

module.exports = { getUpdateCapabilities, createSignedRequest, writeStatus, getRequestStatus, UPDATE_ENGINE, UPDATE_OPERATIONS, UPDATE_STATES };
