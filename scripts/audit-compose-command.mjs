import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scriptsRoot = resolve(root, 'scripts');
const failures = [];
const shellFiles = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else if (path.endsWith('.sh')) shellFiles.push(path);
  }
};
visit(scriptsRoot);

const fullPasswordOnly = new Set([
  'scripts/detect-shared-proxy.sh',
  'scripts/migrate-proxy-to-host-nginx.sh',
  'scripts/lib/fullpassword-proxy.sh',
]);
const versionProbeAllowed = new Set([
  'scripts/install.sh',
  'scripts/update.sh',
  'scripts/diagnose.sh',
  'scripts/migrate-proxy-to-host-nginx.sh',
]);

for (const path of shellFiles) {
  const name = relative(root, path).replaceAll('\\', '/');
  const source = readFileSync(path, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (!/\bdocker\s+compose\b/u.test(line)) return;
    const centralBuilder = name === 'scripts/lib/common.sh'
      && line.includes('target=(docker compose --env-file "$env_file"');
    const fullPasswordOperation = fullPasswordOnly.has(name);
    const versionProbe = versionProbeAllowed.has(name) && /docker\s+compose\s+version\b/u.test(line);
    if (!centralBuilder && !fullPasswordOperation && !versionProbe) {
      failures.push(`${name}:${index + 1}: chamada Docker Compose direta fora do construtor central`);
    }
  });
  if (/\bDEVFLOW_COMPOSE=\(docker\s+compose\b/u.test(source) && name !== 'scripts/lib/common.sh') {
    failures.push(`${name}: constrói DEVFLOW_COMPOSE fora da biblioteca central`);
  }
  if (/\b(?:COMPOSE|DEVFLOW_MAINTENANCE_COMPOSE)=\(docker\s+compose\b/u.test(source)) {
    failures.push(`${name}: constrói array Compose paralelo`);
  }
}

const common = readFileSync(resolve(root, 'scripts/lib/common.sh'), 'utf8');
for (const fragment of [
  'build_devflow_compose_command()',
  'docker compose --env-file "$env_file"',
  '--project-directory "$app_root"',
  'devflow_inspect_private_env "$env_file"',
]) {
  if (!common.includes(fragment)) failures.push(`construtor central sem contrato: ${fragment}`);
}

for (const script of [
  'scripts/install.sh', 'scripts/update.sh', 'scripts/health.sh', 'scripts/backup.sh',
  'scripts/restore.sh', 'scripts/verify-backup.sh', 'scripts/uninstall.sh',
  'scripts/diagnose.sh', 'scripts/publish.sh',
]) {
  const source = readFileSync(resolve(root, script), 'utf8');
  if (!source.includes('compose_files') && !source.includes('build_devflow_compose_command')) {
    failures.push(`${script}: não usa o construtor Compose central`);
  }
}

if (failures.length) throw new Error(`Compose command audit failed:\n- ${failures.join('\n- ')}`);
console.log(`Compose command audit passed: ${shellFiles.length} shell scripts inspected.`);
