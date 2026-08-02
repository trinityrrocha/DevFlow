import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const version = read('VERSION').trim();
const rootPackage = JSON.parse(read('package.json'));
const backendPackage = JSON.parse(read('backend/package.json'));
const frontendPackage = JSON.parse(read('frontend/package.json'));
const install = read('scripts/install.sh');
const bootstrap = read('scripts/bootstrap.sh');
const update = read('scripts/update.sh');
const restore = read('scripts/restore.sh');
const diagnostic = read('scripts/detect-shared-proxy.sh');
const composeInputDiscovery = read('scripts/discover-compose-inputs.py');
const bashInitializationAudit = read('scripts/audit-bash-initialization.mjs');
const proxyConfig = read('scripts/lib/proxy-config.sh');
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
for (const [label, fragment] of [
  ['repositório público', "REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'"],
  ['diretório temporário', 'mktemp -d'],
  ['clone público', 'git clone'],
  ['validação de commit remoto', 'REMOTE_COMMIT'],
  ['validação VERSION', 'EXPECTED_VERSION'],
  ['limpeza', 'trap cleanup EXIT'],
  ['instalador interno', 'scripts/install.sh'],
  ['confirmação', 'Deseja iniciar a instalação? [s/N]'],
]) {
  if (!bootstrap.includes(fragment)) throw new Error(`Gate ausente no bootstrap: ${label}.`);
}
if (!bootstrap.includes(`EXPECTED_VERSION='${version}'`)) {
  throw new Error('Bootstrap público diverge de VERSION.');
}
if (bootstrap.includes('lib/common.sh') || bootstrap.includes('DEVFLOW_ENV_FILE')) {
  throw new Error('Bootstrap público depende indevidamente do checkout ou da configuração instalada.');
}
if (!install.includes("public_remote='https://github.com/trinityrrocha/DevFlow.git'")) {
  throw new Error('Instalador não fixa o checkout operacional no HTTPS público.');
}
if (!install.includes('run_shared_proxy_diagnostic') || !install.includes('detect-shared-proxy.sh')) {
  throw new Error('Instalador não exige diagnóstico antes do modo compartilhado.');
}
for (const fragment of [
  '$DEVFLOW_CONFIG_ROOT/proxy',
  '$DEVFLOW_DATA_ROOT/postgres',
  '$DEVFLOW_STATE_ROOT',
  '$DEVFLOW_INSTALL_ROOT/storage/acme',
  '/opt/devflow/logs/shared-proxy-diagnostic.log',
]) {
  if (!install.includes(fragment)) throw new Error(`Estrutura centralizada ausente no instalador: ${fragment}`);
}
const dryRunExit = install.indexOf('[[ "$MODE" == dry-run ]] && {');
const directoryCreation = install.indexOf('install -d -m 0750 "$DEVFLOW_INSTALL_ROOT"');
if (!(dryRunExit >= 0 && directoryCreation > dryRunExit)) {
  throw new Error('Dry-run deve encerrar antes de criar a estrutura persistente.');
}
for (const fragment of [
  'CHECK_STATUS=passed-with-privileged-dry-run-required',
  'reason=privileged-compose-validation-required',
  'changes_applied=false',
]) {
  if (!install.includes(fragment)) throw new Error(`Separação check/dry-run incompleta: ${fragment}`);
}
for (const fragment of [
  '--project-directory %q',
  'COMPOSE_CROSS_DIRECTORY_SUPPORTED=unknown',
  'COMPOSE_VALIDATION_BLOCKED_BY=protected-env-file',
  'trap cleanup_diagnostic_temps EXIT',
]) {
  if (!diagnostic.includes(fragment)) throw new Error(`Gate privilegiado ausente: ${fragment}`);
}
if (!composeInputDiscovery.includes('COMPOSE_ENV_FILES')
  || !composeInputDiscovery.includes('env_file')
  || !composeInputDiscovery.includes('required-variable')) {
  throw new Error('Descoberta opaca dos inputs do Compose está incompleta.');
}
if (!bashInitializationAudit.includes('FULLPASSWORD_COMPOSE_FILE')
  || !bashInitializationAudit.includes('unsafeFixture')
  || !rootPackage.scripts['audit:bash-initialization']) {
  throw new Error('Auditoria de variáveis Bash não está integrada ao pipeline.');
}
if (!diagnostic.includes('fullpassword-nginx') || !diagnostic.includes('caddy-container')) {
  throw new Error('Política fail-closed de proxies containerizados está incompleta.');
}
if (!proxyConfig.includes('proxy_restore_transaction') || !proxyConfig.includes('remove_host_nginx_config')) {
  throw new Error('Transação reversível do arquivo de proxy está incompleta.');
}
if (/git@github\.com|deploy[_ -]?key|GIT_SSH_COMMAND/i.test(update)) {
  throw new Error('Updater ainda possui dependência de autenticação privada.');
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
  ['estado de versão', 'write_version_state "$NEW_SHA"'],
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
for (const fragment of [
  'status --porcelain',
  'merge-base --is-ancestor "$operational_sha" "$release_sha"',
  'merge --ff-only "$release_sha"',
]) {
  if (!install.includes(fragment)) throw new Error(`Retomada segura da instalação incompleta ausente: ${fragment}`);
}

process.stdout.write(`Operações DevFlow ${version} validadas estruturalmente.\n`);
