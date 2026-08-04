import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const install = read('scripts/install.sh');
const bootstrap = read('scripts/bootstrap.sh');
const publish = read('scripts/publish.sh');
const health = read('scripts/health.sh');
const common = read('scripts/lib/common.sh');
const portOwnership = resolve(root, 'scripts/lib/port-ownership.sh');
const compose = read('docker-compose.yml');
const sharedCompose = read('docker-compose.shared.yml');
const vpsDocumentation = read('docs/infrastructure/vps-installation.md');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const checks = [];
const bashPath = (path) => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;

const check = (label, condition) => {
  if (!condition) throw new Error(`Installation scope test failed: ${label}`);
  checks.push(label);
};

const portScenario = (functions) => spawnSync(bash, ['-c', `
    validate_port() { [[ "$1" =~ ^[0-9]+$ ]]; }
    source "$1"
    ${functions}
    devflow_detect_public_port_ownership
    printf 'status=%s\\ncontainer=%s\\nready=%s\\ninternal=%s\\nmigration=%s\\n' \
      "$DEVFLOW_PUBLIC_PROXY_STATUS" "$DEVFLOW_PUBLIC_PROXY_CONTAINER" \
      "$DEVFLOW_EXTERNAL_PUBLICATION_READY" "$DEVFLOW_INTERNAL_INSTALLATION_READY" \
      "$DEVFLOW_PROXY_MIGRATION_REQUIRED"
    devflow_print_port_evidence 80
  `, '_', bashPath(portOwnership)], { encoding: 'utf8' });

const free = portScenario(`
  ss() { return 0; }
  docker() { [[ "$1" == version ]] && return 0; [[ "$1" == ps ]] && return 0; return 1; }
`);
const fullpassword = portScenario(`
  ss() { printf '%s\\n' 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*' 'LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*'; }
  docker() {
    case "$1" in
      version) return 0 ;;
      ps) printf '%s\\n' abc123 ;;
      port)
        printf '%s\\n' '8080/tcp -> 0.0.0.0:80' '8080/tcp -> [::]:80' \
          '8443/tcp -> 0.0.0.0:443' '8443/tcp -> [::]:443'
        ;;
      inspect)
        [[ "$3" == *NetworkSettings.Ports* ]] && printf '{"8080/tcp":[{"HostPort":"80"}],"8443/tcp":[{"HostPort":"443"}]}\\n' \
          || printf '/fullpassword_nginx\\n'
        ;;
      *) return 1 ;;
    esac
  }
`);
const unknown = portScenario(`
  ss() { printf '%s\\n' 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*' 'LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*'; }
  docker() { [[ "$1" == version ]] && return 0; [[ "$1" == ps ]] && return 0; return 1; }
`);

check('public ports free', free.status === 0 && free.stdout.includes('status=free') && free.stdout.includes('ready=true'));
check('ports occupied by fullpassword_nginx', fullpassword.status === 0 && fullpassword.stdout.includes('status=occupied-by-known-docker-proxy') && fullpassword.stdout.includes('container=fullpassword_nginx'));
check('Docker owner proven', fullpassword.stdout.includes('docker_mapping_detected=true') && fullpassword.stdout.includes('container_port=8080')
  && fullpassword.stdout.includes('owner_classification=docker-container') && fullpassword.stdout.includes('owner_proven=true'));
check('unknown owner remains fail-closed', unknown.status === 0 && unknown.stdout.includes('status=owner-unproven') && unknown.stdout.includes('ready=false'));
check('internal installation is explicit', install.includes('--install-internal') && install.includes('set_install_scope internal')
  && fullpassword.stdout.includes('internal=true'));
check('external publication is independently blocked', publish.includes('provider_status') && publish.includes('publicação bloqueada')
  && install.includes('instalação interna pronta, publicação externa bloqueada') && install.includes('exit 0'));
check('loopback ports are configured', sharedCompose.includes('127.0.0.1') && sharedCompose.includes('DEVFLOW_HTTP_PORT:-18080') && sharedCompose.includes('DEVFLOW_API_PORT:-13000'));
check('occupied frontend port is rejected', install.includes('FRONTEND_LOOPBACK_PORT_AVAILABLE=false'));
check('occupied backend port is rejected', install.includes('BACKEND_LOOPBACK_PORT_AVAILABLE=false'));
const dbSection = compose.match(/\n  db:\n([\s\S]*?)(?=\n  backend:)/)?.[1] || '';
check('PostgreSQL has no host publication', dbSection.includes('expose:') && !dbSection.includes('ports:') && install.includes('postgres_public_port_exposed=true'));
check('Full Password remains untouched internally', install.includes('DEVFLOW_FULLPASSWORD_MODIFIED=false') && install.includes('não alterar Nginx, 80/443, certificados, Full Password'));
check('internal state is recorded', common.includes('"installationScope"') && common.includes('"externalPublicationEnabled"') && common.includes('"applicationHealthy"'));
check('internal health ignores Full Password HTTPS', health.includes('EXTERNAL_PUBLICATION_ENABLED=false')
  && health.includes('EXTERNAL_PUBLICATION_TRANSACTION_VALID=false')
  && health.includes('external_https_status=not-configured')
  && health.includes('overall_internal_health=healthy'));
check('later publication does not migrate', publish.includes('nunca executam migrations') && !publish.includes('scripts/migrate.js'));
check('internal rollback is DevFlow-scoped', install.includes('compose_files') && install.includes('down --remove-orphans') && install.includes('if [[ "$PROVIDER_APPLIED" == true ]]'));
check('repeated installation is blocked', install.includes('Uma instalação já existe') && install.includes('use scripts/update.sh'));
check('interrupted installation has signal rollback traps', install.includes('trap installation_failed ERR')
  && install.includes("trap 'installation_failed 130' INT") && install.includes("trap 'installation_failed 143' TERM")
  && install.includes('app.candidate'));
check('ARM64 is supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
check('SSH tunnel is documented', vpsDocumentation.includes('-L 18080:127.0.0.1:18080') && vpsDocumentation.includes('-L 13000:127.0.0.1:13000'));
check('complete install prompts instead of auto-selecting', install.includes('Escolha [1/2/3]:') && install.includes('1 - Instalar internamente') && bootstrap.includes('--install-scope'));

if (checks.length !== 20) throw new Error(`Expected 20 checks, got ${checks.length}`);
console.log(`Installation scope tests passed: ${checks.length} scenarios.`);
