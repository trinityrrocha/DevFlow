#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ALLOWED_STATES = new Set([
  'pending', 'processing', 'backup', 'maintenance', 'migrations',
  'containers', 'health', 'rollback', 'completed', 'failed'
]);
const SAFE_MESSAGES = Object.freeze({
  pending: 'Atualizacao aguardando processamento.',
  processing: 'Atualizacao em processamento.',
  backup: 'Backup de seguranca em andamento.',
  maintenance: 'Modo de manutencao ativo.',
  migrations: 'Migrations em processamento.',
  containers: 'Servicos da aplicacao em atualizacao.',
  health: 'Validando a saude da aplicacao.',
  rollback: 'Restauracao automatica em andamento.',
  completed: 'Atualizacao concluida com sucesso.',
  failed: 'Atualizacao interrompida. Consulte o diagnostico do servidor.'
});

const [statusPath, state] = process.argv.slice(2);
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
const id = basename(absolute, '.json');
const now = new Date().toISOString();
const payload = {
  schemaVersion: 1,
  id,
  state,
  message: SAFE_MESSAGES[state],
  requestedAt: previous.requestedAt || now,
  updatedAt: now
};
mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
const temporary = `${absolute}.${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600 });
renameSync(temporary, absolute);
