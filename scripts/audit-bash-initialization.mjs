import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = [
  'scripts/detect-shared-proxy.sh',
  'scripts/install.sh',
  'scripts/bootstrap.sh',
  'scripts/lib/fullpassword-proxy.sh',
  'scripts/update.sh',
  'scripts/uninstall.sh',
  'scripts/health.sh',
  'scripts/diagnose.sh',
  'scripts/repair-installation-state.sh',
  'scripts/reconcile-installed-release.sh',
  'scripts/migrate-proxy-to-host-nginx.sh',
  'scripts/providers/provider-contract.sh',
  'scripts/providers/host-nginx.sh',
  'scripts/providers/isolated-nginx.sh',
  'scripts/providers/legacy-docker-nginx.sh',
];
const criticalDiscoveryVariables = [
  'FULLPASSWORD_COMPOSE_FILE',
  'FULLPASSWORD_COMPOSE_DIR',
  'FULLPASSWORD_PROJECT',
  'FULLPASSWORD_SERVICE',
  'FULLPASSWORD_ENV_FILE',
];
const failures = [];
const dependencies = {
  'scripts/detect-shared-proxy.sh': ['scripts/lib/common.sh'],
  'scripts/install.sh': ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/lib/fullpassword-proxy.sh', 'scripts/lib/compose-images.sh', 'scripts/lib/install-transaction.sh', 'scripts/lib/install-startup.sh', 'scripts/providers/provider-contract.sh', 'scripts/providers/host-nginx.sh'],
  'scripts/bootstrap.sh': [],
  'scripts/lib/common.sh': ['scripts/lib/version.sh'],
  'scripts/lib/version.sh': [],
  'scripts/lib/port-ownership.sh': ['scripts/lib/common.sh'],
  'scripts/lib/proxy-config.sh': ['scripts/lib/common.sh'],
  'scripts/lib/compose-images.sh': ['scripts/lib/common.sh'],
  'scripts/lib/install-transaction.sh': ['scripts/lib/common.sh'],
  'scripts/lib/install-startup.sh': ['scripts/install.sh', 'scripts/lib/common.sh', 'scripts/lib/install-transaction.sh'],
  'scripts/lib/fullpassword-proxy.sh': ['scripts/lib/common.sh'],
  'scripts/update.sh': ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/lib/fullpassword-proxy.sh', 'scripts/lib/compose-images.sh', 'scripts/providers/provider-contract.sh', 'scripts/providers/host-nginx.sh'],
  'scripts/uninstall.sh': ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/lib/fullpassword-proxy.sh', 'scripts/providers/provider-contract.sh', 'scripts/providers/host-nginx.sh'],
  'scripts/health.sh': ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/lib/fullpassword-proxy.sh', 'scripts/lib/compose-images.sh', 'scripts/providers/provider-contract.sh', 'scripts/providers/host-nginx.sh'],
  'scripts/diagnose.sh': ['scripts/lib/common.sh', 'scripts/lib/fullpassword-proxy.sh'],
  'scripts/repair-installation-state.sh': ['scripts/lib/common.sh', 'scripts/lib/compose-images.sh', 'scripts/providers/provider-contract.sh'],
  'scripts/reconcile-installed-release.sh': ['scripts/lib/common.sh', 'scripts/lib/compose-images.sh', 'scripts/providers/provider-contract.sh'],
  'scripts/migrate-proxy-to-host-nginx.sh': ['scripts/lib/common.sh'],
  'scripts/providers/provider-contract.sh': ['scripts/lib/common.sh'],
  'scripts/providers/host-nginx.sh': ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh'],
  'scripts/providers/isolated-nginx.sh': ['scripts/lib/common.sh'],
  'scripts/providers/legacy-docker-nginx.sh': ['scripts/lib/common.sh', 'scripts/lib/fullpassword-proxy.sh'],
};
const externalContract = new Set([
  'BASH_SOURCE', 'BASH_LINENO', 'BASH_REMATCH', 'BASHPID', 'EUID', 'FUNCNAME', 'HOME', 'ID', 'LINENO', 'PATH', 'PRETTY_NAME',
  'PWD', 'RANDOM', 'TMPDIR', 'UBUNTU_CODENAME', 'UID', 'VERSION_CODENAME',
  'POSTGRES_DB', 'POSTGRES_USER', 'DEVFLOW_API_PORT', 'DEVFLOW_DOMAIN', 'DEVFLOW_EXPECTED_VERSION',
  'DEVFLOW_HEALTH_ALLOW_PENDING_VERSION', 'DEVFLOW_HTTP_PORT', 'DEVFLOW_PROXY_MODE',
  'DEVFLOW_SHARED_PROXY_ADAPTER', 'DEVFLOW_SOURCE_DIR', 'DEVFLOW_INFRASTRUCTURE_PROVIDER',
]);

function initializedBeforeFunctions(source, variable) {
  const prefix = source.split(/\n[a-zA-Z_][a-zA-Z0-9_]*\(\)\s*\{/u, 1)[0];
  const assignment = new RegExp(`^${variable}=`, 'mu');
  return assignment.test(prefix);
}

function missingCriticalVariables(source) {
  return criticalDiscoveryVariables.filter((variable) => {
    const referenced = new RegExp(`\\$\\{?${variable}(?:[^A-Z0-9_]|$)`, 'u').test(source);
    return referenced && !initializedBeforeFunctions(source, variable);
  });
}

function stripSingleQuoted(source) {
  let quoted = false;
  let result = '';
  for (const character of source) {
    if (character === "'") {
      quoted = !quoted;
      result += ' ';
    } else {
      result += quoted && character !== '\n' ? ' ' : character;
    }
  }
  return result;
}

function assignedVariables(source) {
  const assigned = new Set();
  const cleaned = stripSingleQuoted(source);
  for (const match of cleaned.matchAll(/^\s*(?:export\s+|readonly\s+)?([A-Z][A-Z0-9_]*)=/gmu)) assigned.add(match[1]);
  for (const line of cleaned.split('\n')) {
    const declaration = line.match(/^\s*(?:local|declare)(?:\s+-[a-zA-Z]+)*\s+(.+)$/u);
    if (declaration) {
      for (const match of declaration[1].matchAll(/(?:^|\s)([A-Z][A-Z0-9_]*)(?==|\s|$)/gu)) assigned.add(match[1]);
    }
    const loop = line.match(/^\s*for\s+([A-Z][A-Z0-9_]*)\s+in\b/u);
    if (loop) assigned.add(loop[1]);
    const read = line.match(/\bread(?:\s+-[a-zA-Z]+)*\s+([A-Z][A-Z0-9_]*)/u);
    if (read) assigned.add(read[1]);
    const printf = line.match(/\bprintf\s+-v\s+([A-Z][A-Z0-9_]*)\b/u);
    if (printf) assigned.add(printf[1]);
  }
  return assigned;
}

function unguardedReferences(source) {
  const references = new Set();
  const cleaned = stripSingleQuoted(source);
  const pattern = /\$\{([A-Z][A-Z0-9_]*)(?![A-Za-z0-9_])([^}]*)\}|\$([A-Z][A-Z0-9_]*)(?![A-Za-z0-9_])/gu;
  for (const match of cleaned.matchAll(pattern)) {
    const variable = match[1] || match[3];
    const suffix = match[2] || '';
    if (/^:?[-+?=]/u.test(suffix)) continue;
    references.add(variable);
  }
  return references;
}

for (const path of targets) {
  const source = readFileSync(resolve(root, path), 'utf8');
  const sourcedLibrary = path.startsWith('scripts/lib/') || path.startsWith('scripts/providers/');
  if (!sourcedLibrary && !/^set -[^\n]*u[^\n]*pipefail/mu.test(source)) {
    failures.push(`${path}: modo estrito com set -u e pipefail ausente`);
  }
  if (/\bset \+u\b/u.test(source)) failures.push(`${path}: desativação de set -u encontrada`);
  if (/unbound variable/u.test(source)) failures.push(`${path}: mensagem interna de unbound variable incorporada ao script`);

  const dependencySource = (dependencies[path] || [])
    .map((dependency) => readFileSync(resolve(root, dependency), 'utf8'))
    .join('\n');
  const assigned = assignedVariables(`${dependencySource}\n${source}`);
  for (const variable of unguardedReferences(source)) {
    if (!assigned.has(variable) && !externalContract.has(variable)) {
      failures.push(`${path}: referência não protegida sem atribuição ou contrato: ${variable}`);
    }
  }
}

const diagnostic = readFileSync(resolve(root, 'scripts/detect-shared-proxy.sh'), 'utf8');
for (const variable of missingCriticalVariables(diagnostic)) {
  failures.push(`scripts/detect-shared-proxy.sh: ${variable} é referenciada sem inicialização global defensiva`);
}
for (const fragment of [
  'discover_fullpassword_compose()',
  'validate_fullpassword_compose_path()',
  'discover_protected_compose_inputs()',
  'validate_compose_merge()',
  'handle_internal_error()',
  'internal_script_error=$INTERNAL_SCRIPT_ERROR',
]) {
  if (!diagnostic.includes(fragment)) failures.push(`contrato defensivo ausente: ${fragment}`);
}

const unsafeFixture = 'set -Eeuo pipefail\ncheck() { printf "%s" "$FULLPASSWORD_COMPOSE_FILE"; }\n';
if (!missingCriticalVariables(unsafeFixture).includes('FULLPASSWORD_COMPOSE_FILE')) {
  failures.push('autoteste: a auditoria não detectou variável crítica sem inicialização');
}
const safeFixture = 'set -Eeuo pipefail\nFULLPASSWORD_COMPOSE_FILE=\ncheck() { printf "%s" "$FULLPASSWORD_COMPOSE_FILE"; }\n';
if (missingCriticalVariables(safeFixture).includes('FULLPASSWORD_COMPOSE_FILE')) {
  failures.push('autoteste: a auditoria rejeitou variável crítica inicializada');
}

const bashCandidates = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'] : ['bash'];
const bash = bashCandidates.find(existsSync) || bashCandidates[0];
for (const path of targets) {
  const result = spawnSync(bash, ['-n', resolve(root, path)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path}: sintaxe Bash inválida: ${result.stderr.trim()}`);
}

const sourceSafetyTargets = [
  ['scripts/lib/common.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/port-ownership.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/compose-images.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/install-transaction.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/install-transaction.sh', 'scripts/lib/install-startup.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/lib/fullpassword-proxy.sh'],
  ['scripts/lib/common.sh', 'scripts/providers/provider-contract.sh'],
  ['scripts/lib/common.sh', 'scripts/lib/proxy-config.sh', 'scripts/providers/host-nginx.sh'],
];
for (const libraries of sourceSafetyTargets) {
  const command = `${libraries.map((path) => `source "${resolve(root, path).replaceAll('\\', '/')}"`).join('\n')}\nprintf sourced`;
  const result = spawnSync(bash, ['-c', `set -Eeuo pipefail\n${command}`], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout !== 'sourced') {
    failures.push(`${libraries.at(-1)}: source sob modo estrito não concluiu com status zero: ${result.stderr.trim()}`);
  }
}

if (failures.length) {
  throw new Error(`Bash initialization audit failed:\n- ${failures.join('\n- ')}`);
}
console.log('Bash initialization audit passed: entrypoints and inherited-strictness provider libraries inspected.');
