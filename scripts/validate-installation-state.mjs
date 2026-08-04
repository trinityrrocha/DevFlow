import {
  chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const python = process.env.DEVFLOW_TEST_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3');
const bashPath = (value) => process.platform === 'win32'
  ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : value;
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
const git = (directory, args) => {
  const result = run('git', ['-C', directory, ...args]);
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
};
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Installation state test failed: ${label}`);
  checks.push(label);
};

const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-installation-state-'));
const source = resolve(temporary, 'source');
const release = resolve(temporary, 'release');
const stateRoot = resolve(temporary, 'state');
const validator = resolve(root, 'scripts/validate-installation-state.py');
const common = resolve(root, 'scripts/lib/common.sh');
const repair = read('scripts/repair-installation-state.sh');
const update = read('scripts/update.sh');
const health = read('scripts/health.sh');
const publish = read('scripts/publish.sh');
const composeImages = read('scripts/lib/compose-images.sh');

const stateDocument = (commit, overrides = {}) => ({
  schemaVersion: 1,
  timestamp: '2026-08-04T00:05:07Z',
  version: read('VERSION').trim(),
  commit,
  ref: 'main',
  repository: 'https://github.com/trinityrrocha/DevFlow.git',
  updateChannel: 'main',
  result: 'success',
  installationScope: 'internal',
  applicationInstalled: true,
  externalPublicationEnabled: false,
  provider: 'host-nginx',
  frontendUrl: 'http://127.0.0.1:18080',
  backendUrl: 'http://127.0.0.1:13000',
  proxyMigrationRequired: true,
  fullpasswordModified: false,
  publicProxyModified: false,
  proxyMigrationExecuted: false,
  certificateIssued: false,
  proxyMode: 'shared',
  sharedProxyAdapter: 'host-nginx',
  domain: 'internal.local',
  migration: '001_initial_schema.sql',
  ...overrides,
});

try {
  const clone = run('git', ['-c', 'core.autocrlf=input', 'clone', '--quiet', '--no-hardlinks', root, source]);
  if (clone.status !== 0) throw new Error(clone.stderr);
  git(source, ['remote', 'set-url', 'origin', 'https://github.com/trinityrrocha/DevFlow.git']);
  const commit = git(source, ['rev-parse', 'HEAD']);
  cpSync(source, release, { recursive: true, filter: (path) => !path.includes(`${resolve(source, '.git')}`) });
  writeFileSync(resolve(release, '.devflow-release'), `${commit}\n`);
  const stateFile = resolve(stateRoot, 'installation.json');
  const writeState = (document) => run(python, [validator, 'write', stateFile], {
    input: `${JSON.stringify(document)}\n`,
  });
  const identityProbe = (fixtureSource = source, fixtureRelease = release) => run(bash, ['-c', `
    source "$1"
    DEVFLOW_INSTALL_ROOT="$2"
    DEVFLOW_IDENTITY_RELEASE_ROOT="$3"
    resolve_installed_release_identity "$4" main
  `, '_', bashPath(common), bashPath(temporary), bashPath(fixtureRelease), bashPath(fixtureSource)]);

  const validIdentity = identityProbe();
  check(`commit correto [status=${validIdentity.status} stderr=${validIdentity.stderr.trim()}]`,
    validIdentity.status === 0 && validIdentity.stdout.includes(`installed_commit=${commit}`));

  const oldCommit = git(source, ['rev-parse', 'HEAD^']);
  const oldStateWrite = writeState(stateDocument(oldCommit));
  check(`commit antigo [status=${oldStateWrite.status} stderr=${oldStateWrite.stderr.trim()}]`,
    oldStateWrite.status === 0 && readFileSync(stateFile, 'utf8').includes(oldCommit));
  check('versão correta com commit incorreto', stateDocument(oldCommit).version === read('VERSION').trim()
    && oldCommit !== commit);
  check('checkout ausente', identityProbe(resolve(temporary, 'missing')).status === 20);
  writeFileSync(resolve(source, 'dirty.fixture'), 'dirty\n');
  check('checkout sujo', identityProbe().status === 22);
  rmSync(resolve(source, 'dirty.fixture'));
  git(source, ['remote', 'set-url', 'origin', 'https://example.invalid/other.git']);
  check('remote incorreto', identityProbe().status === 21);
  git(source, ['remote', 'set-url', 'origin', 'https://github.com/trinityrrocha/DevFlow.git']);

  check('imagem backend correta', composeImages.includes('BACKEND_IMAGE_COMMIT_MATCH=true')
    && composeImages.includes('org.opencontainers.image.revision'));
  check('imagem frontend correta', composeImages.includes('FRONTEND_IMAGE_COMMIT_MATCH=true'));
  check('imagem com commit divergente', composeImages.includes('BACKEND_IMAGE_COMMIT_MATCH=false')
    && composeImages.includes('FRONTEND_IMAGE_COMMIT_MATCH=false'));
  check('API com versão correta', composeImages.includes('API_VERSION_MATCH=true')
    && read('backend/src/app.js').includes('commit: env.DEVFLOW_RELEASE_COMMIT'));

  check('estado inválido', writeState(stateDocument(commit, { schemaVersion: 2 })).status !== 0);
  writeFileSync(stateFile, '{broken-json\n');
  check('JSON corrompido', run(python, [validator, 'validate', stateFile]).status !== 0);
  check('backup do estado', repair.includes('$DEVFLOW_INSTALL_ROOT/backups/state')
    && repair.includes('install -m 0600 "$STATE_FILE" "$backup_file"'));
  check('gravação atômica', read('scripts/validate-installation-state.py').includes('os.replace(temporary, destination)')
    && read('scripts/validate-installation-state.py').includes('os.fsync'));
  const firstWrite = writeState(stateDocument(commit));
  const firstBody = readFileSync(stateFile, 'utf8');
  const secondWrite = writeState(stateDocument(commit));
  check('reparo idempotente', firstWrite.status === 0 && secondWrite.status === 0
    && readFileSync(stateFile, 'utf8') === firstBody && repair.includes('repair_status=not-required'));
  check('cancelamento pelo menu', repair.includes("require_numeric_confirmation installation-state-repair")
    && repair.includes("'CORRIGIR ESTADO DO DEVFLOW'"));
  check('modo sem TTY', read('scripts/lib/common.sh').includes('is_interactive_terminal')
    && repair.includes('require_numeric_confirmation'));
  check('instalação isolada', writeState(stateDocument(commit, {
    provider: 'isolated-nginx', proxyMode: 'isolated', sharedProxyAdapter: 'none',
  })).status === 0);
  check('instalação compartilhada', writeState(stateDocument(commit)).status === 0);
  check('update', update.includes('resolve_installed_release_identity')
    && update.includes('persist_operational_installation_state'));
  check('rollback', update.includes('previousInstalledCommit')
    && update.includes('recorded_previous_commit'));
  check('health degradado', health.includes('installation_state_health=%s')
    && health.includes('repair_available=%s'));
  check('Full Password preservado', read('scripts/lib/common.sh').includes('DEVFLOW_FULLPASSWORD_MODIFIED')
    && !repair.includes('fullpassword_nginx') && !repair.includes('/opt/fullpassword'));
  check('portas 80/443 intocadas', !/\b(?:80|443)\b/u.test(repair));
  check('banco e containers não reiniciados', !/(?:docker|DEVFLOW_COMPOSE).*\b(?:restart|start|stop|up|down)\b/u.test(repair)
    && !repair.includes('run_devflow_migrations'));

  check('publicação bloqueada por estado inconsistente', publish.includes('validate_installed_state_consistency'));
  if (checks.length !== 26) throw new Error(`Expected 26 checks, got ${checks.length}`);
  console.log(`Installation state tests passed: ${checks.length} scenarios (25 mandatory + publication gate).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
