import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scriptRoot = join(root, 'scripts');
const self = 'scripts/audit-fullpassword-readonly.mjs';
const failures = [];
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && (entry.name.endsWith('.sh') || entry.name.endsWith('.mjs'))) files.push(absolute);
  }
}

walk(scriptRoot);

const mutatingCommand = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:cp|install|mv|rm|mkdir|touch|chmod|chown|ln|truncate|rsync|dd|tar\s+[^\n]*-[^\n]*[cf])\b/;
const fullPasswordTarget = /(?:\/opt\/fullpassword|\$\{?FULLPASSWORD_(?:ROOT|COMPOSE_FILE|RUNTIME_CONFIG)\}?)/;
const redirectToFullPassword = /(?:>|>>|tee(?:\s+-a)?)\s*(?:["']?\/opt\/fullpassword|["']?\$\{?FULLPASSWORD_(?:ROOT|COMPOSE_FILE|RUNTIME_CONFIG)\}?)/;
const inPlaceEdit = /(?:sed|perl)\s+[^\n]*(?:-i|--in-place)[^\n]*(?:\/opt\/fullpassword|\$\{?FULLPASSWORD_(?:ROOT|COMPOSE_FILE|RUNTIME_CONFIG)\}?)/;
const forbiddenEnvRead = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:cat|source|\.|grep|sed|awk|head|tail|less|more|strings|cp)\b[^\n]*(?:\/opt\/fullpassword\/\.env|\$\{?FULLPASSWORD_ROOT\}?\/\.env)/;
const envInputRedirect = /<\s*["']?(?:\/opt\/fullpassword\/\.env|\$\{?FULLPASSWORD_ROOT\}?\/\.env)/;

function forbiddenWrite(line) {
  return (mutatingCommand.test(line) && fullPasswordTarget.test(line))
    || redirectToFullPassword.test(line)
    || inPlaceEdit.test(line)
    || forbiddenEnvRead.test(line)
    || envInputRedirect.test(line);
}

for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (rel === self) continue;
  const lines = readFileSync(file, 'utf8').replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (forbiddenWrite(line)) {
      failures.push(`${rel}:${index + 1}: possível escrita no Full Password: ${line.trim()}`);
    }
  });
}

for (const malicious of [
  'cp candidate /opt/fullpassword/override.yml',
  'rm -f "$FULLPASSWORD_COMPOSE_FILE"',
  'chmod 0644 ${FULLPASSWORD_ROOT}/docker-compose.yml',
  'printf value > /opt/fullpassword/new-file',
  'sed -i s/a/b/ /opt/fullpassword/docker-compose.yml',
  'cat /opt/fullpassword/.env',
  'source "$FULLPASSWORD_ROOT/.env"',
  'grep TOKEN /opt/fullpassword/.env',
  'read value < /opt/fullpassword/.env',
]) {
  if (!forbiddenWrite(malicious)) failures.push(`a auditoria não detectou a escrita simulada: ${malicious}`);
}

const adapter = readFileSync(join(root, 'scripts/lib/fullpassword-proxy.sh'), 'utf8');
const installer = readFileSync(join(root, 'scripts/install.sh'), 'utf8');
for (const required of [
  'FULLPASSWORD_COMPOSE_FILE="$FULLPASSWORD_ROOT/docker-compose.yml"',
  'FULLPASSWORD_OVERRIDE_FILE="$DEVFLOW_PROXY_ROOT/fullpassword-nginx.override.yml"',
  'DEVFLOW_PROXY_STATE="$DEVFLOW_STATE_ROOT/proxy-adapter.json"',
]) {
  if (!adapter.includes(required)) failures.push(`contrato obrigatório ausente: ${required}`);
}
const dryRunExit = installer.indexOf('if [[ "$MODE" == dry-run ]]');
const installationRootGate = installer.indexOf('\nrequire_root\n', dryRunExit);
if (dryRunExit < 0 || installationRootGate < 0 || dryRunExit > installationRootGate) {
  failures.push('o dry-run não termina antes da fase privilegiada de instalação');
}

if (failures.length) {
  console.error('Auditoria read-only do Full Password falhou:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Auditoria read-only aprovada: ${files.length} scripts inspecionados; /opt/fullpassword é somente leitura.`);
