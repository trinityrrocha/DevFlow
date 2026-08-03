import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const install = readFileSync(resolve(root, 'scripts/install.sh'), 'utf8');
const startup = readFileSync(resolve(root, 'scripts/lib/install-startup.sh'), 'utf8');
const transaction = readFileSync(resolve(root, 'scripts/lib/install-transaction.sh'), 'utf8');
const common = readFileSync(resolve(root, 'scripts/lib/common.sh'), 'utf8');
const composeImages = readFileSync(resolve(root, 'scripts/lib/compose-images.sh'), 'utf8');
const docs = [
  'README.md', 'docs/infrastructure/installation.md', 'docs/infrastructure/vps-installation.md',
  'docs/operations/first-deployment.md', 'docs/operations/troubleshooting.md',
].map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-install-startup-'));
const temporaryHome = resolve(temporary, 'home');
mkdirSync(temporaryHome, { recursive: true });
const checks = [];

const bashPath = (path) => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;

const check = (name, condition) => {
  if (!condition) throw new Error(`Install startup test failed: ${name}`);
  checks.push(name);
};

const run = (command, args = [], options = {}) => spawnSync(command, args, {
  encoding: 'utf8', env: { ...process.env, HOME: temporaryHome }, ...options,
});
const git = (cwd, args) => {
  const result = run('git', args, { cwd });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const createInstrumentedInstaller = (name, { failingImport = false } = {}) => {
  const fixtureRoot = resolve(temporary, name);
  mkdirSync(resolve(fixtureRoot, 'scripts'), { recursive: true });
  cpSync(resolve(root, 'scripts/lib'), resolve(fixtureRoot, 'scripts/lib'), { recursive: true });
  cpSync(resolve(root, 'scripts/providers'), resolve(fixtureRoot, 'scripts/providers'), { recursive: true });
  writeFileSync(resolve(fixtureRoot, 'VERSION'), '0.4.7-alpha\n');
  let source = install.replace(
    'STARTUP_STAGE=04-platform\nrequire_linux',
    "STARTUP_STAGE=04-platform\nbootstrap_emit ERROR 'fixture-stop'; exit 97\nrequire_linux",
  );
  if (failingImport) {
    writeFileSync(resolve(fixtureRoot, 'scripts/lib/failing.sh'), 'return 1\n');
    source = source.replace(
      '. "$SCRIPT_DIR/lib/common.sh"',
      '. "$SCRIPT_DIR/lib/failing.sh"\n. "$SCRIPT_DIR/lib/common.sh"',
    );
  }
  const path = resolve(fixtureRoot, 'scripts/install.sh');
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
};

const runInstaller = (path, args) => {
  const result = run(bash, [bashPath(path), ...args]);
  return { ...result, combined: `${result.stdout}${result.stderr}` };
};

const initializeDetectionVariables = `
  PARTIAL_INSTALLATION_DETECTED=false
  RESUME_CHECKOUT_VALID=false
  RESUME_CONFIGURATION_VALID=false
  PARTIAL_CONFIGURATION_PRESENT=false
  RESUME_TRANSACTION_VALID=false
  PARTIAL_INSTALLATION_VERSION=unknown
  PARTIAL_INSTALLATION_COMMIT=unknown
  PARTIAL_INSTALLATION_STAGE=unknown
  SOURCE_READY=false
  CONFIGURATION_READY=false
  CONFIGURATION_COMPATIBLE=false
  CONFIGURATION_VERSION=unknown
  PARTIAL_CONFIGURATION_INVALID=false
  PRIVATE_ENV_DETECTED=false
  PRIVATE_ENV_READABLE=false
  PRIVATE_ENV_PERMISSIONS_VALID=false
  PRIVATE_ENV_OWNER_VALID=false
  PRIVATE_ENV_SYNTAX_VALID=false
  DB_PASSWORD_PRESENT=false
  MISSING_REQUIRED_ENV_KEYS=none
  IMAGES_READY=false
  DATABASE_CONTAINER_READY=false
  DATABASE_HEALTHY=false
  MIGRATIONS_READY=false
  BACKEND_READY=false
  FRONTEND_READY=false
  SUPER_ADMIN_READY=false
  INSTALLATION_STATE_READY=false
  LEGACY_PARTIAL_INSTALLATION_DETECTED=false
  TRANSACTION_STATE_PRESENT=false
  TRANSACTION_STATE_CORRUPT=false
  TRANSACTION_STATE_RECONSTRUCTION_PLANNED=false
  CAN_RESUME=false
  RESUME_FROM_STAGE=01-preflight
  BACKEND_BUILD_REQUIRED=true
  FRONTEND_BUILD_REQUIRED=true
  POSTGRES_PULL_REQUIRED=false
`;

const createPartialFixture = (name, { dirty = false, stateDirectory = true, log = true } = {}) => {
  const fixture = resolve(temporary, name);
  const target = resolve(fixture, 'target');
  const installRoot = resolve(fixture, 'opt/devflow');
  const partialSource = resolve(installRoot, 'source');
  mkdirSync(target, { recursive: true });
  git(target, ['init', '-b', 'main']);
  git(target, ['config', 'user.name', 'trinityrrocha']);
  git(target, ['config', 'user.email', 'trinityrocha@sti1.com.br']);
  writeFileSync(resolve(target, 'VERSION'), '0.4.4-alpha\n');
  git(target, ['add', 'VERSION']);
  git(target, ['commit', '-m', 'legacy']);
  const legacyCommit = git(target, ['rev-parse', 'HEAD']);
  git(fixture, ['clone', target, partialSource]);
  git(partialSource, ['remote', 'set-url', 'origin', 'https://github.com/trinityrrocha/DevFlow.git']);
  writeFileSync(resolve(target, 'target.txt'), 'current\n');
  git(target, ['add', 'target.txt']);
  git(target, ['commit', '-m', 'current']);
  const targetCommit = git(target, ['rev-parse', 'HEAD']);
  mkdirSync(resolve(installRoot, 'config'), { recursive: true });
  const envPath = resolve(installRoot, 'config/devflow.env');
  writeFileSync(envPath, `DEVFLOW_VERSION=0.4.4-alpha
DEVFLOW_RELEASE_COMMIT=${legacyCommit}
DEVFLOW_ENV_FILE=${bashPath(envPath)}
DEVFLOW_DOMAIN=internal.local
NODE_ENV=production
APP_ORIGIN=http://127.0.0.1:18080
DB_USER=devflow_user
DB_PASSWORD=placeholder-test-value
DB_NAME=devflow_db
JWT_SECRET=placeholder-test-value
ADMIN_BOOTSTRAP_TOKEN=placeholder-test-value
CONFIG_ENCRYPTION_KEY=placeholder-test-value
SUPER_ADMIN_EMAIL=owner@example.invalid
BACKUP_PASSPHRASE_FILE=/tmp/test-only.passphrase
`);
  chmodSync(envPath, 0o600);
  if (stateDirectory) {
    mkdirSync(resolve(installRoot, 'state'), { recursive: true });
    writeFileSync(resolve(installRoot, 'state/installation.json'), `{
  "version": "0.4.4-alpha",
  "commit": "${legacyCommit}",
  "result": "failure"
}\n`);
  }
  if (log) {
    mkdirSync(resolve(installRoot, 'logs'), { recursive: true });
    writeFileSync(resolve(installRoot, 'logs/install-legacy.log'), 'sanitized\n');
  }
  if (dirty) writeFileSync(resolve(partialSource, 'untracked.fixture'), 'dirty\n');
  return { fixture, target, installRoot, legacyCommit, targetCommit };
};

const probePartial = (fixture) => {
  const script = `
    set -Eeuo pipefail
    export GIT_OPTIONAL_LOCKS=0
    source "$1"
    DEVFLOW_INSTALL_ROOT="$2"
    DEVFLOW_CONFIG_ROOT="$DEVFLOW_INSTALL_ROOT/config"
    DEVFLOW_ENV_FILE="$DEVFLOW_CONFIG_ROOT/devflow.env"
    DEVFLOW_STATE_ROOT="$DEVFLOW_INSTALL_ROOT/state"
    DEVFLOW_INSTALL_TRANSACTION_FILE="$DEVFLOW_STATE_ROOT/install-transaction.json"
    SOURCE_DIR="$3"
    release_sha="$4"
    public_remote=https://github.com/trinityrrocha/DevFlow.git
    source "$5"
    source "$6"
    ${initializeDetectionVariables}
    if [[ "$(uname -s)" == MINGW* ]]; then
      stat() {
        if [[ "$*" == *devflow.env* && "$*" == *%a* ]]; then
          printf '600\\n'
        elif [[ "$*" == *devflow.env* && "$*" == *%u* ]]; then
          id -u
        else
          command stat "$@"
        fi
      }
    fi
    before="$(git -C "$DEVFLOW_INSTALL_ROOT/source" status --porcelain=v1; git hash-object "$DEVFLOW_INSTALL_ROOT/source/.git/index")"
    detect_partial_installation
    determine_resume_stage
    after="$(git -C "$DEVFLOW_INSTALL_ROOT/source" status --porcelain=v1; git hash-object "$DEVFLOW_INSTALL_ROOT/source/.git/index")"
    printf '%s\\n' \
      "partial=$PARTIAL_INSTALLATION_DETECTED" \
      "legacy=$LEGACY_PARTIAL_INSTALLATION_DETECTED" \
      "transaction_present=$TRANSACTION_STATE_PRESENT" \
      "reconstruction_planned=$TRANSACTION_STATE_RECONSTRUCTION_PLANNED" \
      "can_resume=$CAN_RESUME" \
      "source_ready=$SOURCE_READY" \
      "configuration_ready=$CONFIGURATION_READY" \
      "resume_from=$RESUME_FROM_STAGE" \
      "source_preserved=$([[ "$before" == "$after" ]] && printf true || printf false)"
  `;
  return run(bash, [
    '-c', script, '_', bashPath(resolve(root, 'scripts/lib/common.sh')), bashPath(fixture.installRoot),
    bashPath(fixture.target), fixture.targetCommit, bashPath(resolve(root, 'scripts/lib/install-transaction.sh')),
    bashPath(resolve(root, 'scripts/lib/install-startup.sh')),
  ]);
};

try {
  const instrumented = createInstrumentedInstaller('instrumented');
  const dryRun = runInstaller(instrumented, ['--dry-run', '--install-scope', 'internal', '--super-admin-email', 'contato@sti1.com.br']);
  const resume = runInstaller(instrumented, ['--resume', '--super-admin-email', 'contato@sti1.com.br']);
  const missingValue = runInstaller(instrumented, ['--provider']);
  const unknown = runInstaller(instrumented, ['--unknown']);
  const help = runInstaller(instrumented, ['--help']);
  const failingImport = runInstaller(createInstrumentedInstaller('failing-import', { failingImport: true }), ['--check']);

  const partial = createPartialFixture('partial');
  const partialProbe = probePartial(partial);
  const partialOutput = `${partialProbe.stdout}${partialProbe.stderr}`;
  const dirtyProbe = probePartial(createPartialFixture('dirty', { dirty: true }));
  const noStateFixture = createPartialFixture('no-state-dir', { stateDirectory: false });
  const noStateProbe = probePartial(noStateFixture);
  const transactionPath = resolve(partial.installRoot, 'state/install-transaction.json');

  check('missing install transaction is expected false', partialProbe.status === 0
    && partialOutput.includes('transaction_present=false') && !existsSync(transactionPath));
  check('legacy partial installation is detected', partialOutput.includes('partial=true') && partialOutput.includes('legacy=true'));
  check('failing library source is diagnosed', failingImport.status !== 0 && failingImport.combined.includes('Falha inicial:'));
  const expectedFalse = run(bash, ['-c', `set -e; source "$1"; install_transaction_has_stage(){ return 1; }; MIGRATIONS_READY=false; SUPER_ADMIN_READY=false; detect(){ if install_transaction_has_stage x; then MIGRATIONS_READY=true; fi; if install_transaction_has_stage y; then SUPER_ADMIN_READY=true; fi; return 0; }; detect; printf survived`, '_', bashPath(resolve(root, 'scripts/lib/install-startup.sh'))]);
  const silentBaseline = run(bash, ['-c', 'set -e; install_transaction_has_stage(){ return 1; }; detect(){ install_transaction_has_stage missing && true; }; detect']);
  check('expected boolean false survives set -e', silentBaseline.status === 1
    && `${silentBaseline.stdout}${silentBaseline.stderr}` === ''
    && expectedFalse.status === 0 && expectedFalse.stdout === 'survived');
  check('pre-logger error has functional output', failingImport.combined.includes('código=1') && failingImport.combined.includes('etapa='));
  check('early trap precedes imports', install.indexOf('trap early_error_handler ERR') < install.indexOf('. "$SCRIPT_DIR/lib/common.sh"'));
  check('resume argument is recognized', resume.combined.includes('Argumentos reconhecidos: --resume --super-admin-email') && resume.combined.includes('modo=resume'));
  check('dry-run argument is recognized', dryRun.combined.includes('Argumentos reconhecidos: --dry-run --install-scope --super-admin-email') && dryRun.combined.includes('modo=dry-run'));
  check('internal scope argument cannot over-shift', dryRun.status === 97 && !dryRun.combined.includes('shift count'));
  check('argument errors always explain usage', missingValue.status === 2 && unknown.status === 2
    && missingValue.combined.includes('exige um valor') && unknown.combined.includes('argumento desconhecido')
    && unknown.combined.includes('Use --help'));
  check('legacy transaction reconstruction is planned', partialOutput.includes('reconstruction_planned=true')
    && transaction.includes('transactionStateReconstructed') && transaction.includes('resumeFromStage'));
  check('unlabelled old images require build', install.includes('compose_image_matches_release')
    && install.includes('BACKEND_BUILD_REQUIRED=true') && install.includes('FRONTEND_BUILD_REQUIRED=true'));
  check('clean checkout is accepted', partialOutput.includes('source_ready=true') && partialOutput.includes('can_resume=true'));
  check('divergent checkout is rejected', dirtyProbe.status === 0 && dirtyProbe.stdout.includes('source_ready=false')
    && dirtyProbe.stdout.includes('can_resume=false'));
  check('existing secure configuration is accepted', partialOutput.includes('configuration_ready=true'));
  check('existing sanitized log is preserved', existsSync(resolve(partial.installRoot, 'logs/install-legacy.log')));
  check('empty state directory stays unchanged in dry-run', existsSync(resolve(partial.installRoot, 'state')) && !existsSync(transactionPath));
  check('absent state directory is not created in dry-run', noStateProbe.status === 0
    && !existsSync(resolve(noStateFixture.installRoot, 'state')) && noStateProbe.stdout.includes('reconstruction_planned=true'));
  check('no containers resumes before networks', partialOutput.includes('resume_from=05-build-images')
    && install.includes('DATABASE_CONTAINER_READY=false'));
  check('nonzero dry-run and resume cannot be silent', dryRun.status !== 0 && resume.status !== 0
    && dryRun.combined.trim().length > 0 && resume.combined.trim().length > 0);
  check('source clone remains read-only', partialOutput.includes('source_preserved=true')
    && install.includes('export GIT_OPTIONAL_LOCKS=0')
    && !/git -C "\$SOURCE_DIR" (?:checkout|pull|reset|clean)/.test(install));
  check('startup output does not expose argument values', !dryRun.combined.includes('contato@sti1.com.br')
    && !install.includes('BASH_COMMAND') && install.includes('RECOGNIZED_ARGUMENTS'));
  check('documentation never recommends shell tracing', !/(?:bash\s+-x|set\s+-x)/.test(docs));
  check('ARM64 remains supported', common.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
  check('Docker Compose 5.3.1 remains compatible', install.includes('version_at_least "$compose_version" 2.20'));
  check('fail-closed and help remain functional', help.status === 0 && help.combined.includes('--diagnose-startup')
    && install.includes('TRANSACTION_STATE_CORRUPT') && composeImages.includes('docker image inspect'));

  if (checks.length !== 26) throw new Error(`Expected 26 checks, got ${checks.length}`);
  process.stdout.write(`Install startup tests passed: ${checks.length} scenarios.\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
