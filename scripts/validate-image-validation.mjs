import {
  existsSync, mkdtempSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const bashPath = (value) => process.platform === 'win32'
  ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : value;
const commonPath = bashPath(resolve(root, 'scripts/lib/common.sh'));
const imagesPath = bashPath(resolve(root, 'scripts/lib/compose-images.sh'));
const transactionPath = bashPath(resolve(root, 'scripts/lib/install-transaction.sh'));
const common = read('scripts/lib/common.sh');
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const compose = read('docker-compose.yml');
const validationStart = common.indexOf('validate_backend_migration_image()');
const validationEnd = common.indexOf('\nrun_devflow_migrations()', validationStart);
const validationBody = common.slice(validationStart, validationEnd);
const checks = [];
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-image-validation-'));

const check = (label, condition) => {
  if (!condition) throw new Error(`Image validation test failed: ${label}`);
  checks.push(label);
};

const imageId = `sha256:${'a'.repeat(64)}`;
const migrationHash = 'b'.repeat(64);

const runProbe = (scenario, expectedMigration = '001_initial_schema.sql') => {
  const argumentsFile = resolve(temporary, `${scenario}-arguments`);
  const script = `
    source "$1"
    source "$2"
    arguments_file="$3"
    docker() {
      printf '%s\\n' "$*" >> "$arguments_file"
      if [[ "$1" == compose ]]; then
        printf '%s\\n' 'compose networks are unavailable' >&2
        return 99
      fi
      if [[ "$1 $2" == 'image inspect' ]]; then
        if [[ "$*" == *'.Config.User'* ]]; then
          [[ '${scenario}' == invalid-user ]] && printf '%s\\n' root || printf '%s\\n' devflow
        else
          printf '%s\\n' '${imageId}'
        fi
        return 0
      fi
      [[ "$1" == run ]] || return 98
      case "${scenario}" in
        success)
          printf '%s\\n' \
            'devflow_image_validation_result=passed' \
            'runtime_uid=100' \
            'runtime_gid=101'
          return 0
          ;;
        missing-directory)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=migration-directory-missing' \
            'migration_directory_present=false'
          return 40
          ;;
        missing-initial)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=expected-migration-missing' \
            'migration_directory_present=true' \
            'migration_directory_readable=true' \
            'expected_migration_present=false'
          return 41
          ;;
        content-mismatch)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=expected-migration-content-mismatch' \
            'expected_migration_present=true' \
            'expected_migration_content_match=false'
          return 44
          ;;
        directory-eacces)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=migration-directory-permission-denied' \
            'migration_directory_present=true' \
            'migration_directory_readable=false' \
            'migration_directory_traversable=false'
          return 45
          ;;
        file-eacces)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=expected-migration-permission-denied' \
            'migration_directory_present=true' \
            'migration_directory_readable=true' \
            'expected_migration_present=true' \
            'expected_migration_readable=false'
          return 46
          ;;
        symlink)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=migration-entry-symlink'
          return 43
          ;;
        writable)
          printf '%s\\n' \
            'devflow_image_validation_result=failed' \
            'devflow_image_validation_root_cause=expected-migration-writable-by-runtime-user' \
            'expected_migration_writable_by_runtime_user=true'
          return 47
          ;;
        runtime-error)
          printf '%s\\n' 'DB_PASSWORD=TOPSECRET' 'token=ANOTHERSECRETVALUE' >&2
          return 125
          ;;
      esac
    }
    status=0
    validate_backend_migration_image docker.io/library/devflow-backend:latest \
      '${expectedMigration}' '${imageId}' '${migrationHash}' || status=$?
    printf 'function_status=%s\\n' "$status"
  `;
  return {
    result: spawnSync(bash, ['-c', script, '_', commonPath, imagesPath, bashPath(argumentsFile)], {
      encoding: 'utf8', env: { ...process.env, TMPDIR: bashPath(temporary) },
    }),
    arguments: existsSync(argumentsFile) ? readFileSync(argumentsFile, 'utf8') : '',
  };
};

const transactionProbe = () => spawnSync(bash, ['-c', `
  source "$1"
  DEVFLOW_STATE_ROOT="$(mktemp -d)"
  trap 'rm -rf -- "$DEVFLOW_STATE_ROOT"' EXIT
  if [[ "$(uname -s)" == MINGW* ]]; then
    install() { mkdir -p "\${@: -1}"; }
    chmod() { command chmod "$@" 2>/dev/null || true; }
  fi
  source "$2"
  install_transaction_begin 0.6.25-alpha 0123456789012345678901234567890123456789
  install_transaction_complete_stage 05-images
  grep -F '"resumeFromStage": "06-dns-and-firewall"' "$DEVFLOW_INSTALL_TRANSACTION_FILE"
  install_transaction_fail 05-images image-validation-runtime-error
  grep -F '"rootCause": "image-validation-runtime-error"' "$DEVFLOW_INSTALL_TRANSACTION_FILE"
`, '_', commonPath, transactionPath], { encoding: 'utf8' });

try {
  const success = runProbe('success');
  const missingDirectory = runProbe('missing-directory');
  const missingInitial = runProbe('missing-initial');
  const contentMismatch = runProbe('content-mismatch');
  const directoryEacces = runProbe('directory-eacces');
  const fileEacces = runProbe('file-eacces');
  const symlink = runProbe('symlink');
  const writable = runProbe('writable');
  const invalidUser = runProbe('invalid-user');
  const dynamicMigration = runProbe('success', '002_future_schema.sql');
  const runtimeError = runProbe('runtime-error');
  const transaction = transactionProbe();

  check('image contains migration directory', success.result.stdout.includes('migration_directory_present=true'));
  check('image contains expected migration', success.result.stdout.includes('expected_migration_present=true'));
  check('missing directory is distinct', missingDirectory.result.stdout.includes('root_cause=migration-directory-missing')
    && missingDirectory.result.stdout.includes('function_status=40'));
  check('missing expected migration is distinct', missingInitial.result.stdout.includes('migration_directory_present=true')
    && missingInitial.result.stdout.includes('root_cause=expected-migration-missing')
    && missingInitial.result.stdout.includes('function_status=41'));
  check('migration content mismatch is distinct', contentMismatch.result.stdout.includes('expected_migration_content_match=false')
    && contentMismatch.result.stdout.includes('root_cause=expected-migration-content-mismatch')
    && contentMismatch.result.stdout.includes('function_status=44'));
  check('directory EACCES is a content failure', directoryEacces.result.stdout.includes('root_cause=migration-directory-permission-denied')
    && directoryEacces.result.stdout.includes('migration_directory_readable=false')
    && directoryEacces.result.stdout.includes('function_status=45'));
  check('file EACCES is a content failure', fileEacces.result.stdout.includes('root_cause=expected-migration-permission-denied')
    && fileEacces.result.stdout.includes('expected_migration_readable=false')
    && fileEacces.result.stdout.includes('function_status=46'));
  check('symlink is rejected', symlink.result.stdout.includes('root_cause=migration-entry-symlink')
    && symlink.result.stdout.includes('function_status=43'));
  check('runtime user cannot write migration', writable.result.stdout.includes('root_cause=expected-migration-writable-by-runtime-user')
    && writable.result.stdout.includes('function_status=47'));
  check('configured image user must be devflow', invalidUser.result.stdout.includes('configured_user=root')
    && invalidUser.result.stdout.includes('root_cause=backend-configured-user-invalid')
    && invalidUser.result.stdout.includes('function_status=48'));
  check('docker run has no network and uses Node directly', success.arguments.includes('run --rm --network none --entrypoint node'));
  check('expected migration is calculated and passed as an argument', dynamicMigration.arguments.includes('002_future_schema.sql')
    && dynamicMigration.result.stdout.includes('expected_migration=002_future_schema.sql'));
  check('immutable image identity is checked before and after the probe',
    (success.arguments.match(/image inspect/g) || []).length === 3
    && success.result.stdout.includes(`validated_image_id=${imageId}`));
  check('Compose run is not used for image validation', !validationBody.includes('DEVFLOW_COMPOSE')
    && !validationBody.includes('docker compose') && validationBody.includes('docker run'));
  check('absent Compose networks do not block validation', success.result.status === 0
    && success.result.stdout.includes('function_status=0') && !success.arguments.includes('compose'));
  check('isolated mode uses the independent validator', install.includes('validate_backend_migration_image "$backend_image"')
    && install.includes('installation_mode=isolated')
    && !validationBody.includes('DEVFLOW_PROXY_MODE'));
  check('single mode uses the same validator', !validationBody.includes('isolated')
    && (install.match(/validate_backend_migration_image/g) || []).length === 1);
  check('Nginx does not participate in image probe', !validationBody.includes('devflow-nginx'));
  check('Certbot does not participate in image probe', !validationBody.includes('certbot'));
  check('PostgreSQL does not participate in image probe', !validationBody.includes('postgres'));
  check('Docker runtime error is distinct', runtimeError.result.stdout.includes('backend_image_validation_status=runtime-error')
    && runtimeError.result.stdout.includes('image_validation_container_failed=true')
    && runtimeError.result.stdout.includes('docker_exit_code=125')
    && runtimeError.result.stdout.includes('function_status=42'));
  check('image content error is fail-closed', missingDirectory.result.stdout.includes('backend_image_validation_status=failed')
    && missingInitial.result.stdout.includes('backend_image_validation_status=failed'));
  check('stderr is sanitized', !runtimeError.result.stdout.includes('TOPSECRET')
    && !runtimeError.result.stdout.includes('ANOTHERSECRETVALUE')
    && runtimeError.result.stdout.includes('[REDACTED]'));
  check('success output is complete', ['backend_image_validation_status=passed', 'migration_directory_present=true',
    'configured_user=devflow', 'runtime_uid=100', 'runtime_gid=101',
    'migration_directory_readable=true', 'migration_directory_traversable=true',
    'migration_directory_writable_by_runtime_user=false', 'expected_migration_present=true',
    'expected_migration_regular_file=true', 'expected_migration_readable=true',
    'expected_migration_writable_by_runtime_user=false', 'expected_migration_executable=false',
    'expected_migration_content_match=true',
    'image_validation_runtime=docker-run', 'image_validation_network=none', 'image_validation_probe=node']
    .every((field) => success.result.stdout.includes(field)));
  check('stage 05 resumes at DNS and firewall validation with root cause support', transaction.status === 0
    && transaction.stdout.includes('stage=05-images completed=true')
    && transaction.stdout.includes('resume_from=06-dns-and-firewall')
    && transaction.stdout.includes('root_cause=image-validation-runtime-error'));
  check('PostgreSQL storage is preserved', compose.includes('/opt/devflow/storage/postgres')
    && !validationBody.includes('volume'));
  check('runtime is independent from neighboring applications', !validationBody.toLowerCase().includes('fullpassword')
    && !install.toLowerCase().includes('fullpassword'));
  check('ports 80 and 443 are untouched', !validationBody.match(/\b(?:80|443)\b/u));
  check('ARM64 remains supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
  check('Docker 29.6.1 satisfies the supported minimum', common.includes('version_at_least')
    && install.includes("docker version --format '{{.Server.Version}}')\" 24.0"));
  check('Compose 5.3.1 remains supported', install.includes('docker compose version --short')
    && install.includes('2.20 ou superior'));
  check('fail-closed mapping is retained', update.includes('validate_backend_migration_image')
    && update.includes("|| die 'Imagem final do backend nao atende ao contrato de migrations.'"));

  if (checks.length !== 32) throw new Error(`Expected 32 checks, got ${checks.length}`);
  console.log(`Direct image validation tests passed: ${checks.length} scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
