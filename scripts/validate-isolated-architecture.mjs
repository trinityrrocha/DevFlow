import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const install = read('scripts/install.sh');
const common = read('scripts/lib/common.sh');
const transaction = read('scripts/lib/install-transaction.sh');
const composeText = read('docker-compose.yml');
const compose = YAML.parse(composeText);
const nginx = read('docker/nginx.runtime.conf.template');
const update = read('scripts/update.sh');
const daemon = read('scripts/updater-daemon.sh');
const requestValidator = read('scripts/validate-updater-request.mjs');
const renewal = read('scripts/renew-certificate.sh');
const health = read('scripts/health.sh');
const uninstall = read('scripts/uninstall.sh');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Full Password alignment test failed: ${label}`);
  checks.push(label);
};

const sources = [];
const walk = (directory) => {
  for (const entry of readdirSync(resolve(root, directory))) {
    const absolute = resolve(root, directory, entry);
    if (statSync(absolute).isDirectory()) walk(relative(root, absolute));
    else sources.push([relative(root, absolute).replaceAll('\\', '/'), readFileSync(absolute, 'utf8')]);
  }
};
walk('scripts'); walk('docker');

check('01 standalone Certbot replaces temporary ACME Nginx', install.includes('certbot certonly --standalone')
  && !existsSync(resolve(root, 'docker/nginx/isolated-http.conf.template')));
check('02 multiple independent public IPv4 sources', install.includes('api.ipify.org')
  && install.includes('ifconfig.me/ip') && install.includes('Fontes de IPv4 publico divergiram'));
check('03 every A record is collected', install.includes('dig +short A') && install.includes('getent ahostsv4'));
check('04 DNS must contain the public IPv4', install.includes('dns_match=')
  && install.includes('DNS ainda nao aponta para esta VPS'));
check('05 firewall confirmation is numeric and explicit', install.includes('prompt_numeric_confirmation external-firewall')
  && install.includes('--firewall-confirmed'));
check('06 unknown owners on ports 80 or 443 fail closed', install.includes('servico desconhecido')
  && install.includes('inspect_ports'));
check('07 partial DevFlow edge is stopped without compose down', install.includes('stop edge')
  && !install.match(/stop_partial_devflow_runtime\(\)[\s\S]*?\n\}/u)?.[0].includes(' down '));
check('08 certificate symlinks resolve inside letsencrypt', common.includes('readlink -f "$fullchain"')
  && common.includes('"$certificate_root/"*'));
check('09 certificate is nonexpired and matches domain', common.includes('-checkend 0')
  && common.includes('-checkhost "$domain"'));
check('10 certificate private key matches public key', common.includes('CERTIFICATE_KEY_MATCH')
  && common.includes('openssl pkey -in "$resolved_key"'));
check('11 runtime Nginx is rendered only after certificate validation', common.includes('render_runtime_nginx_config')
  && common.indexOf('validate_devflow_certificate "$DEVFLOW_DOMAIN"') < common.indexOf('sed "s/__DEVFLOW_DOMAIN__'));
check('12 Compose mounts generated runtime config read only', compose.services.edge.volumes.some((v) => String(v).includes('nginx.runtime.conf') && String(v).endsWith(':ro')));
check('13 Compose mounts host letsencrypt read only', compose.services.edge.volumes.includes('/etc/letsencrypt:/etc/letsencrypt:ro'));
check('14 only Nginx publishes host ports', Object.entries(compose.services).filter(([, service]) => service.ports).map(([name]) => name).join(',') === 'edge');
check('15 PostgreSQL has no host port and uses named storage', !compose.services.db.ports
  && compose.services.db.volumes.includes('devflow_postgres_data:/var/lib/postgresql/data'));
check('16 required isolated services are present', ['db', 'backend', 'frontend', 'edge', 'updater'].every((name) => compose.services[name]));
check('17 ordered startup gates database migrations and application', install.indexOf('CURRENT_INSTALL_STAGE=10-database')
  < install.indexOf('CURRENT_INSTALL_STAGE=11-migrations')
  && install.indexOf('CURRENT_INSTALL_STAGE=11-migrations') < install.indexOf('CURRENT_INSTALL_STAGE=12-backend')
  && install.indexOf('CURRENT_INSTALL_STAGE=13-frontend') < install.indexOf('CURRENT_INSTALL_STAGE=14-nginx-https'));
check('18 HTTPS verification uses curl resolve without insecure TLS', install.includes('curl --resolve "$DEVFLOW_DOMAIN:443:127.0.0.1"')
  && !install.match(/curl[^\n]*\s-k(?:\s|$)/u));
check('19 resume recalculates material state', install.includes('recalculate_resume_stage')
  && ['validate_devflow_certificate', 'service_healthy db', 'schema_migrations', 'bootstrap/status'].every((token) => install.includes(token)));
check('20 failed installation preserves containers', transaction.includes('"containersPreserved": true')
  && install.includes('Containers existentes foram preservados'));
check('21 admin uses one authority and protected temporary password', install.includes('ADMIN_EMAIL=$ADMIN_EMAIL_INPUT')
  && install.includes('SUPER_ADMIN_EMAIL=$ADMIN_EMAIL_INPUT') && install.includes('LETSENCRYPT_EMAIL=$ADMIN_EMAIL_INPUT')
  && install.includes('super-admin-temporary-password') && install.includes("== '0:0 600'"));
check('22 renewal runs host Certbot and reloads only DevFlow Nginx', renewal.includes('renew --cert-name "$DEVFLOW_DOMAIN"')
  && renewal.includes('docker exec devflow-nginx nginx -s reload'));
check('23 renewal dry-run is explicit and never automatic', renewal.includes('--dry-run')
  && !read('scripts/systemd/devflow-certificate-renewal.service').includes('--dry-run'));
check('24 backend writes only signed allowlisted update requests', requestValidator.includes("operation !== 'install-update'")
  && read('backend/src/services/updateOperationService.js').includes("createHmac('sha256'"));
check('25 updater queue rejects shell input and validates HMAC', requestValidator.includes('timingSafeEqual')
  && !daemon.includes('eval ') && !daemon.includes('bash -c'));
check('26 updater delegates only to update.sh', daemon.includes('scripts/update.sh')
  && !daemon.includes('install.sh'));
check('27 update remains transactional with backup health and rollback', ['backup.sh', 'verify-backup.sh', 'rollback_update', 'health.sh'].every((token) => update.includes(token)));
check('28 updater is not recreated during its own request', update.includes('up_runtime_services --force-recreate --remove-orphans')
  && update.includes('local services=(db backend frontend)')
  && update.includes('services=(db backend worker frontend)')
  && !update.match(/up[^\n]*updater[^\n]*force-recreate/u));
check('29 uninstall is scoped and never prunes globally', !uninstall.includes('system prune')
  && uninstall.includes('certbot delete --non-interactive --cert-name "$DEVFLOW_DOMAIN"'));
check('30 no Full Password runtime coupling remains', sources.every(([path, source]) => path === 'scripts/validate-isolated-architecture.mjs'
  || !/\/opt\/fullpassword|fullpassword_nginx|docker-compose\.shared|docker-compose\.fullpassword/iu.test(source))
  && nginx.includes('proxy_pass http://backend:3000'));

if (checks.length !== 30) throw new Error(`Expected 30 checks, got ${checks.length}`);
console.log(`Full Password alignment tests passed: ${checks.length} mandatory scenarios.`);
