import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read('scripts/migrate-proxy-to-host-nginx.sh');
const vhost = read('docker/nginx/fullpassword-host.conf.template');
const override = read('docker/fullpassword/fullpassword-host-nginx.override.yml.template');
const validator = resolve(root, 'scripts/validate-proxy-migration-compose.py');
const bundledPython = resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe');
const python = process.env.DEVFLOW_TEST_PYTHON
  || (process.platform === 'win32' && existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-proxy-evidence-'));
const checks = [];

const check = (name, condition) => {
  if (!condition) throw new Error(`Proxy migration evidence test failed: ${name}`);
  checks.push(name);
};

const base = {
  name: 'fullpassword',
  services: {
    db: {
      image: 'postgres:15-alpine',
      restart: 'always',
      environment: { POSTGRES_PASSWORD: 'TEST-SECRET-MUST-NOT-LEAK' },
      networks: { fullpassword_network: null },
      volumes: [{ type: 'volume', source: 'pgdata', target: '/var/lib/postgresql/data' }]
    },
    backend: {
      image: 'fullpassword-backend', restart: 'always',
      environment: { JWT_SECRET: 'TEST-JWT-MUST-NOT-LEAK' },
      networks: { fullpassword_network: null }
    },
    nginx: {
      image: 'nginx:alpine', restart: 'always',
      ports: [
        { mode: 'ingress', target: 80, published: '80', protocol: 'tcp' },
        { mode: 'ingress', target: 443, published: '443', protocol: 'tcp' }
      ],
      volumes: [{ type: 'bind', source: '/etc/letsencrypt', target: '/etc/letsencrypt', read_only: true }],
      networks: { fullpassword_network: null }
    }
  },
  networks: { fullpassword_network: { name: 'fullpassword_fullpassword_network' } },
  volumes: { pgdata: { name: 'fullpassword_pgdata' } }
};
const validMerged = structuredClone(base);
validMerged.services.nginx.ports = [
  { mode: 'ingress', host_ip: '127.0.0.1', target: 80, published: '18081', protocol: 'tcp' }
];

const validate = (merged) => {
  const basePath = resolve(temporary, 'base.json');
  const mergedPath = resolve(temporary, 'merged.json');
  writeFileSync(basePath, JSON.stringify(base), { mode: 0o600 });
  writeFileSync(mergedPath, JSON.stringify(merged), { mode: 0o600 });
  return spawnSync(python, [validator, basePath, mergedPath], { encoding: 'utf8' });
};

try {
  const valid = validate(validMerged);
  check('real port mappings are displayed', migration.includes('current_port_mappings:') && migration.includes('docker port "$FULLPASSWORD_CONTAINER"'));
  check('free loopback port is proven', migration.includes('loopback_port_available=true') && migration.includes('loopback_socket_available=true'));
  check('occupied loopback port blocks readiness', migration.includes('add_blocker loopback-port-in-use'));
  check('original Compose is valid', valid.status === 0 && valid.stdout.includes('rollback_compose_valid=true'));
  check('override is valid', valid.stdout.includes('compose_merge_valid=true') && override.includes('!override') && override.includes('127.0.0.1:18081:80'));
  check('public ports are removed', valid.stdout.includes('public_ports_removed=true'));
  check('loopback mapping is added', valid.stdout.includes('loopback_port_added=true'));

  const unexpected = structuredClone(validMerged);
  unexpected.services.nginx.labels = { unexpected: 'change' };
  const unexpectedResult = validate(unexpected);
  check('unexpected changes fail closed', unexpectedResult.status !== 0 && unexpectedResult.stdout.includes('unexpected_changes=true'));
  check('planned Nginx configuration preserves routes', [
    'location /api/', 'location ^~ /api/system/backup/restore', 'client_max_body_size 201m',
    'proxy_read_timeout 1800s', 'X-Forwarded-Proto $scheme', 'X-Real-IP $remote_addr'
  ].every((value) => vhost.includes(value)));
  check('active host Nginx is inspected', migration.includes('systemctl is-active --quiet nginx'));
  check('inactive host Nginx is represented', migration.includes('installed-and-inactive'));
  check('listener conflict blocks readiness', migration.includes('add_blocker public-listener-conflict'));
  check('public health is functional', migration.includes('/api/health') && migration.includes('fullpassword_frontend_healthy=true'));
  check('rollback Compose restores public mappings', valid.stdout.includes('rollback_public_port_80_present=true') && valid.stdout.includes('rollback_public_port_443_present=true'));

  const stopIndex = migration.indexOf('systemctl stop nginx', migration.indexOf('rollback_transaction()'));
  const restoreIndex = migration.indexOf('up -d --no-deps --force-recreate nginx', stopIndex);
  const healthIndex = migration.indexOf('validate_public_runtime', restoreIndex);
  check('rollback ordering is explicit', stopIndex >= 0 && restoreIndex > stopIndex && healthIndex > restoreIndex);
  check('failure before port switch removes only prepared artifacts', migration.includes('elif [[ "$ARTIFACTS_APPLIED" == true ]]') && migration.includes('nenhuma porta ou container havia sido alterado'));
  check('failure after port switch invokes rollback', migration.indexOf('MIGRATION_STARTED=true') < migration.indexOf('perform_migration\n'));
  check('host Nginx start failure is trapped', migration.includes('systemctl enable --now nginx || return 1'));
  check('rollback verifies restored 80 and 443', migration.includes('original_public_mappings_present') && migration.includes('443/tcp'));
  check('sensitive values never enter validation or report output', !valid.stdout.includes('TEST-SECRET') && !valid.stdout.includes('TEST-JWT') && migration.includes('| redact_stream > "$temporary"') && !migration.includes('cat "$FULLPASSWORD_ROOT/.env"'));

  const evaluateIndex = migration.indexOf('evaluate_readiness');
  const readyIndex = migration.indexOf('migration_ready=true', evaluateIndex);
  check('readiness is emitted only after gates', evaluateIndex >= 0 && readyIndex > evaluateIndex && migration.includes('[[ "${#BLOCKERS[@]}" -eq 0 ]]'));

  if (checks.length !== 21) throw new Error(`Expected 21 checks, got ${checks.length}`);
  process.stdout.write(`Evidencias de migracao validadas em ${checks.length} cenarios.\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
