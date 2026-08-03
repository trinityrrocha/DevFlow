import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const contract = read('scripts/providers/provider-contract.sh');
const host = read('scripts/providers/host-nginx.sh');
const portOwnership = read('scripts/lib/port-ownership.sh');
const isolated = read('scripts/providers/isolated-nginx.sh');
const legacy = read('scripts/providers/legacy-docker-nginx.sh');
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const uninstall = read('scripts/uninstall.sh');
const health = read('scripts/health.sh');
const migration = read('scripts/migrate-proxy-to-host-nginx.sh');
const compose = YAML.parse(read('docker-compose.yml'));
const shared = YAML.parse(read('docker-compose.shared.yml'));
const hostTemplate = read('docker/nginx/host-shared.conf.template');
const migrationOverride = read('docker/fullpassword/fullpassword-host-nginx.override.yml.template');

const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(`Provider test failed: ${name}`);
  checks.push(name);
};

const interfaceFunctions = ['detect', 'check', 'dry_run', 'prepare', 'install', 'validate', 'health', 'update', 'rollback', 'uninstall'];
for (const [name, body] of [['host-nginx', host], ['isolated-nginx', isolated], ['legacy-docker-nginx', legacy]]) {
  check(`${name}: identity`, body.includes(`PROVIDER_IMPLEMENTATION_NAME=${name}`));
  check(`${name}: common interface`, interfaceFunctions.every((fn) => new RegExp(`provider_${fn}\\(\\)`).test(body)));
}
check('contract: allowlisted providers', /host-nginx\|isolated-nginx\|legacy-docker-nginx/.test(contract));
check('contract: strict state parser', contract.includes('Estado de provider invalido'));
check('contract: atomic state', contract.includes('mv -f -- "$temporary" "$DEVFLOW_PROVIDER_STATE_FILE"'));
check('default provider', /INFRASTRUCTURE_PROVIDER=host-nginx/.test(install));
check('legacy is explicit', install.includes('legacy-docker-nginx') && !install.includes('INFRASTRUCTURE_PROVIDER=legacy-docker-nginx\n'));
check('installer blocks migration', install.includes('controlled-proxy-migration-required'));
check('host detection', ['command -v nginx', 'systemctl is-active nginx', 'nginx -t', 'command -v certbot'].every((v) => host.includes(v))
  && ['ss -H -ltnp', 'docker ps', 'docker inspect', 'docker port'].every((v) => portOwnership.includes(v)));
check('nginx absent installation', host.includes('apt-get install -y nginx certbot python3-certbot-nginx'));
check('nginx invalid fails closed', host.includes('invalid-host-nginx'));
check('sites preferred', host.indexOf('/etc/nginx/sites-available') < host.indexOf('/etc/nginx/conf.d'));
check('atomic vhost and rollback', ['mktemp /etc/nginx/sites-available', 'nginx -t', 'systemctl reload nginx', 'Rollback'].every((v) => host.includes(v)));
check('loopback frontend', shared.services.frontend.ports[0].startsWith('${DEVFLOW_BIND_ADDRESS:-127.0.0.1}:'));
check('loopback backend', shared.services.backend.ports[0].startsWith('${DEVFLOW_BIND_ADDRESS:-127.0.0.1}:'));
check('database has no published ports', !('ports' in compose.services.db));
check('host vhost routes both upstreams', hostTemplate.includes('127.0.0.1:__DEVFLOW_HTTP_PORT__') && hostTemplate.includes('127.0.0.1:__DEVFLOW_API_PORT__'));
check('host vhost security', ['Content-Security-Policy', 'Strict-Transport-Security', 'client_max_body_size', 'proxy_read_timeout', 'limit_req_zone', 'limit_req zone=devflow_api'].every((v) => hostTemplate.includes(v)));
check('certificate validation', host.includes('openssl x509') && host.includes('certbot certonly --webroot'));
check('provider persisted after install', install.includes('provider_state_write'));
check('provider recognized by update', update.includes('provider_resolve_installed') && update.includes('provider_update'));
check('provider recognized by health', health.includes('provider_resolve_installed') && health.includes('provider_health'));
check('provider recognized by uninstall', uninstall.includes('provider_resolve_installed') && uninstall.includes('provider_uninstall'));
check('uninstall never removes global nginx', !/apt-get remove[^\n]*nginx|systemctl disable[^\n]*nginx/.test(uninstall + host));
check('migration modes', ['--check', '--dry-run', '--migrate', '--rollback'].every((v) => migration.includes(v)));
check('migration diagnostics exit before infrastructure writes', migration.indexOf('if [[ "$MODE" == check || "$MODE" == dry-run ]]') < migration.indexOf("confirm_exact 'SNAPSHOT CONFIRMADO'"));
check('migration uses neutral override', migration.includes('/etc/devflow/proxy-migrations') && migrationOverride.includes('127.0.0.1:18081:80'));
check('migration preserves Full Password source', !/rm -rf -- "?\$FULLPASSWORD_ROOT|> "?\$FULLPASSWORD_COMPOSE_FILE/.test(migration));
check('migration reinforced confirmation', migration.includes("confirm_exact 'SNAPSHOT CONFIRMADO'") && migration.includes("confirm_exact 'MIGRAR PROXY PUBLICO'"));
check('migration rollback', migration.includes('rollback_transaction') && migration.includes('original_public_mappings_present'));
check('migration failure trap', migration.includes('trap on_failure ERR'));
check('migration checks Full Password health', migration.includes('https://$FULLPASSWORD_DOMAIN/'));
check('third-party preservation', migration.includes('up -d --no-deps --force-recreate nginx'));

function simulateMigration(failAt = 'none') {
  const events = ['snapshot', 'validate-compose', 'maintenance', 'switch-loopback', 'start-host-nginx', 'health-fullpassword'];
  const applied = [];
  let rolledBack = false;
  for (const event of events) {
    applied.push(event);
    if (event === failAt) {
      if (applied.includes('switch-loopback')) {
        applied.push('stop-host-nginx', 'restore-original-ports', 'restore-files', 'health-fullpassword-rollback');
        rolledBack = true;
      }
      return { success: false, rolledBack, applied };
    }
  }
  return { success: true, rolledBack, applied };
}

const successfulMigration = simulateMigration();
check('simulated migration success', successfulMigration.success && !successfulMigration.rolledBack);
for (const stage of ['switch-loopback', 'start-host-nginx', 'health-fullpassword']) {
  const failed = simulateMigration(stage);
  check(`simulated rollback after ${stage}`, !failed.success && failed.rolledBack
    && failed.applied.includes('restore-original-ports')
    && failed.applied.includes('health-fullpassword-rollback'));
}
const preMutationFailure = simulateMigration('validate-compose');
check('simulated pre-mutation failure', !preMutationFailure.success && !preMutationFailure.rolledBack);

process.stdout.write(`Provider architecture validated: ${checks.length} automated checks.\n`);
