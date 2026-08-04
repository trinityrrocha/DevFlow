import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-compose-env-'));
const checks = [];
const bashPath = (path) => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;
const check = (name, condition) => {
  if (!condition) throw new Error(`Compose env test failed: ${name}`);
  checks.push(name);
};
const runBash = (script, env = {}) => spawnSync(bash, ['-c', script], {
  encoding: 'utf8', env: { ...process.env, ...env },
});

const appRoot = resolve(temporary, 'app');
const binRoot = resolve(temporary, 'bin');
mkdirSync(appRoot, { recursive: true });
mkdirSync(binRoot, { recursive: true });
for (const file of ['docker-compose.yml', 'docker-compose.shared.yml']) {
  writeFileSync(resolve(appRoot, file), 'services:\n  backend:\n    image: devflow-backend:latest\n');
}
writeFileSync(resolve(appRoot, 'resolver.py'), '# validation fixture\n');

const dockerLog = resolve(temporary, 'docker-arguments.log');
const resolverMarker = resolve(temporary, 'resolver-called');
const fakeDocker = resolve(binRoot, 'docker');
writeFileSync(fakeDocker, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${bashPath(dockerLog)}"
if [[ "$*" == *"config --format json"* ]]; then
  case "\${FAKE_COMPOSE_BEHAVIOR:-valid}" in
    valid) printf '%s\\n' '{"services":{"backend":{"image":"devflow-backend:latest"}}}' ;;
    invalid-json) printf '%s\\n' 'invalid-compose-json' ;;
    missing)
      printf '%s\\n' 'error while interpolating: required variable DB_PASSWORD is missing a value: TOPSECRET' >&2
      exit 14
      ;;
  esac
elif [[ "$*" == *"config --quiet"* ]]; then
  exit 0
fi
`, { mode: 0o755 });
chmodSync(fakeDocker, 0o755);
const fakePython = resolve(binRoot, 'python3');
writeFileSync(fakePython, `#!/usr/bin/env bash
if [[ "\${1:-}" == -c ]]; then
  grep -Eq '^[[:space:]]*\\{' "\${3:-}" || exit 1
else
  : > "${bashPath(resolverMarker)}"
  printf '%s\\n' devflow-backend:latest
fi
`, { mode: 0o755 });
chmodSync(fakePython, 0o755);

const required = (envPath, password = 'safe-fixture-value') => `DEVFLOW_VERSION=0.4.13-alpha
DEVFLOW_RELEASE_COMMIT=0000000000000000000000000000000000000000
DEVFLOW_ENV_FILE=${bashPath(envPath)}
DEVFLOW_DOMAIN=internal.local
NODE_ENV=production
APP_ORIGIN=http://127.0.0.1:18080
DB_USER=devflow_user
DB_PASSWORD=${password}
DB_NAME=devflow_db
JWT_SECRET=placeholder-fixture-jwt-value
ADMIN_BOOTSTRAP_TOKEN=placeholder-fixture-bootstrap-value
CONFIG_ENCRYPTION_KEY=placeholder-fixture-encryption-value
SUPER_ADMIN_EMAIL=owner@example.invalid
BACKUP_PASSPHRASE_FILE=/tmp/fixture-passphrase
`;
const makeEnv = (name, content, mode = 0o600) => {
  const path = resolve(temporary, name);
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
};
const validEnv = makeEnv('valid.env', required(resolve(temporary, 'valid.env')));
const missingDb = makeEnv('missing-db.env', required(resolve(temporary, 'missing-db.env')).replace(/^DB_PASSWORD=.*\n/mu, ''));
const emptyDb = makeEnv('empty-db.env', required(resolve(temporary, 'empty-db.env'), ''));
const specialEnv = makeEnv('special.env', required(resolve(temporary, 'special.env'), 'p@$$:word/with=special'));
const spaceEnv = makeEnv('space.env', required(resolve(temporary, 'space.env'), 'value with spaces'));
const hashEnv = makeEnv('hash.env', required(resolve(temporary, 'hash.env'), 'value#fragment'));
const marker = resolve(temporary, 'must-not-exist');
const inertEnv = makeEnv('inert.env', `${required(resolve(temporary, 'inert.env'))}SMTP_PASSWORD=$(touch ${bashPath(marker)})\n`);
const protectedEnv = makeEnv('protected.env', required(resolve(temporary, 'protected.env')), 0o644);

const common = bashPath(resolve(root, 'scripts/lib/common.sh'));
const images = bashPath(resolve(root, 'scripts/lib/compose-images.sh'));
const app = bashPath(appRoot);
const fakePath = bashPath(binRoot);
const statOverride = `
stat() {
  if [[ "$*" == *.env* && "$*" == *%a* ]]; then
    [[ "$*" == *protected.env* ]] && printf '644\\n' || printf '600\\n'
  elif [[ "$*" == *.env* && "$*" == *%u* ]]; then
    id -u
  else
    command stat "$@"
  fi
}
`;
const inspect = (path, extra = '') => runBash(`
set -Eeuo pipefail
source "${common}"
${statOverride}
DEVFLOW_ENV_FILE="${bashPath(path)}"
status=0
devflow_inspect_private_env "$DEVFLOW_ENV_FILE" || status=$?
printf 'status=%s detected=%s readable=%s permissions=%s owner=%s syntax=%s db=%s missing=%s\\n' \
  "$status" "$PRIVATE_ENV_DETECTED" "$PRIVATE_ENV_READABLE" "$PRIVATE_ENV_PERMISSIONS_VALID" \
  "$PRIVATE_ENV_OWNER_VALID" "$PRIVATE_ENV_SYNTAX_VALID" "$DB_PASSWORD_PRESENT" "$MISSING_REQUIRED_ENV_KEYS"
${extra}
`);

const valid = inspect(validEnv);
const absent = inspect(resolve(temporary, 'absent.env'));
const protectedResult = inspect(protectedEnv);
const missing = inspect(missingDb);
const empty = inspect(emptyDb);
const special = inspect(specialEnv);
const spaced = inspect(spaceEnv);
const hash = inspect(hashEnv);
const inert = inspect(inertEnv, 'load_devflow_env');

const renderProbe = (behavior) => runBash(`
set -Eeuo pipefail
export PATH="${fakePath}:$PATH" FAKE_COMPOSE_BEHAVIOR=${behavior}
source "${common}"
source "${images}"
${statOverride}
DEVFLOW_ENV_FILE="${bashPath(validEnv)}"
DEVFLOW_PROXY_MODE=shared
DEVFLOW_SHARED_PROXY_ADAPTER=host-nginx
DEVFLOW_IMAGE_PYTHON="${bashPath(fakePython)}"
DEVFLOW_IMAGE_RESOLVER="${bashPath(resolve(appRoot, 'resolver.py'))}"
build_devflow_compose_command "${app}" "$DEVFLOW_ENV_FILE" DEVFLOW_COMPOSE devflow application
output="${bashPath(resolve(temporary, `${behavior}.json`))}"
status=0
compose_render_config_json "$output" || status=$?
printf 'status=%s output=%s\\n' "$status" "$([[ -s "$output" ]] && printf present || printf absent)"
`, { FAKE_COMPOSE_BEHAVIOR: behavior });

rmSync(dockerLog, { force: true });
const validRender = renderProbe('valid');
const composeArguments = existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8') : '';
rmSync(resolverMarker, { force: true });
const missingRender = runBash(`
set -Eeuo pipefail
export PATH="${fakePath}:$PATH" FAKE_COMPOSE_BEHAVIOR=missing
source "${common}"
source "${images}"
${statOverride}
DEVFLOW_ENV_FILE="${bashPath(validEnv)}"
DEVFLOW_PROXY_MODE=shared
DEVFLOW_SHARED_PROXY_ADAPTER=host-nginx
DEVFLOW_IMAGE_PYTHON="${bashPath(fakePython)}"
DEVFLOW_IMAGE_RESOLVER="${bashPath(resolve(appRoot, 'resolver.py'))}"
build_devflow_compose_command "${app}" "$DEVFLOW_ENV_FILE" DEVFLOW_COMPOSE devflow application
status=0
compose_service_image_expected backend >/dev/null || status=$?
printf 'status=%s\\n' "$status"
`);
const invalidRender = renderProbe('invalid-json');

const install = readFileSync(resolve(root, 'scripts/install.sh'), 'utf8');
const commonSource = readFileSync(resolve(root, 'scripts/lib/common.sh'), 'utf8');
const composeSource = readFileSync(resolve(root, 'scripts/lib/compose-images.sh'), 'utf8');
const shellScripts = readFileSync(resolve(root, 'scripts/audit-compose-command.mjs'), 'utf8');

check('valid env with DB_PASSWORD', valid.status === 0 && valid.stdout.includes('status=0') && valid.stdout.includes('db=true'));
check('absent env is classified', absent.status === 0 && absent.stdout.includes('status=1') && absent.stdout.includes('detected=false'));
check('protected env is rejected', protectedResult.stdout.includes('status=3') && protectedResult.stdout.includes('permissions=false'));
check('missing DB_PASSWORD is rejected', missing.stdout.includes('status=6') && missing.stdout.includes('DB_PASSWORD'));
check('empty DB_PASSWORD is rejected', empty.stdout.includes('status=6') && empty.stdout.includes('db=false'));
check('special characters remain data', special.stdout.includes('status=0'));
check('spaces remain data', spaced.stdout.includes('status=0'));
check('hash remains data', hash.stdout.includes('status=0'));
check('dotenv content is never executed', inert.status === 0 && !existsSync(marker) && !commonSource.includes(`source "$DEVFLOW_ENV_FILE"`));
check('Compose render uses --env-file', validRender.stdout.includes('status=0') && composeArguments.includes(`--env-file ${bashPath(validEnv)}`));
check('direct DevFlow Compose construction is audited', shellScripts.includes('build_devflow_compose_command'));
check('render failure stops before resolver', missingRender.stdout.includes('status=20') && !existsSync(resolverMarker));
check('valid JSON is accepted', validRender.stdout.includes('output=present'));
check('invalid JSON is rejected', invalidRender.stdout.includes('status=21') && invalidRender.stdout.includes('output=absent'));
check('missing variable message identifies DB_PASSWORD', missingRender.stderr.includes('variável obrigatória ausente') && missingRender.stderr.includes('DB_PASSWORD'));
check('render failure never reports a false image cause',
  !missingRender.stderr.includes('não resolveu exatamente uma imagem')
  && !invalidRender.stderr.includes('não resolveu exatamente uma imagem'));
check('dry-run exits before persistent writes', install.indexOf('if [[ "$MODE" == dry-run ]]') < install.indexOf('install -d -m 0750 "$DEVFLOW_INSTALL_ROOT"'));
check('resume accepts valid private configuration', install.includes('RESUME_CONFIGURATION_VALID') && install.includes('COMPOSE_RUNTIME_CONFIG_VALID=true'));
check('invalid config without database offers controlled recovery', install.includes('CONFIGURATION_RECOVERY_AVAILABLE=true') && install.includes('REGERAR CONFIGURAÇÃO DEVFLOW'));
check('invalid config with database requires manual recovery', install.includes('MANUAL_RECOVERY_REQUIRED=true') && install.includes('sem regeneração de senha'));
check('Compose error does not expose secret values', !missingRender.stderr.includes('TOPSECRET') && composeSource.includes('Nenhum valor sensível foi exibido.'));
check('ARM64 remains supported', commonSource.includes('aarch64|arm64) DEVFLOW_ARCH=arm64'));
check('Docker Compose 5.3.1 satisfies minimum', runBash(`source "${common}"; version_at_least 5.3.1 2.20`).status === 0);
check('runtime command fails closed for invalid env', runBash(`set -Eeuo pipefail; source "${common}"; ${statOverride}; DEVFLOW_ENV_FILE="${bashPath(missingDb)}"; DEVFLOW_PROXY_MODE=shared; DEVFLOW_SHARED_PROXY_ADAPTER=host-nginx; build_devflow_compose_command "${app}" "$DEVFLOW_ENV_FILE" DEVFLOW_COMPOSE devflow application`).status !== 0);

if (checks.length !== 24) throw new Error(`Expected 24 checks, got ${checks.length}`);
console.log(`Compose env-file tests passed: ${checks.length} scenarios.`);
rmSync(temporary, { recursive: true, force: true });
