import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const install = read('scripts/install.sh');
const common = read('scripts/lib/common.sh');
const images = read('scripts/lib/compose-images.sh');
const transaction = read('scripts/lib/install-transaction.sh');
const startup = read('scripts/lib/install-startup.sh');
const compose = read('docker-compose.yml');
const health = read('scripts/health.sh');
const bootstrap = read('scripts/bootstrap.sh');
const resolver = resolve(root, 'scripts/resolve-compose-image.py');
const bundledPython = resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe');
const python = process.env.DEVFLOW_TEST_PYTHON
  || (process.platform === 'win32' && existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const checks = [];

const check = (label, condition) => {
  if (!condition) throw new Error(`Compose image/resume test failed: ${label}`);
  checks.push(label);
};

const resolveJson = (document, service) => spawnSync(python, [resolver, service], {
  input: JSON.stringify(document), encoding: 'utf8',
});
const normalize = (reference) => spawnSync(bash, ['-c', 'DEVFLOW_SOURCE_ROOT=. source "$1"; normalize_image_reference "$2"', '_',
  resolve(root, 'scripts/lib/compose-images.sh'), reference], { encoding: 'utf8' });
const bashPath = (path) => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;
const resolveThroughCompose = () => spawnSync(bash, ['-c', `
  source "$1"
  DEVFLOW_IMAGE_PYTHON="$2"
  DEVFLOW_IMAGE_RESOLVER="$3"
  docker() {
    if [[ "$1" == compose ]]; then
      printf '%s\\n' '{"services":{"backend":{"image":"devflow-backend:latest"}}}'
    elif [[ "$1" == image && "$2" == inspect ]]; then
      return 0
    else
      return 2
    fi
  }
  DEVFLOW_COMPOSE=(docker compose -p devflow --project-directory /opt/devflow/source)
  resolve_compose_service_image backend
`, '_', bashPath(resolve(root, 'scripts/lib/compose-images.sh')), bashPath(python), bashPath(resolver)], { encoding: 'utf8' });
const exerciseTransaction = () => spawnSync(bash, ['-c', `
  source "$1"
  DEVFLOW_STATE_ROOT="$(mktemp -d)"
  trap 'rm -rf -- "$DEVFLOW_STATE_ROOT"' EXIT
  if [[ "$(uname -s)" == MINGW* ]]; then
    install() { mkdir -p "\${@: -1}"; }
    chmod() { command chmod "$@" 2>/dev/null || true; }
  fi
  source "$2"
  install_transaction_begin 0.4.9-alpha 0123456789012345678901234567890123456789 internal true true 05-build-images
  install_transaction_complete_stage 01-preflight >/dev/null
  install_transaction_complete_stage 05-build-images >/dev/null
  install_transaction_fail 06-validate-images >/dev/null
  install_transaction_load
  [[ "$INSTALL_TRANSACTION_FAILED_STAGE" == 06-validate-images \
    && "$INSTALL_TRANSACTION_CAN_RESUME" == true \
    && "$INSTALL_TRANSACTION_LEGACY_PARTIAL" == true \
    && "$INSTALL_TRANSACTION_RECONSTRUCTED" == true \
    && "$INSTALL_TRANSACTION_RESUME_FROM_STAGE" == 05-build-images ]]
  [[ "$(uname -s)" == MINGW* || "$(stat -c '%a' "$DEVFLOW_INSTALL_TRANSACTION_FILE")" == 640 ]]
`, '_', bashPath(resolve(root, 'scripts/lib/common.sh')), bashPath(resolve(root, 'scripts/lib/install-transaction.sh'))], { encoding: 'utf8' });

const model = {
  services: {
    backend: { image: 'devflow-backend:latest' },
    frontend: { image: 'devflow-frontend:latest' },
    db: { image: 'postgres:16-alpine' },
  },
};

check('backend built as devflow-backend:latest', resolveJson(model, 'backend').stdout.trim() === 'devflow-backend:latest');
check('Docker Hub library normalization', normalize('devflow-backend:latest').stdout.trim() === 'docker.io/library/devflow-backend:latest');
check('frontend image is explicit', resolveJson(model, 'frontend').stdout.trim() === 'devflow-frontend:latest');
check('PostgreSQL image is resolved', resolveJson(model, 'db').stdout.trim() === 'postgres:16-alpine');
check('missing service is rejected', resolveJson(model, 'worker').status !== 0);
check('missing or implicit image is controlled', resolveJson({ services: { backend: { build: { context: '.' } } } }, 'backend').status !== 0
  && images.includes('docker image inspect "$resolved"') && images.includes('return 3'));
check('multiple images are rejected', resolveJson({ services: { backend: { image: ['one', 'two'] } } }, 'backend').status !== 0);
check('explicit registry remains distinct', normalize('registry.example.com/team/devflow-backend:latest').stdout.trim() === 'registry.example.com/team/devflow-backend:latest');
check('latest tag is accepted', normalize('devflow-backend:latest').status === 0);
check('version tag is accepted', normalize('devflow-backend:0.4.9-alpha').status === 0);
check('commit tag is accepted', normalize('devflow-backend:dab9444').status === 0);
check('execution directory is irrelevant', resolveThroughCompose().stdout.trim() === 'docker.io/library/devflow-backend:latest'
  && common.includes('--project-directory "$app_root"') && compose.startsWith('name: devflow'));
check('Compose project is explicit', compose.includes('name: devflow') && common.includes('DEVFLOW_PROJECT="devflow"'));
check('resume after build reuses proven labels', install.includes('compose_image_matches_release') && install.includes('BACKEND_BUILD_REQUIRED=false'));
check('resume after PostgreSQL pull reuses image', install.includes('POSTGRES_PULL_REQUIRED=false') && install.includes('docker image inspect "$POSTGRES_IMAGE_RESOLVED"'));
check('valid partial checkout supports fast-forward', install.includes('resume_checkout_valid=') && startup.includes('merge-base --is-ancestor "$source_commit" "$release_sha"'));
check('divergent partial checkout fails closed', install.includes('checkout não é limpo, canônico ou fast-forward compatível')
  && startup.includes('RESUME_CHECKOUT_VALID=false'));
const transactionResult = exerciseTransaction();
check(`transaction state is atomic${transactionResult.status === 0 ? '' : ` (${transactionResult.stderr.trim()})`}`,
  transactionResult.status === 0 && transaction.includes('install-transaction.json')
  && transaction.includes('mv -f -- "$temporary"') && transaction.includes('completedStages'));
check('rollback preserves valid images', !install.match(/docker image (rm|prune)/) && install.includes('install_transaction_fail'));
check('Full Password remains untouched', install.includes('DEVFLOW_FULLPASSWORD_MODIFIED=false') && !transaction.includes('fullpassword'));
check('resume remains internal-only', bootstrap.includes('--resume') && install.includes('set_install_scope internal') && install.includes('não alterar Nginx, 80/443'));
check('ARM64 remains supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
check('Docker Compose 5.3.1 is compatible', install.includes('version_at_least "$compose_version" 2.20'));
check('old image lookup cannot regress', !install.includes('images -q backend')
  && !install.includes('Não foi possível identificar a imagem do backend')
  && health.includes('backend_image_present')
  && ['source_ready=', 'configuration_ready=', 'images_ready=', 'database_container_ready=',
    'database_healthy=', 'migrations_ready=', 'backend_ready=', 'frontend_ready=',
    'super_admin_ready=', 'installation_state_ready='].every((field) => install.includes(field)));

if (checks.length !== 24) throw new Error(`Expected 24 checks, got ${checks.length}`);
console.log(`Compose image and resume tests passed: ${checks.length} scenarios.`);
