const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const UPDATE_ENGINE = 'scripts/update.sh';
const UPDATE_OPERATIONS = Object.freeze(['install-update']);
const UPDATE_STATES = Object.freeze(['pending', 'processing', 'backup', 'maintenance', 'migrations', 'containers', 'health', 'rollback', 'completed', 'failed']);
const UPDATE_PROCESSING_STATES = Object.freeze(['processing', 'backup', 'maintenance', 'migrations', 'containers', 'health', 'rollback']);
const REPOSITORY_API = 'https://api.github.com/repos/trinityrrocha/DevFlow';
const RAW_MAIN = 'https://raw.githubusercontent.com/trinityrrocha/DevFlow/main';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UPDATER_HEARTBEAT_MAX_AGE_MS = 15000;

function updaterQueueReady({
  filesystem = fs,
  requestDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR,
  now = Date.now()
} = {}) {
  try {
    const marker = path.join(path.dirname(requestDirectory), 'daemon.ready');
    const stat = filesystem.lstatSync(marker);
    return stat.isFile() && !stat.isSymbolicLink()
      && now - stat.mtimeMs >= 0
      && now - stat.mtimeMs <= UPDATER_HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function assertUpdaterQueueReady() {
  if (!updaterQueueReady()) {
    throw new AppError('UPDATE_DAEMON_UNAVAILABLE', 'O mecanismo autonomo de atualizacao nao esta pronto.', 503);
  }
}

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
  const queueReady = updaterQueueReady();
  return Object.freeze({
    enabled: env.UPDATE_API_ENABLED,
    executionAvailable: env.UPDATE_API_ENABLED && checkAvailable && queueReady,
    queueReady,
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
  fs.mkdirSync(env.DEVFLOW_UPDATER_STATUS_DIR, { recursive: true, mode: 0o700 });
  const destination = path.join(env.DEVFLOW_UPDATER_STATUS_DIR, `${id}.json`);
  const temporary = path.join(env.DEVFLOW_UPDATER_STATUS_DIR, `.${id}.${process.pid}.tmp`);
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

function getUpdateQueueDirectories() {
  const queueRoot = path.dirname(env.DEVFLOW_UPDATER_QUEUE_DIR);
  return Object.freeze([
    Object.freeze({ name: 'requests', directory: env.DEVFLOW_UPDATER_QUEUE_DIR, status: 'pending' }),
    Object.freeze({ name: 'processing', directory: path.join(queueRoot, 'processing'), status: 'processing' }),
    Object.freeze({ name: 'processed', directory: path.join(queueRoot, 'processed'), status: 'completed' }),
    Object.freeze({ name: 'failed', directory: path.join(queueRoot, 'failed'), status: 'failed' })
  ]);
}

function readSafeJson(source, filesystem = fs) {
  if (!filesystem.existsSync(source)) return null;
  try {
    const stat = filesystem.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('unsafe');
    return JSON.parse(filesystem.readFileSync(source, 'utf8'));
  } catch {
    throw new AppError('UPDATE_STATUS_INVALID', 'Status de atualizacao invalido.', 503);
  }
}

function safeFailureMessage(...values) {
  const message = values.find((value) => typeof value === 'string' && value.trim());
  return String(message || 'Atualizacao interrompida. Consulte o diagnostico do servidor.').trim().slice(0, 240);
}

function getRequestStatus(id, {
  filesystem = fs,
  directories = getUpdateQueueDirectories(),
  statusDirectory = env.DEVFLOW_UPDATER_STATUS_DIR
} = {}) {
  if (!REQUEST_ID_PATTERN.test(id)) throw new AppError('UPDATE_REQUEST_NOT_FOUND', 'Solicitacao de atualizacao nao encontrada.', 404);
  let lifecycle;
  for (const entry of directories) {
    const source = path.join(entry.directory, `${id}.json`);
    if (!filesystem.existsSync(source)) continue;
    const request = readSafeJson(source, filesystem);
    if (request?.id !== id) throw new AppError('UPDATE_STATUS_INVALID', 'Status de atualizacao invalido.', 503);
    lifecycle = { ...entry, request };
    break;
  }
  if (!lifecycle) throw new AppError('UPDATE_REQUEST_NOT_FOUND', 'Solicitacao de atualizacao nao encontrada.', 404);

  const statusSource = path.join(statusDirectory, `${id}.json`);
  const payload = readSafeJson(statusSource, filesystem);
  if (payload && (payload.schemaVersion !== 1 || payload.id !== id || !UPDATE_STATES.includes(payload.state)
    || typeof payload.message !== 'string' || payload.message.length > 240)) {
    throw new AppError('UPDATE_STATUS_INVALID', 'Status de atualizacao invalido.', 503);
  }

  const state = lifecycle.status === 'processing' && UPDATE_PROCESSING_STATES.includes(payload?.state)
    ? payload.state
    : lifecycle.status;
  const messages = {
    pending: 'Atualizacao aguardando processamento.',
    processing: 'Atualizacao em processamento.',
    completed: 'Atualizacao concluida com sucesso.',
    failed: 'Atualizacao interrompida. Consulte o diagnostico do servidor.'
  };
  const message = state === payload?.state ? payload.message : messages[state];
  const response = {
    id,
    status: lifecycle.status,
    state,
    message,
    requestedAt: payload?.requestedAt || lifecycle.request.requestedAt || lifecycle.request.timestamp || null,
    updatedAt: payload?.updatedAt || null
  };
  if (lifecycle.status === 'failed') {
    response.error = safeFailureMessage(
      lifecycle.request.error,
      lifecycle.request.failureReason,
      lifecycle.request.rootCause,
      payload?.message
    );
  }
  return Object.freeze(response);
}

module.exports = {
  getUpdateCapabilities,
  updaterQueueReady,
  assertUpdaterQueueReady,
  createSignedRequest,
  writeStatus,
  getRequestStatus,
  getUpdateQueueDirectories,
  UPDATE_ENGINE,
  UPDATE_OPERATIONS,
  UPDATE_STATES
};
