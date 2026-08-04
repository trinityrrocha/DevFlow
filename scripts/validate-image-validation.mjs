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
const providers = read('scripts/providers/provider-contract.sh');
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
        printf '%s\\n' '${imageId}'
        return 0
      fi
      [[ "$1" == run ]] || return 98
      case "${scenario}" in
        success)
          printf '%s\\n' 'devflow_image_validation_result=passed'
          return 0
          ;;
        missing-directory)
          printf '%s\\n' 'devflow_image_validation_result=migration-directory-missing'
          return 40
          ;;
        missing-initial)
          printf '%s\\n' 'devflow_image_validation_result=expected-migration-missing'
          return 41
          ;;
        content-mismatch)
          printf '%s\\n' 'devflow_image_validation_result=expected-migration-content-mismatch'
          return 44
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
  install_transaction_begin 0.4.12-alpha 0123456789012345678901234567890123456789 internal false false 06-validate-images
  install_transaction_complete_stage 06-validate-images
  grep -F '"resumeFromStage": "07-create-networks"' "$DEVFLOW_INSTALL_TRANSACTION_FILE"
  install_transaction_fail 06-validate-images image-validation-runtime-error
  grep -F '"rootCause": "image-validation-runtime-error"' "$DEVFLOW_INSTALL_TRANSACTION_FILE"
`, '_', commonPath, transactionPath], { encoding: 'utf8' });

try {
  const success = runProbe('success');
  const missingDirectory = runProbe('missing-directory');
  const missingInitial = runProbe('missing-initial');
  const contentMismatch = runProbe('content-mismatch');
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
  check('docker run has no network and uses Node directly', success.arguments.includes('run --rm --network none --entrypoint node'));
  check('expected migration is calculated and passed as an argument', dynamicMigration.arguments.includes('002_future_schema.sql')
    && dynamicMigration.result.stdout.includes('expected_migration=002_future_schema.sql'));
  check('immutable image identity is checked before and after the probe',
    (success.arguments.match(/image inspect/g) || []).length === 2
    && success.result.stdout.includes(`validated_image_id=${imageId}`));
  check('Compose run is not used for image validation', !validationBody.includes('DEVFLOW_COMPOSE')
    && !validationBody.includes('docker compose') && validationBody.includes('docker run'));
  check('absent Compose networks do not block validation', success.result.status === 0
    && success.result.stdout.includes('function_status=0') && !success.arguments.includes('compose'));
  check('shared mode uses the provider-independent validator', install.includes('validate_backend_migration_image "$backend_image"')
    && install.includes('installation_mode=$PROXY_MODE')
    && !validationBody.includes('DEVFLOW_PROXY_MODE'));
  check('isolated mode uses the same validator', !validationBody.includes('isolated')
    && (install.match(/validate_backend_migration_image/g) || []).length === 1);
  check('host-nginx provider is preserved', providers.includes('host-nginx'));
  check('isolated-nginx provider is preserved', providers.includes('isolated-nginx'));
  check('legacy provider does not interfere', providers.includes('legacy-docker-nginx')
    && !validationBody.includes('legacy-docker-nginx'));
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
    'expected_migration_present=true', 'expected_migration_content_match=true',
    'image_validation_runtime=docker-run', 'image_validation_network=none', 'image_validation_probe=node']
    .every((field) => success.result.stdout.includes(field)));
  check('stage 06 resumes at stage 07 with root cause support', transaction.status === 0
    && transaction.stdout.includes('completed_stage=06-validate-images')
    && transaction.stdout.includes('resume_from_stage=07-create-networks')
    && transaction.stdout.includes('root_cause=image-validation-runtime-error'));
  check('PostgreSQL volume is preserved', install.includes('database_data_preserved=true')
    && !validationBody.includes('volume'));
  check('Full Password remains preserved', !validationBody.toLowerCase().includes('fullpassword')
    && read('scripts/audit-fullpassword-readonly.mjs').includes('/opt/fullpassword'));
  check('ports 80 and 443 are untouched', !validationBody.match(/\b(?:80|443)\b/u));
  check('ARM64 remains supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
  check('Docker 29.6.1 satisfies the supported minimum', common.includes('version_at_least')
    && install.includes('version_at_least "$docker_version" 24.0'));
  check('Compose 5.3.1 remains supported', install.includes('version_at_least "$compose_version" 2.20'));
  check('fail-closed mapping is retained', install.includes('ROOT_CAUSE=image-content-invalid')
    && install.includes('ROOT_CAUSE=image-validation-runtime-error')
    && update.includes('candidate_image_validation_status'));

  if (checks.length !== 27) throw new Error(`Expected 27 checks, got ${checks.length}`);
  console.log(`Direct image validation tests passed: ${checks.length} scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
