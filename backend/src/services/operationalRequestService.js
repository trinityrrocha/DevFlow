const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const OPERATIONS = Object.freeze([
  'install-update', 'create-backup', 'verify-backup', 'restore-backup', 'delete-backup'
]);
const OPERATION_STATES = Object.freeze([
  'pending', 'processing', 'backup', 'maintenance', 'migrations', 'containers',
  'health', 'rollback', 'completed', 'failed'
]);
const PROCESSING_STATES = Object.freeze(OPERATION_STATES.filter((state) => !['pending', 'completed', 'failed'].includes(state)));
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/;
const HEARTBEAT_MAX_AGE_MS = 15000;
const DEFAULT_STATE_MESSAGES = Object.freeze({
  pending: 'Operacao aguardando processamento.', processing: 'Operacao em processamento.',
  backup: 'Backup de seguranca em andamento.', maintenance: 'Modo de manutencao ativo.',
  migrations: 'Migrations em processamento.', containers: 'Servicos em atualizacao.',
  health: 'Validando a saude da aplicacao.', rollback: 'Rollback operacional em andamento.',
  completed: 'Operacao concluida com sucesso.', failed: 'Operacao interrompida. Consulte o diagnostico do servidor.'
});
const OPERATION_MESSAGES = Object.freeze({
  'install-update': Object.freeze({ pending: 'Atualizacao aguardando processamento.', processing: 'Atualizacao em processamento.', completed: 'Atualizacao concluida com sucesso.', failed: 'Atualizacao interrompida. Consulte o diagnostico do servidor.' }),
  'create-backup': Object.freeze({ pending: 'Criacao de backup aguardando processamento.', processing: 'Criando backup.', completed: 'Backup criado com sucesso.', failed: 'Falha ao criar backup. Consulte o diagnostico do servidor.' }),
  'verify-backup': Object.freeze({ pending: 'Verificacao de backup aguardando processamento.', processing: 'Verificando backup.', completed: 'Backup verificado com sucesso.', failed: 'Falha ao verificar backup. Consulte o diagnostico do servidor.' }),
  'restore-backup': Object.freeze({ pending: 'Restauracao de backup aguardando processamento.', processing: 'Restaurando backup.', completed: 'Backup restaurado com sucesso.', failed: 'Falha ao restaurar backup. Consulte o diagnostico do servidor.' }),
  'delete-backup': Object.freeze({ pending: 'Exclusao de backup aguardando processamento.', processing: 'Excluindo backup.', completed: 'Backup excluido com sucesso.', failed: 'Falha ao excluir backup. Consulte o diagnostico do servidor.' })
});

function operationMessage(operation, state) {
  if (!OPERATIONS.includes(operation) || !OPERATION_STATES.includes(state)) {
    throw new AppError('OPERATION_STATUS_INVALID', 'Status operacional invalido.', 503);
  }
  return OPERATION_MESSAGES[operation]?.[state] || DEFAULT_STATE_MESSAGES[state];
}

function requestOperation(request, id) {
  const legacyV1 = request?.schemaVersion === 1 && request.action == null
    && request.operation === 'install-update';
  const legacyV2 = request?.schemaVersion === 2 && request.action === 'update'
    && request.operation === 'install-update';
  const current = request?.schemaVersion === 3 && request.action === 'operation'
    && OPERATIONS.includes(request.operation);
  if (request?.id !== id || (!legacyV1 && !legacyV2 && !current)) {
    throw new AppError('OPERATION_STATUS_INVALID', 'Status operacional invalido.', 503);
  }
  return request.operation;
}

function queueReady({ filesystem = fs, requestDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR, now = Date.now() } = {}) {
  try {
    const stat = filesystem.lstatSync(path.join(path.dirname(requestDirectory), 'daemon.ready'));
    return stat.isFile() && !stat.isSymbolicLink() && now - stat.mtimeMs >= 0
      && now - stat.mtimeMs <= HEARTBEAT_MAX_AGE_MS;
  } catch { return false; }
}

function assertQueueReady() {
  if (!queueReady()) throw new AppError('OPERATION_DAEMON_UNAVAILABLE', 'O mecanismo de operacoes nao esta pronto.', 503);
}

function createSignedRequest({ actorEmail, operation, backupId = null }) {
  if (!env.UPDATE_API_ENABLED) throw new AppError('OPERATION_API_DISABLED', 'Operacoes administrativas estao desabilitadas.', 503);
  if (!OPERATIONS.includes(operation) || (backupId !== null && !BACKUP_ID_PATTERN.test(backupId))) {
    throw new AppError('OPERATION_INVALID', 'Operacao administrativa invalida.', 400);
  }
  if (operation !== 'create-backup' && operation !== 'install-update' && !backupId) {
    throw new AppError('BACKUP_ID_INVALID', 'Identificador de backup invalido.', 400);
  }
  const requestedAt = new Date().toISOString();
  const request = {
    schemaVersion: 3,
    id: crypto.randomUUID(),
    action: 'operation',
    timestamp: requestedAt,
    requester: String(actorEmail).toLowerCase(),
    operation,
    requestedAt,
    requestedBy: String(actorEmail).toLowerCase(),
    nonce: crypto.randomBytes(32).toString('hex'),
    backupId
  };
  request.signature = crypto.createHmac('sha256', env.UPDATE_REQUEST_SECRET)
    .update(JSON.stringify(request)).digest('hex');
  return request;
}

function writeStatus(id, state, requestedAt = new Date().toISOString(), operation = 'install-update') {
  if (!OPERATION_STATES.includes(state)) throw new AppError('OPERATION_STATUS_INVALID', 'Estado operacional invalido.', 500);
  fs.mkdirSync(env.DEVFLOW_UPDATER_STATUS_DIR, { recursive: true, mode: 0o700 });
  const destination = path.join(env.DEVFLOW_UPDATER_STATUS_DIR, `${id}.json`);
  const temporary = path.join(env.DEVFLOW_UPDATER_STATUS_DIR, `.${id}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, id, operation, state, message: operationMessage(operation, state), requestedAt, updatedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function persistRequest(request, { filesystem = fs, queueDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR, statusWriter = writeStatus } = {}) {
  const destination = path.join(queueDirectory, `${request.id}.json`);
  const temporary = path.join(queueDirectory, `.${request.id}.${process.pid}.tmp`);
  try {
    filesystem.mkdirSync(queueDirectory, { recursive: true, mode: 0o700 });
    filesystem.chmodSync(queueDirectory, 0o700);
    filesystem.writeFileSync(temporary, `${JSON.stringify(request)}\n`, { flag: 'wx', mode: 0o600 });
    statusWriter(request.id, 'pending', request.requestedAt, request.operation);
    filesystem.renameSync(temporary, destination);
  } catch (error) {
    filesystem.rmSync(temporary, { force: true });
    console.error('[OPERATION_QUEUE] Falha sanitizada ao gravar solicitacao.', { code: String(error?.code || 'UNKNOWN').slice(0, 40), request_id: request.id });
    throw new AppError('OPERATION_REQUEST_WRITE_FAILED', 'Nao foi possivel registrar a operacao na fila privada.', 503);
  }
  return destination;
}

function queueDirectories() {
  const root = path.dirname(env.DEVFLOW_UPDATER_QUEUE_DIR);
  return [
    { directory: env.DEVFLOW_UPDATER_QUEUE_DIR, status: 'pending' },
    { directory: path.join(root, 'processing'), status: 'processing' },
    { directory: path.join(root, 'processed'), status: 'completed' },
    { directory: path.join(root, 'failed'), status: 'failed' }
  ];
}

function readSafeJson(source, filesystem = fs) {
  if (!filesystem.existsSync(source)) return null;
  const stat = filesystem.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new AppError('OPERATION_STATUS_INVALID', 'Status operacional invalido.', 503);
  try { return JSON.parse(filesystem.readFileSync(source, 'utf8')); }
  catch { throw new AppError('OPERATION_STATUS_INVALID', 'Status operacional invalido.', 503); }
}

function getRequestStatus(id, { filesystem = fs, directories = queueDirectories(), statusDirectory = env.DEVFLOW_UPDATER_STATUS_DIR } = {}) {
  if (!REQUEST_ID_PATTERN.test(id)) throw new AppError('OPERATION_REQUEST_NOT_FOUND', 'Solicitacao operacional nao encontrada.', 404);
  let lifecycle;
  for (const entry of directories) {
    const request = readSafeJson(path.join(entry.directory, `${id}.json`), filesystem);
    if (!request) continue;
    lifecycle = { ...entry, request, operation: requestOperation(request, id) };
    break;
  }
  if (!lifecycle) throw new AppError('OPERATION_REQUEST_NOT_FOUND', 'Solicitacao operacional nao encontrada.', 404);
  const detail = readSafeJson(path.join(statusDirectory, `${id}.json`), filesystem);
  if (detail && (detail.schemaVersion !== 1 || detail.id !== id || !OPERATION_STATES.includes(detail.state)
    || typeof detail.message !== 'string' || detail.message.length > 240
    || (detail.operation != null && detail.operation !== lifecycle.operation))) {
    throw new AppError('OPERATION_STATUS_INVALID', 'Status operacional invalido.', 503);
  }
  const state = lifecycle.status === 'processing' && PROCESSING_STATES.includes(detail?.state) ? detail.state : lifecycle.status;
  const message = ['completed', 'failed'].includes(state)
    ? operationMessage(lifecycle.operation, state)
    : detail?.message || operationMessage(lifecycle.operation, state);
  return Object.freeze({
    id, operation: lifecycle.operation, backupId: lifecycle.request.backupId || null,
    status: lifecycle.status, state, message,
    requestedAt: detail?.requestedAt || lifecycle.request.requestedAt,
    updatedAt: detail?.updatedAt || null,
    ...(lifecycle.status === 'failed' ? { error: 'A operacao falhou. Consulte os logs do servidor.' } : {})
  });
}

function backupIsInActiveOperation(backupId, { filesystem = fs, queueDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR } = {}) {
  if (!BACKUP_ID_PATTERN.test(backupId)) return false;
  const root = path.dirname(queueDirectory);
  return ['requests', 'processing'].some((name) => {
    const directory = path.join(root, name);
    if (!filesystem.existsSync(directory)) return false;
    return filesystem.readdirSync(directory).some((filename) => {
      if (!REQUEST_ID_PATTERN.test(filename.replace(/\.json$/, ''))) return false;
      try { return readSafeJson(path.join(directory, filename), filesystem)?.backupId === backupId; } catch { return true; }
    });
  });
}

module.exports = {
  OPERATIONS, STATES: OPERATION_STATES, OPERATION_STATES, OPERATION_MESSAGES,
  REQUEST_ID_PATTERN, BACKUP_ID_PATTERN, queueReady, assertQueueReady,
  createSignedRequest, writeStatus, persistRequest, getRequestStatus, queueDirectories,
  backupIsInActiveOperation, operationMessage, requestOperation
};
