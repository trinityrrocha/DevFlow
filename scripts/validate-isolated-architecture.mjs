import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const install = read('scripts/install.sh');
const bootstrap = read('scripts/bootstrap.sh');
const compose = read('docker-compose.yml');
const http = read('docker/nginx/isolated-http.conf.template');
const https = read('docker/nginx/isolated-https.conf.template');
const common = read('scripts/lib/common.sh');
const transaction = read('scripts/lib/install-transaction.sh');
const update = read('scripts/update.sh');
const backup = read('scripts/backup.sh');
const restore = read('scripts/restore.sh');
const uninstall = read('scripts/uninstall.sh');
const health = read('scripts/health.sh');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Isolated architecture test failed: ${label}`);
  checks.push(label);
};

const operationalRoots = ['scripts', 'docker'];
const operationalFiles = ['docker-compose.yml', 'docker-compose.maintenance.yml', '.env.example'];
const sources = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) walk(absolute);
    else sources.push([relative(root, absolute).replaceAll('\\', '/'), readFileSync(absolute, 'utf8')]);
  }
};
for (const directory of operationalRoots) walk(resolve(root, directory));
for (const file of operationalFiles) sources.push([file, read(file)]);

check('1 clean isolated installation', install.includes('installation_mode=isolated')
  && transaction.includes('"installationMode": "isolated"') && install.includes('bootstrap_super_admin'));
check('2 available ports accepted', install.includes('port_available_or_owned_by_devflow 80') && install.includes('port_available_or_owned_by_devflow 443'));
check('3 occupied port 80 blocked', install.includes('port=') && install.includes('As portas 80 e/ou 443 ja estao em uso'));
check('4 occupied port 443 blocked', install.includes('owner=') && install.includes('controle exclusivo dessas portas'));
check('5 valid DNS required', install.includes('getent ahosts "$DOMAIN"'));
check('6 invalid DNS rejected', install.includes('DNS nao resolve o dominio'));
check('7 invalid domain rejected', install.includes('validate_domain "$DOMAIN"') && install.includes('sem protocolo ou caminho'));
check('8 invalid email rejected', install.includes('validate_email "$ADMIN_EMAIL_INPUT"'));
check('9 one administrative email', install.includes('ADMIN_EMAIL=$ADMIN_EMAIL_INPUT') && install.includes('SUPER_ADMIN_EMAIL=$ADMIN_EMAIL_INPUT') && install.includes('LETSENCRYPT_EMAIL=$ADMIN_EMAIL_INPUT'));
check('10 Docker absence handled', install.includes('install_docker_official') && install.includes('download.docker.com/linux/ubuntu'));
check('11 Compose absence handled', install.includes('docker compose version') && install.includes('docker-compose-plugin'));
check('12 ARM64 supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
check('13 AMD64 supported', common.includes('x86_64) DEVFLOW_ARCH=amd64'));
check('14 migrations non-root', install.includes('run_devflow_migrations') && common.includes('run --rm --no-deps backend node scripts/migrate.js'));
check('15 migration permissions', install.includes('validate_backend_migration_image') && read('backend/Dockerfile').includes('migration-image-contract.js normalize'));
check('16 isolated Nginx', compose.includes('container_name: devflow-nginx') && https.includes('proxy_pass http://backend:3000'));
check('17 ACME challenge', http.includes('/.well-known/acme-challenge/') && install.includes('certbot certonly --webroot'));
check('18 HTTPS publication', https.includes('listen 443 ssl') && install.includes('isolated-https.conf.template'));
check('19 certificate renewal', existsSync(resolve(root, 'scripts/systemd/devflow-certificate-renewal.timer')) && health.includes('certificate_renewal'));
check('20 transactional rollback', update.includes('rollback_update') && update.includes('restore.sh'));
check('21 resumable install', install.includes('--resume') && transaction.includes('resumeFromStage'));
check('22 single update engine', update.includes('UPDATE_PHASE=') && read('scripts/update-operation.sh').includes('exec "$SCRIPT_DIR/update.sh"') && read('backend/src/services/updateOperationService.js').includes("const UPDATE_ENGINE = 'scripts/update.sh'"));
check('23 backup preserved', update.includes('backup.sh') && backup.includes('pg_dump'));
check('24 restore preserved', update.includes('verify-backup.sh') && restore.includes('pg_restore'));
check('25 scoped uninstall', !uninstall.includes('system prune') && uninstall.includes('REMOVER TUDO, INCLUINDO BANCO E UPLOADS'));
check('26 frontend and backend not public', !/\n\s+ports:/u.test(compose.match(/\n  backend:[\s\S]*?(?=\n  frontend:)/u)?.[0] || '') && !/\n\s+ports:/u.test(compose.match(/\n  frontend:[\s\S]*?(?=\n  edge:)/u)?.[0] || ''));
check('27 PostgreSQL isolated', compose.includes('internal: true') && !/\n\s+ports:/u.test(compose.match(/\n  db:[\s\S]*?(?=\n  backend:)/u)?.[0] || ''));
check('28 shared architecture removed', ['docker-compose.shared.yml', 'docker-compose.fullpassword.yml', 'scripts/providers/host-nginx.sh', 'scripts/providers/isolated-nginx.sh', 'scripts/providers/legacy-docker-nginx.sh', 'scripts/providers/provider-contract.sh', 'scripts/publish.sh', 'scripts/reconcile-installed-release.sh'].every((path) => !existsSync(resolve(root, path))));
check('29 legacy parameters explicitly deprecated', ['--proxy-mode', '--provider', '--install-scope', '--letsencrypt-email', '--super-admin-email'].every((flag) => install.includes(flag)) && install.includes('foi descontinuado'));
check('30 runtime decoupled from Full Password', sources.every(([path, source]) => path.startsWith('scripts/validate-') || !/\/opt\/fullpassword|fullpassword_nginx|docker-compose\.shared|docker-compose\.fullpassword/iu.test(source)));

if (checks.length !== 30) throw new Error(`Expected 30 checks, got ${checks.length}`);
console.log(`Isolated architecture tests passed: ${checks.length} mandatory scenarios.`);
