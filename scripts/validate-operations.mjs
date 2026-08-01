import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const version = read('VERSION').trim();
const rootPackage = JSON.parse(read('package.json'));
const backendPackage = JSON.parse(read('backend/package.json'));
const frontendPackage = JSON.parse(read('frontend/package.json'));
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const restore = read('scripts/restore.sh');
const changelog = read('CHANGELOG.md');

if (!/^\d+\.\d+\.\d+-alpha$/.test(version)) throw new Error(`Versão alpha inválida: ${version}`);
for (const [name, value] of [
  ['package.json', rootPackage.version],
  ['backend/package.json', backendPackage.version],
  ['frontend/package.json', frontendPackage.version],
]) {
  if (value !== version) throw new Error(`${name} diverge de VERSION.`);
}
if (!changelog.includes(`## [${version}]`)) throw new Error('Changelog da versão atual ausente.');
if (/--update|MODE.*update|install\.sh --update/.test(install)) {
  throw new Error('install.sh ainda contém responsabilidade de atualização.');
}

const updaterGates = [
  ['lock exclusivo', 'flock -n'],
  ['remote autorizado', 'trinityrrocha/DevFlow'],
  ['backup', 'backup.sh'],
  ['verificação do backup', 'verify-backup.sh'],
  ['manutenção', 'enter_maintenance'],
  ['migration', 'scripts/migrate.js'],
  ['health interno', 'health.sh" --internal'],
  ['health público', 'health.sh"'],
  ['rollback', 'rollback_update'],
  ['restauração', 'restore.sh'],
  ['log', 'UPDATE_LOG'],
  ['confirmação', "confirm_exact 'ATUALIZAR DEVFLOW'"],
];
for (const [label, fragment] of updaterGates) {
  if (!update.includes(fragment)) throw new Error(`Gate ausente no updater: ${label}.`);
}
if (!restore.includes('DEVFLOW_RESTORE_NO_START')) {
  throw new Error('Restore não oferece coordenação segura para rollback.');
}
const backupGate = update.indexOf('verify-backup.sh');
const candidateGate = update.indexOf('componentes transacionais obrigatórios');
const rollbackArm = update.lastIndexOf('ROLLBACK_ARMED=true');
const sourceAdvance = update.indexOf('git -C "$SOURCE_DIR" merge --ff-only');
const maintenance = update.lastIndexOf('enter_maintenance "$CANDIDATE_DIR"');
const servicesStop = update.indexOf('stop backend frontend', maintenance);
const migration = update.indexOf('scripts/migrate.js', servicesStop);
if (!(backupGate < candidateGate && candidateGate < rollbackArm && rollbackArm < sourceAdvance)) {
  throw new Error('Ordem dos gates backup/release/rollback/source está insegura.');
}
if (!(maintenance < servicesStop && servicesStop < migration)) {
  throw new Error('Serviços devem parar em manutenção antes das migrations.');
}
if (!install.includes('DEVFLOW_SOURCE_DIR=$operational_source_dir') || !install.includes('core.hooksPath /dev/null')) {
  throw new Error('Instalador não prepara o checkout operacional protegido.');
}

process.stdout.write(`Operações DevFlow ${version} validadas estruturalmente.\n`);
