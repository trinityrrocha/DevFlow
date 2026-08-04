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
const versionLibrary = read('scripts/lib/version.sh');
const update = read('scripts/update.sh');
const publish = read('scripts/publish.sh');
const portOwnership = read('scripts/lib/port-ownership.sh');
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
  ['clone público', 'http.followRedirects=false clone'],
  ['validação de commit remoto', 'REMOTE_COMMIT'],
  ['validação VERSION', 'devflow_validate_checkout_version_consistency'],
  ['política central de versão', 'scripts/lib/version.sh'],
  ['versão esperada opcional', '--expected-version'],
  ['referência dinâmica', '--ref'],
  ['limpeza', 'trap cleanup EXIT'],
  ['instalador interno', 'scripts/install.sh'],
]) {
  if (!bootstrap.includes(fragment)) throw new Error(`Gate ausente no bootstrap: ${label}.`);
}
if (bootstrap.includes('DEVFLOW_BOOTSTRAP_CONFIRMED')
  || !install.includes('require_numeric_confirmation initial-installation')) {
  throw new Error('Bootstrap não delega a confirmação numérica ao instalador validado.');
}
if (/EXPECTED_VERSION=['"][0-9]/.test(bootstrap) || bootstrap.includes('RAW_VERSION_URL')) {
  throw new Error('Bootstrap público ainda contém versão fixa ou leitura remota não validada.');
}
if (bootstrap.includes('lib/common.sh') || bootstrap.includes('DEVFLOW_ENV_FILE')) {
  throw new Error('Bootstrap público depende indevidamente do checkout ou da configuração instalada.');
}
if (!install.includes("public_remote='https://github.com/trinityrrocha/DevFlow.git'")) {
  throw new Error('Instalador não fixa o checkout operacional no HTTPS público.');
}
for (const [label, source, fragment] of [
  ['bootstrap', bootstrap, 'devflow_validate_checkout_version_consistency'],
  ['instalador', install, 'devflow_validate_checkout_version_consistency'],
  ['atualizador', update, 'devflow_validate_git_tree_version_consistency'],
]) {
  if (!source.includes(fragment)) throw new Error(`Política central de versão ausente no ${label}.`);
}
for (const fragment of [
  'devflow_semver_is_valid',
  'devflow_read_version_file',
  'devflow_validate_checkout_identity',
  'devflow_validate_directory_version_consistency',
  'devflow_version_mismatch_message',
]) {
  if (!versionLibrary.includes(fragment)) throw new Error(`Contrato de versão incompleto: ${fragment}.`);
}
if (!install.includes('DEVFLOW_BOOTSTRAP_REF') || !install.includes('merge-base --is-ancestor "$release_sha" origin/main')) {
  throw new Error('Instalação por tag não prepara checkout operacional atualizável com segurança.');
}
for (const fragment of ['--install-internal', '--install-scope', 'planned-internal-only', 'POSTGRES_PUBLIC_PORT_EXPOSED=false']) {
  if (!install.includes(fragment)) throw new Error(`Separação de instalação ausente: ${fragment}.`);
}
for (const fragment of ['docker ps', 'docker inspect', 'docker port', 'ss -H -ltnp', 'owner-unproven']) {
  if (!portOwnership.includes(fragment)) throw new Error(`Evidência de propriedade incompleta: ${fragment}.`);
}
for (const fragment of ['health.sh" --internal --quiet', 'provider_dry_run', 'provider_activate', 'write_install_report published']) {
  if (!publish.includes(fragment)) throw new Error(`Publicador posterior incompleto: ${fragment}.`);
}
if (publish.includes('scripts/migrate.js') || !rootPackage.scripts['validate:installation-scopes']) {
  throw new Error('Publicação reinstala schema ou testes de escopo não estão integrados.');
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
const dryRunExit = install.indexOf('if [[ "$MODE" == dry-run ]]');
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
  ['migration', 'run_devflow_migrations'],
  ['health interno', 'health.sh" --internal'],
  ['health público', 'health.sh"'],
  ['rollback', 'rollback_update'],
  ['restauração', 'restore.sh'],
  ['log', 'UPDATE_LOG'],
  ['confirmação', 'require_numeric_confirmation application-update'],
  ['estado instalado', 'persist_operational_installation_state'],
  ['commit anterior transacional', 'previousInstalledCommit'],
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
const migration = update.indexOf('run_devflow_migrations', servicesStop);
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
