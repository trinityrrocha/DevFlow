import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const bootstrap = read('scripts/bootstrap.sh');
const install = read('scripts/install.sh');
const diagnostic = read('scripts/detect-shared-proxy.sh');
const proxyConfig = read('scripts/lib/proxy-config.sh');
const uninstall = read('scripts/uninstall.sh');
const compose = read('docker-compose.yml');
const acmeProxy = read('docker/nginx/host-acme.conf.template');

for (const fragment of [
  'Nginx no host',
  'Recomendado',
  'containers, redes, volumes e banco',
  'Proxy isolado',
  'Escolha [1/2]',
]) {
  if (!bootstrap.includes(fragment)) throw new Error(`Descrição de modo ausente: ${fragment}`);
}
for (const fragment of [
  'require_numeric_confirmation shared-proxy-diagnostic',
  'detect-shared-proxy.sh',
  'Integração automática não comprovada.',
  '/opt/devflow/logs/shared-proxy-diagnostic.log',
]) {
  if (!install.includes(fragment)) throw new Error(`Gate do instalador compartilhado ausente: ${fragment}`);
}
for (const fragment of [
  'docker inspect',
  'docker exec "$PROXY_CONTAINER" nginx -T',
  'docker network inspect',
  'certificate_method=',
  'compose_working_dir=',
  'devflow_directory_writable=',
  'devflow_override_writable=',
  'devflow_proxy_config_writable=',
  'devflow_write_context=root-installation',
  'fullpassword_compose_readable=',
  'fullpassword_compose_variable_initialized=',
  'fullpassword_compose_detected=',
  'fullpassword_compose_file=',
  'fullpassword_compose_exists=',
  'protected_input_detected=',
  'internal_script_error=',
  'compose_cross_directory_supported=',
  'compose_merge_valid=',
  'compose_validation_command=',
  'compose_executed_command=',
  'execution_uid=',
  'protected_compose_inputs_detected=',
  'privileged_validation_required=',
  'compose_validation_attempted=',
  'compose_validation_blocked_by=',
  'changes_applied=',
  'installation_ready=',
  'sensitive_values_logged=',
  '--project-directory %q',
  'compatibility=',
  'sanitize_proxy_stream',
  'discover_fullpassword_compose()',
  'validate_fullpassword_compose_path()',
  'discover_protected_compose_inputs()',
  'validate_compose_merge()',
  'handle_internal_error()',
]) {
  if (!diagnostic.includes(fragment)) throw new Error(`Coleta diagnóstica ausente: ${fragment}`);
}
if (/docker (restart|start|stop|network connect)/.test(diagnostic)
  || /^\s*(?:docker exec[^\n]+)?nginx -s reload/m.test(diagnostic)) {
  throw new Error('O diagnóstico contém uma mutação proibida do proxy.');
}
if (!diagnostic.includes('trap cleanup_diagnostic_temps EXIT') || !diagnostic.includes("trap 'exit 130' INT TERM")) {
  throw new Error('Limpeza segura dos temporários diagnósticos está incompleta.');
}
if (!proxyConfig.includes('proxy_restore_transaction') || !proxyConfig.includes('systemctl reload nginx')) {
  throw new Error('Rollback atômico do proxy não está implementado.');
}
if (!uninstall.includes('provider_uninstall')) {
  throw new Error('Desinstalação não remove exclusivamente a rota DevFlow.');
}
if (!compose.includes('devflow_edge:') || !compose.includes('internal: true')) {
  throw new Error('Separação entre rede de borda e rede interna ausente.');
}
if (!acmeProxy.includes('return 503;') || acmeProxy.includes('proxy_pass')) {
  throw new Error('O virtual host temporário não pode publicar a aplicação antes dos health checks.');
}

const bashCandidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe']
  : ['bash'];
const bash = bashCandidates.find(existsSync) || bashCandidates[0];
const test = spawnSync(bash, [resolve(root, 'tests/integration/shared-proxy.test.sh')], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
if (test.status !== 0) {
  throw new Error(`Testes do proxy compartilhado falharam:\n${test.stdout}\n${test.stderr}`);
}
process.stdout.write(test.stdout);
