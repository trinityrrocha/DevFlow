import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const publish = read('scripts/publish.sh');
const provider = read('scripts/providers/host-nginx.sh');
const health = read('scripts/health.sh');
const update = read('scripts/update.sh');
const updateOperation = read('scripts/update-operation.sh');
const common = read('scripts/lib/common.sh');
const stateValidator = read('scripts/validate-installation-state.py');
const template = read('docker/nginx/host-shared.conf.template');

const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Final shared-mode validation failed: ${label}`);
  checks.push(label);
};

for (const mode of ['--check', '--dry-run', '--publish', '--rollback']) {
  check(`publish mode ${mode}`, publish.includes(mode));
}
check('safe publish default', publish.includes('MODE=check'));
check('persistent publication transaction', publish.includes('publication-transaction.json')
  && publish.includes('publication-backups/transaction.'));
check('publication rollback scope', ['provider_uninstall', 'certbot delete', 'devflow.env', 'installation.json',
  'infrastructure-provider.json', 'nginx -t', 'systemctl reload nginx'].every((value) => publish.includes(value)));
check('partial failure rollback', publish.includes('trap publication_failed ERR')
  && publish.includes('restore_publication'));
check('certificate reuse', publish.includes('CERTIFICATE_CREATED=false')
  && publish.includes('fullchain.pem'));
check('certificate renewal proof', provider.includes('certbot renew --cert-name')
  && provider.includes('certbot.timer') && provider.includes('/etc/letsencrypt/renewal/$domain.conf'));
check('sites and conf.d', provider.includes('/etc/nginx/sites-available/devflow.conf')
  && provider.includes('/etc/nginx/sites-enabled/devflow.conf')
  && provider.includes('/etc/nginx/conf.d/devflow.conf'));
check('atomic nginx reload rollback', provider.includes('nginx -t')
  && provider.includes('systemctl reload nginx') && provider.includes('had_available'));
check('vhost websocket', template.includes('proxy_set_header Upgrade $http_upgrade')
  && template.includes('proxy_set_header Connection "upgrade"'));
check('vhost security headers', ['Content-Security-Policy', 'Strict-Transport-Security',
  'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy'].every((value) => template.includes(value)));
check('vhost transfer policy', ['proxy_request_buffering off', 'proxy_buffering off',
  'proxy_send_timeout 1800s', 'proxy_read_timeout 1800s', 'client_max_body_size 201m'].every((value) => template.includes(value)));
check('vhost rate and gzip', template.includes('limit_req zone=devflow_api') && template.includes('gzip on'));

const exactKeys = ['schemaVersion', 'installationScope', 'provider', 'proxyMode', 'installedVersion',
  'installedCommit', 'installedRef', 'repository', 'applicationInstalled', 'applicationHealthy',
  'externalPublicationEnabled', 'proxyMigrationExecuted', 'certificateIssued', 'domain', 'frontendUrl',
  'backendUrl', 'migration'];
check('installation schema v2', stateValidator.includes('document["schemaVersion"] != 2'));
check('installation exact key set', exactKeys.every((key) => stateValidator.includes(`"${key}"`))
  && stateValidator.includes('unknown = keys - REQUIRED_KEYS'));
for (const legacy of ['timestamp', 'updateChannel', 'result', 'proxyMigrationRequired', 'fullpasswordModified',
  'publicProxyModified', 'sharedProxyAdapter']) {
  check(`installation excludes ${legacy}`, !stateValidator.includes(`"${legacy}"`));
}
check('identity always derived from source', common.includes('resolve_installed_release_identity')
  && common.includes('$DEVFLOW_INSTALL_ROOT/source'));

for (const key of ['provider_ready', 'proxy_ready', 'publication_ready', 'certificate_ready',
  'renewal_ready', 'rollback_ready', 'release_identity_valid', 'installation_state_valid',
  'proxy_mode_valid', 'host_nginx_valid', 'shared_adapter_valid', 'overall_health']) {
  check(`health output ${key}`, health.includes(`${key}=`));
}
check('published health contract', health.includes('external_https_status=healthy')
  && health.includes('certificate_status=valid') && health.includes('renewal_status=healthy'));

for (const operation of ['check-update', 'download-update', 'validate-update', 'install-update', 'rollback-update']) {
  check(`update operation ${operation}`, updateOperation.includes(operation));
}
check('update logic reused', updateOperation.includes('exec "$SCRIPT_DIR/update.sh"'));
check('manual update rollback', update.includes('--rollback') && update.includes('rollback_update')
  && update.includes('previousReleaseDirectory') && update.includes('backupFile'));
check('update remains transactional', update.includes('trap update_failed EXIT')
  && update.includes('write_update_transaction completed'));
check('Full Password not mutated by publication', !publish.includes('/opt/fullpassword')
  && !publish.includes('fullpassword_nginx'));

console.log(`Final shared-mode validation passed: ${checks.length} non-mutating checks.`);
