#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ALLOWED_STATES = new Set([
  'pending', 'processing', 'backup', 'maintenance', 'migrations',
  'containers', 'health', 'rollback', 'rolling-back', 'completed', 'failed'
]);
const ALLOWED_OPERATIONS = new Set([
  'install-update', 'create-backup', 'verify-backup', 'restore-backup', 'delete-backup'
]);
const SAFE_STATE_MESSAGES = Object.freeze({
  pending: 'Operacao aguardando processamento.',
  processing: 'Operacao em processamento.',
  backup: 'Backup de seguranca em andamento.',
  maintenance: 'Modo de manutencao ativo.',
  migrations: 'Migrations em processamento.',
  containers: 'Servicos da aplicacao em atualizacao.',
  health: 'Validando a saude da aplicacao.',
  rollback: 'Rollback operacional em andamento.',
  'rolling-back': 'Rollback operacional em andamento.',
  completed: 'Operacao concluida com sucesso.',
  failed: 'Operacao interrompida. Consulte o diagnostico do servidor.'
});
const OPERATION_MESSAGES = Object.freeze({
  'install-update': Object.freeze({ pending: 'Atualizacao aguardando processamento.', processing: 'Atualizacao em processamento.', completed: 'Atualizacao concluida com sucesso.', failed: 'Atualizacao interrompida. Consulte o diagnostico do servidor.' }),
  'create-backup': Object.freeze({ pending: 'Criacao de backup aguardando processamento.', processing: 'Criando backup.', completed: 'Backup criado com sucesso.', failed: 'Falha ao criar backup. Consulte o diagnostico do servidor.' }),
  'verify-backup': Object.freeze({ pending: 'Verificacao de backup aguardando processamento.', processing: 'Verificando backup.', completed: 'Backup verificado com sucesso.', failed: 'Falha ao verificar backup. Consulte o diagnostico do servidor.' }),
  'restore-backup': Object.freeze({ pending: 'Restauracao de backup aguardando processamento.', processing: 'Restaurando backup.', completed: 'Backup restaurado com sucesso.', failed: 'Falha ao restaurar backup. Consulte o diagnostico do servidor.' }),
  'delete-backup': Object.freeze({ pending: 'Exclusao de backup aguardando processamento.', processing: 'Excluindo backup.', completed: 'Backup excluido com sucesso.', failed: 'Falha ao excluir backup. Consulte o diagnostico do servidor.' })
});

const [statusPath, state, operationArgument] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`invalid-update-status:${message}\n`); process.exit(2); };
if (!statusPath || !ALLOWED_STATES.has(state)) fail('arguments');
const absolute = resolve(statusPath);
if (!absolute.startsWith('/var/lib/devflow/updater/status/') || basename(absolute) !== basename(statusPath)) fail('path');
if (!/^[0-9a-f-]{36}\.json$/.test(basename(absolute))) fail('identity');

let previous = {};
if (existsSync(absolute)) {
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) fail('unsafe-file');
  try { previous = JSON.parse(readFileSync(absolute, 'utf8')); } catch { fail('json'); }
}
const operation = operationArgument || previous.operation || null;
if (operation !== null && !ALLOWED_OPERATIONS.has(operation)) fail('operation');
const id = basename(absolute, '.json');
const now = new Date().toISOString();
const payload = {
  schemaVersion: 1,
  id,
  ...(operation ? { operation } : {}),
  state,
  message: OPERATION_MESSAGES[operation]?.[state] || SAFE_STATE_MESSAGES[state],
  requestedAt: previous.requestedAt || now,
  updatedAt: now
};
mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
const temporary = `${absolute}.${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600 });
renameSync(temporary, absolute);
