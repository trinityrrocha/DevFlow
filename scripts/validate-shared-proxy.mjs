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
  'Instalação independente, recomendada para servidor limpo',
  'containers próprios;',
  'volumes próprios;',
  'banco próprio;',
  'Nenhuma configuração existente será sobrescrita.',
  'Escolha [1/2]:',
]) {
  if (!bootstrap.includes(fragment)) throw new Error(`Descrição de modo ausente: ${fragment}`);
}
for (const fragment of [
  'Deseja executar o diagnóstico? [s/N]',
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
  'fullpassword_compose_readable=',
  'compose_cross_directory_supported=',
  'compose_merge_valid=',
  'compose_validation_command=',
  'compose_executed_command=',
  'compatibility=',
  'sanitize_proxy_stream',
]) {
  if (!diagnostic.includes(fragment)) throw new Error(`Coleta diagnóstica ausente: ${fragment}`);
}
if (/docker (restart|start|stop|network connect)/.test(diagnostic)
  || /^\s*(?:docker exec[^\n]+)?nginx -s reload/m.test(diagnostic)) {
  throw new Error('O diagnóstico contém uma mutação proibida do proxy.');
}
if (!proxyConfig.includes('proxy_restore_transaction') || !proxyConfig.includes('systemctl reload nginx')) {
  throw new Error('Rollback atômico do proxy não está implementado.');
}
if (!uninstall.includes('remove_host_nginx_config')) {
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
