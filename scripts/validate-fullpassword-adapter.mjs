import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const base = YAML.parse(read('tests/fixtures/fullpassword-compose.yml'));
base.services.nginx.environment = { FP_VALIDATOR_SECRET: 'validator-secret-must-not-leak' };
base.volumes = { fullpassword_data: { name: 'fullpassword_data' } };
const override = YAML.parse(read('docker/fullpassword/fullpassword-nginx.override.yml.template'));
const adapter = read('scripts/lib/fullpassword-proxy.sh');
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const uninstall = read('scripts/uninstall.sh');
const health = read('scripts/health.sh');

function volumeTarget(volume) {
  if (typeof volume === 'string') return volume.split(':')[1];
  return volume.target;
}

function mergeCompose(original, addition) {
  const merged = structuredClone(original);
  merged.networks = { ...(original.networks || {}), ...(addition.networks || {}) };
  for (const [name, serviceAddition] of Object.entries(addition.services || {})) {
    const service = merged.services[name] = { ...(merged.services[name] || {}) };
    const volumes = new Map((service.volumes || []).map((value) => [volumeTarget(value), value]));
    for (const value of serviceAddition.volumes || []) volumes.set(volumeTarget(value), value);
    service.volumes = [...volumes.values()];
    service.networks = [...new Set([...(service.networks || []), ...(serviceAddition.networks || [])])];
  }
  return merged;
}

const merged = mergeCompose(base, override);
const repeated = mergeCompose(merged, override);
if (JSON.stringify(merged) !== JSON.stringify(repeated)) throw new Error('Merge repetido do override não é idempotente.');

for (const port of ['80:80', '443:443']) {
  if (!merged.services.nginx.ports.includes(port)) throw new Error(`Porta original perdida: ${port}`);
}
for (const target of ['/etc/nginx/conf.d/default.conf', '/etc/letsencrypt']) {
  if (!merged.services.nginx.volumes.some((value) => volumeTarget(value) === target)) {
    throw new Error(`Mount original perdido: ${target}`);
  }
}
for (const target of ['/etc/nginx/conf.d/devflow.conf', '/var/www/certbot']) {
  const value = merged.services.nginx.volumes.find((item) => volumeTarget(item) === target);
  if (!value?.read_only) throw new Error(`Mount read-only do adaptador ausente: ${target}`);
}
for (const source of ['/opt/devflow/config/nginx/devflow.conf', '/opt/devflow/storage/acme']) {
  if (!JSON.stringify(override).includes(source)) throw new Error(`Origem absoluta ausente no override: ${source}`);
}
for (const network of ['fullpassword_network', 'devflow_edge']) {
  if (!merged.services.nginx.networks.includes(network)) throw new Error(`Rede ausente no merge: ${network}`);
}
if (JSON.stringify(base).includes('devflow.conf') || JSON.stringify(base).includes('devflow_edge')) {
  throw new Error('Fixture original foi alterada pelo adaptador.');
}

const bundledPython = resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe');
const python = process.env.DEVFLOW_TEST_PYTHON
  || (process.platform === 'win32' && existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const temporary = mkdtempSync(join(tmpdir(), 'devflow-compose-validator-'));
try {
  const basePath = join(temporary, 'base.json');
  const mergedPath = join(temporary, 'merged.json');
  writeFileSync(basePath, JSON.stringify(base));
  writeFileSync(mergedPath, JSON.stringify(merged));
  const valid = spawnSync(python, [resolve(root, 'scripts/validate-fullpassword-compose.py'), basePath, mergedPath], { encoding: 'utf8' });
  if (valid.status !== 0) throw new Error(`Validador rejeitou merge válido: ${valid.stderr}`);
  if (valid.stdout.includes('validator-secret-must-not-leak')) {
    throw new Error('Validador expôs valor interpolado do ambiente na saída.');
  }
  for (const fact of [
    'original_services_preserved=true',
    'original_restart_policies_preserved=true',
    'original_images_preserved=true',
    'original_volumes_preserved=true',
    'original_environment_preserved=true',
    'sensitive_values_logged=false',
  ]) {
    if (!valid.stdout.includes(fact)) throw new Error(`Fato estrutural sanitizado ausente: ${fact}`);
  }

  for (const [label, mutate] of [
    ['mount original', (value) => { value.services.nginx.volumes = value.services.nginx.volumes.filter((item) => volumeTarget(item) !== '/etc/nginx/conf.d/default.conf'); }],
    ['porta original', (value) => { value.services.nginx.ports = ['80:80']; }],
    ['porta adicional', (value) => { value.services.nginx.ports.push('8443:443'); }],
    ['rede original', (value) => { value.services.nginx.networks = ['devflow_edge']; }],
    ['mount DevFlow', (value) => { value.services.nginx.volumes = value.services.nginx.volumes.filter((item) => volumeTarget(item) !== '/etc/nginx/conf.d/devflow.conf'); }],
    ['mount adicional', (value) => { value.services.nginx.volumes.push({ type: 'bind', source: '/tmp/extra', target: '/extra', read_only: true }); }],
    ['imagem original', (value) => { value.services.nginx.image = 'nginx:latest'; }],
    ['restart original', (value) => { value.services.nginx.restart = 'always'; }],
    ['environment original', (value) => { value.services.nginx.environment.FP_VALIDATOR_SECRET = 'changed'; }],
    ['propriedade adicional', (value) => { value.services.nginx.privileged = true; }],
    ['volume nomeado original', (value) => { value.volumes.fullpassword_data.name = 'changed'; }],
    ['definição de topo adicional', (value) => { value.configs = { unexpected: { file: '/tmp/unexpected' } }; }],
    ['serviço inesperado', (value) => { value.services.unexpected = { image: 'busybox' }; }],
  ]) {
    const invalid = structuredClone(merged);
    mutate(invalid);
    writeFileSync(mergedPath, JSON.stringify(invalid));
    const result = spawnSync(python, [resolve(root, 'scripts/validate-fullpassword-compose.py'), basePath, mergedPath], { encoding: 'utf8' });
    if (result.status === 0) throw new Error(`Validador aceitou perda de ${label}.`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

for (const [label, source, fragment] of [
  ['preflight', adapter, 'fullpassword_adapter_preflight'],
  ['backup transacional', adapter, 'fullpassword_adapter_snapshot'],
  ['merge Compose', adapter, 'validate_fullpassword_compose_merge'],
  ['nginx -t candidato', adapter, 'validate_fullpassword_nginx_candidate'],
  ['certificado', adapter, 'certbot certonly --webroot'],
  ['prova de rota ACME', adapter, 'validate_devflow_acme_route'],
  ['rollback', adapter, 'fullpassword_adapter_restore_snapshot'],
  ['health Full Password', adapter, 'fullpassword_public_health'],
  ['health DevFlow', adapter, 'devflow_public_health'],
  ['recriação sem dependências', adapter, 'up -d --no-deps "$FULLPASSWORD_SERVICE"'],
  ['instalação', install, 'install_fullpassword_proxy_adapter'],
  ['atualização', update, 'promote_fullpassword_proxy_config'],
  ['rede transacional no update', update, 'EDGE_NETWORK_PREEXISTED'],
  ['desinstalação', uninstall, 'uninstall_fullpassword_proxy_adapter'],
  ['health operacional', health, 'fullpassword_public_health'],
]) {
  if (!source.includes(fragment)) throw new Error(`Gate ausente (${label}): ${fragment}`);
}
if (/docker-compose\.yml[^\n]*(>|tee)|nginx\.runtime\.conf[^\n]*(>|tee)/.test(adapter)) {
  throw new Error('Adaptador contém escrita aparente em arquivo original do Full Password.');
}
if (!adapter.includes('FULLPASSWORD_OVERRIDE_FILE="$DEVFLOW_PROXY_ROOT/fullpassword-nginx.override.yml"')) {
  throw new Error('Override persistente não está centralizado em /opt/devflow/config/proxy.');
}
if (!adapter.includes('docker compose --project-directory "$FULLPASSWORD_ROOT"')) {
  throw new Error('Adaptador não fixa o diretório do projeto Compose original.');
}
if (adapter.includes('$FULLPASSWORD_ROOT/docker-compose.devflow.yml')) {
  throw new Error('Caminho legado de override sob /opt/fullpassword ainda está ativo.');
}

const bashCandidates = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'] : ['bash'];
const bash = bashCandidates.find(existsSync) || bashCandidates[0];
const transactions = spawnSync(bash, [resolve(root, 'tests/integration/fullpassword-adapter.test.sh')], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
if (transactions.status !== 0) {
  throw new Error(`Testes transacionais do adaptador falharam:\n${transactions.stdout}\n${transactions.stderr}`);
}
process.stdout.write(transactions.stdout);

console.log('Full Password adapter tests passed: merge, preservation, idempotency and rollback gates.');
