import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const library = resolve(root, 'scripts/lib/version.sh');
const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap.sh'), 'utf8');
const install = readFileSync(resolve(root, 'scripts/install.sh'), 'utf8');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-version-policy-'));
const checks = [];

const bashPath = (path) => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;

const runBash = (body, args = []) => spawnSync(
  bash,
  ['-c', `source "$1"; shift; ${body}`, '_', bashPath(library), ...args.map((value) => bashPath(String(value)))],
  { encoding: 'utf8' }
);

const runGit = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const check = (name, condition) => {
  if (!condition) throw new Error(`Version policy test failed: ${name}`);
  checks.push(name);
};

const writeFixture = (directory, version, { frontendVersion = version } = {}) => {
  for (const child of ['backend/src/config', 'backend/src', 'backend/scripts', 'frontend', 'docker/updater', 'scripts/lib', 'docs/infrastructure']) mkdirSync(resolve(directory, child), { recursive: true });
  writeFileSync(resolve(directory, 'VERSION'), `${version}\n`);
  writeFileSync(resolve(directory, 'package.json'), `{\n  "name": "devflow",\n  "version": "${version}"\n}\n`);
  writeFileSync(resolve(directory, 'backend/package.json'), `{\n  "name": "backend",\n  "version": "${version}"\n}\n`);
  writeFileSync(resolve(directory, 'frontend/package.json'), `{\n  "name": "frontend",\n  "version": "${frontendVersion}"\n}\n`);
  writeFileSync(resolve(directory, 'backend/src/config/env.js'), `const version = z.string().default('${version}');\n`);
  writeFileSync(resolve(directory, 'backend/src/app.js'), 'const payload = { version: env.DEVFLOW_VERSION };\n');
  writeFileSync(resolve(directory, 'backend/scripts/migration-image-contract.js'), '// migration image contract fixture\n');
  writeFileSync(resolve(directory, '.env.example'), `DEVFLOW_VERSION=${version}\n`);
  writeFileSync(resolve(directory, 'docker-compose.yml'), `version: \${DEVFLOW_VERSION:-${version}}\nservices:\n  backend:\n    image: devflow-backend:\${DEVFLOW_IMAGE_TAG:-latest}\n  frontend:\n    image: devflow-frontend:\${DEVFLOW_IMAGE_TAG:-latest}\n`);
  writeFileSync(resolve(directory, 'docker-compose.maintenance.yml'), `version: \${DEVFLOW_VERSION:-${version}}\n`);
  writeFileSync(resolve(directory, 'docker/nginx.runtime.conf.template'), 'server_name __DEVFLOW_DOMAIN__;\n');
  writeFileSync(resolve(directory, 'docker/updater/Dockerfile'), 'FROM docker:27-cli\n');
  writeFileSync(resolve(directory, 'README.md'), `Versao atual: **${version}**\n`);
  writeFileSync(resolve(directory, 'CHANGELOG.md'), `## [${version}]\n`);
  writeFileSync(resolve(directory, 'docs/implementation-status.md'), `Versao: \`${version}\`.\n`);
  writeFileSync(resolve(directory, 'docs/infrastructure/vps-installation.md'), `Versao \`${version}\`.\n`);
  writeFileSync(resolve(directory, 'docs/roadmap.md'), `## Marco \`${version}\`\n`);
  writeFileSync(resolve(directory, 'docs/traceability.md'), `## Instalacao isolada \`${version}\`\n`);
  writeFileSync(resolve(directory, 'scripts/bootstrap.sh'), '#!/usr/bin/env bash\nsource scripts/lib/version.sh\nDETECTED_VERSION=dynamic\n');
  writeFileSync(resolve(directory, 'scripts/lib/common.sh'), 'source scripts/lib/version.sh\n');
  writeFileSync(resolve(directory, 'scripts/lib/version.sh'), '# fixture uses the tested library externally\n');
  writeFileSync(resolve(directory, 'scripts/lib/compose-images.sh'), '# compose image fixture\n');
  writeFileSync(resolve(directory, 'scripts/lib/install-transaction.sh'), '# transaction fixture\n');
  writeFileSync(resolve(directory, 'scripts/resolve-compose-image.py'), '# resolver fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-isolated-architecture.mjs'), '// isolated tests fixture\n');
  writeFileSync(resolve(directory, 'scripts/audit-compose-command.mjs'), '// compose audit fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-installation-state.py'), '# state validator fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-installation-state.mjs'), '// state tests fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-migration-image-permissions.mjs'), '// migration permission tests fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-updater-request.mjs'), '// updater request fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-update-workflow.mjs'), '// updater workflow fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-update-transaction.py'), '# update transaction validator fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-update-transaction.mjs'), '// update transaction tests fixture\n');
  writeFileSync(resolve(directory, 'scripts/write-update-status.mjs'), '// updater status fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-shell-syntax.mjs'), '// shell syntax fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-bootstrap-interface.mjs'), '// bootstrap interface fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-updater-installation-lifecycle.mjs'), '// updater lifecycle fixture\n');
  writeFileSync(resolve(directory, 'scripts/validate-auth-state-recovery.mjs'), '// auth state recovery fixture\n');
  for (const script of ['install.sh', 'update.sh', 'version.sh', 'health.sh', 'backup.sh', 'verify-backup.sh', 'restore.sh', 'uninstall.sh', 'diagnose.sh', 'repair-installation-state.sh', 'renew-certificate.sh', 'updater-daemon.sh']) {
    writeFileSync(resolve(directory, `scripts/${script}`), '#!/usr/bin/env bash\nsource scripts/lib/common.sh\n');
    chmodSync(resolve(directory, `scripts/${script}`), 0o755);
  }
  for (const script of ['update-cli.sh', 'update-bootstrap.sh']) {
    writeFileSync(resolve(directory, `scripts/${script}`), '#!/usr/bin/env bash\n');
    chmodSync(resolve(directory, `scripts/${script}`), 0o755);
  }
  chmodSync(resolve(directory, 'scripts/bootstrap.sh'), 0o755);
};

const validateDirectory = (directory) => runBash('devflow_validate_directory_version_consistency "$1"', [directory]);
const validateCheckout = (directory) => runBash('devflow_validate_checkout_version_consistency "$1"', [directory]);
const validateSemver = (version) => runBash('devflow_semver_is_valid "$1"', [version]);
const readVersion = (path) => runBash('devflow_read_version_file "$1"', [path]);
const validateIdentity = (directory, ref, commit) => runBash('devflow_validate_checkout_identity "$1" "$2" "$3"', [directory, ref, commit]);
const digestTree = (directory) => createHash('sha256')
  .update(['VERSION', 'package.json', 'backend/package.json', 'frontend/package.json']
    .map((file) => readFileSync(resolve(directory, file))).join('|'))
  .digest('hex');

try {
  const current = validateDirectory(root);
  check('main with current version', current.status === 0 && current.stdout.trim() === '0.6.20-alpha');

  const patchFixture = resolve(temporary, 'patch');
  writeFixture(patchFixture, '0.6.20-alpha');
  check('main after patch increment', validateDirectory(patchFixture).status === 0);

  const minorFixture = resolve(temporary, 'minor');
  writeFixture(minorFixture, '0.6.20-alpha');
  check('main after minor increment', validateDirectory(minorFixture).status === 0);

  const repositoryFixture = resolve(temporary, 'repository');
  writeFixture(repositoryFixture, '0.4.3-alpha');
  runGit(repositoryFixture, ['init', '-b', 'main']);
  runGit(repositoryFixture, ['config', 'user.name', 'trinityrrocha']);
  runGit(repositoryFixture, ['config', 'user.email', 'trinityrocha@sti1.com.br']);
  runGit(repositoryFixture, ['add', '-A']);
  for (const script of ['bootstrap.sh', 'install.sh', 'update.sh', 'version.sh', 'health.sh', 'backup.sh', 'verify-backup.sh', 'restore.sh', 'uninstall.sh', 'diagnose.sh', 'repair-installation-state.sh', 'renew-certificate.sh', 'updater-daemon.sh', 'update-cli.sh', 'update-bootstrap.sh']) {
    runGit(repositoryFixture, ['update-index', '--chmod=+x', `scripts/${script}`]);
  }
  runGit(repositoryFixture, ['commit', '-m', 'test: version policy fixture']);
  runGit(repositoryFixture, ['remote', 'add', 'origin', 'https://github.com/trinityrrocha/DevFlow.git']);
  const fixtureCommit = runGit(repositoryFixture, ['rev-parse', 'HEAD']);
  runGit(repositoryFixture, ['tag', 'v0.4.3-alpha']);
  runGit(repositoryFixture, ['checkout', '--detach', 'v0.4.3-alpha']);
  check('tag with corresponding version', validateIdentity(repositoryFixture, 'v0.4.3-alpha', fixtureCommit).status === 0
    && validateCheckout(repositoryFixture).status === 0);

  check('matching expected version', validateSemver('0.4.3-alpha').status === 0 && bootstrap.includes('EXPECTED_VERSION'));
  const mismatch = runBash('devflow_version_mismatch_message main 0.4.1-alpha 0.4.2-alpha 0123456789012345678901234567890123456789', []);
  check('divergent expected version', mismatch.status === 0 && mismatch.stdout.includes('Versão esperada: 0.4.1-alpha') && mismatch.stdout.includes('Nenhuma alteração foi realizada.'));

  const empty = resolve(temporary, 'empty-version');
  writeFileSync(empty, '');
  check('empty VERSION is rejected', readVersion(empty).status !== 0);
  const multiline = resolve(temporary, 'multiline-version');
  writeFileSync(multiline, '0.4.2-alpha\n0.4.3-alpha\n');
  check('multiline VERSION is rejected', readVersion(multiline).status !== 0);
  check('invalid SemVer is rejected', ['01.0.0', '1.0', '1.0.0-alpha..1', '1.0.0;id', '../1.0.0'].every((value) => validateSemver(value).status !== 0));
  check('alpha prerelease is accepted', validateSemver('0.4.3-alpha.1').status === 0);
  check('beta prerelease is accepted', validateSemver('0.5.0-beta').status === 0);
  check('stable version is accepted', validateSemver('1.0.0').status === 0
    && validateSemver('1.0.0+build.1').status === 0);

  const divergentFixture = resolve(temporary, 'divergent');
  writeFixture(divergentFixture, '0.4.3-alpha', { frontendVersion: '0.4.2-alpha' });
  check('frontend and backend divergence is rejected', validateDirectory(divergentFixture).status !== 0);

  runGit(repositoryFixture, ['remote', 'set-url', 'origin', 'https://github.com/example/DevFlow.git']);
  check('incorrect repository is rejected', validateIdentity(repositoryFixture, 'v0.4.3-alpha', fixtureCommit).status !== 0);
  runGit(repositoryFixture, ['remote', 'set-url', 'origin', 'https://github.com/trinityrrocha/DevFlow.git']);
  runGit(repositoryFixture, ['checkout', '-B', 'unexpected']);
  check('incorrect branch is rejected', validateIdentity(repositoryFixture, 'main', fixtureCommit).status !== 0);
  runGit(repositoryFixture, ['checkout', '-B', 'main']);
  check('commit resolves exactly', validateIdentity(repositoryFixture, 'main', fixtureCommit).status === 0 && validateIdentity(repositoryFixture, 'main', '0000000000000000000000000000000000000000').status !== 0);

  writeFileSync(resolve(repositoryFixture, 'untracked.tmp'), 'sentinel\n');
  check('fail-closed remains active', validateIdentity(repositoryFixture, 'main', fixtureCommit).status !== 0
    && runBash('devflow_ref_is_valid "$1"', ['feature/path']).status !== 0
    && bootstrap.includes('http.followRedirects=false')
    && bootstrap.includes('trap cleanup EXIT'));
  rmSync(resolve(repositoryFixture, 'untracked.tmp'));

  const beforeDigest = digestTree(divergentFixture);
  validateDirectory(divergentFixture);
  check('validation failure makes no changes', digestTree(divergentFixture) === beforeDigest
    && !bootstrap.includes('apt-get')
    && !bootstrap.includes('DEVFLOW_BOOTSTRAP_CONFIRMED')
    && install.includes('prompt_numeric_confirmation initial-installation'));

  const futureFixture = resolve(temporary, 'future');
  writeFixture(futureFixture, '0.9.0-alpha');
  check('future VERSION needs no bootstrap edit', validateDirectory(futureFixture).status === 0 && !/EXPECTED_VERSION=['"][0-9]/.test(bootstrap) && !bootstrap.includes('0.4.3-alpha'));

  if (checks.length !== 19) throw new Error(`Expected 19 checks, got ${checks.length}`);
  process.stdout.write(`Política de versão validada em ${checks.length} cenários.\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
