import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const install = read('scripts/install.sh');
const daemon = read('scripts/updater-daemon.sh');
const requestValidator = read('scripts/validate-updater-request.mjs');
const compose = YAML.parse(read('docker-compose.yml'));
const bash = process.env.DEVFLOW_TEST_BASH
  || (process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Updater installation lifecycle test failed: ${label}`);
  checks.push(label);
};

const activation = install.match(/activate_candidate_app_symlink\(\) \{[\s\S]*?\n\}/u)?.[0] || '';
const rollback = install.match(/restore_previous_app_symlink\(\) \{[\s\S]*?\n\}/u)?.[0] || '';
const stage14 = install.slice(install.indexOf('CURRENT_INSTALL_STAGE=14-nginx-https'), install.indexOf('CURRENT_INSTALL_STAGE=15-super-admin'));
const finalStage = install.slice(install.indexOf('CURRENT_INSTALL_STAGE=16-final-health-state'));
const gateFunctionStart = daemon.indexOf('updater_processing_blocked()');
const gateFunctionEnd = daemon.indexOf('\nmkdir -p', gateFunctionStart);
if (gateFunctionStart < 0 || gateFunctionEnd < 0) throw new Error('Updater gate helper was not found.');

const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-updater-lifecycle-'));
const helper = resolve(temporary, 'gate-helper.sh');
const gate = resolve(temporary, 'installation-in-progress');
writeFileSync(helper, `${daemon.slice(gateFunctionStart, gateFunctionEnd)}\n`);
const runGate = () => spawnSync(bash, ['-c', 'INSTALLATION_GATE_FILE="$1"; source "$2"; updater_processing_blocked', '_', gate, helper], { encoding: 'utf8' });

try {
  check('01 initial installation accepts absent active app', activation.includes('APP_SYMLINK_PREVIOUSLY_PRESENT=false')
    && activation.includes('elif [[ -e "$active_path" ]]'));
  check('02 candidate app is activated before updater create', install.indexOf('activate_candidate_app_symlink')
    < install.indexOf('create db backend worker frontend edge updater'));
  check('03 updater daemon is present through active symlink', install.includes('-f "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh"'));
  check('04 updater daemon is executable through active symlink', install.includes('-x "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh"'));
  check('05 daemon creates ready marker', daemon.includes('touch "$REQUEST_ROOT/daemon.ready"'));
  check('06 updater healthcheck requires ready marker', compose.services.updater.healthcheck.test.join(' ')
    === 'CMD test -f /var/lib/devflow-updater/daemon.ready');
  check('07 updater healthcheck has start period', compose.services.updater.healthcheck.start_period === '15s');

  writeFileSync(gate, '');
  check('08 installation gate blocks processing', runGate().status === 0
    && daemon.indexOf('if updater_processing_blocked; then') < daemon.indexOf('for candidate in "$REQUEST_DIR"'));
  check('09 daemon remains ready while gate exists', daemon.indexOf('touch "$REQUEST_ROOT/daemon.ready"')
    < daemon.indexOf('if updater_processing_blocked; then'));
  unlinkSync(gate);
  check('10 removing gate releases queue', runGate().status !== 0
    && daemon.includes('Instalacao concluida; processamento da fila liberado.'));

  check('11 previous app symlink is captured and validated', activation.includes('PREVIOUS_APP_TARGET=')
    && activation.includes('valid_release_target "$PREVIOUS_APP_TARGET"'));
  check('12 rollback atomically restores previous target', rollback.includes('replace_app_symlink_atomically "$PREVIOUS_APP_TARGET"'));
  check('13 initial rollback removes only candidate app symlink', rollback.includes('current_target')
    && rollback.includes('rm -f -- "$DEVFLOW_INSTALL_ROOT/app"') && !rollback.includes('rm -rf'));
  check('14 resume can recalculate directly to stage 14', install.includes('RESUME_START_STAGE=14-nginx-https')
    && install.includes('service_healthy updater ||'));
  check('15 existing unhealthy updater is detected', install.includes('service_healthy updater || { printf \'resume_recalculated_stage=%s'));
  check('16 updater is rebuilt when needed and recreated with edge', install.includes('RESUME_UPDATER_IMAGE_REBUILD=true')
    && install.includes('"${DEVFLOW_COMPOSE[@]}" build updater')
    && install.includes('"${DEVFLOW_COMPOSE[@]}" up -d edge updater --wait'));
  check('17 healthy backend is preserved on stage 14 resume', install.includes('service_healthy backend')
    && stage14.includes('run_edge_updater_stage') && !stage14.includes('up -d backend'));
  check('18 healthy frontend is preserved on stage 14 resume', install.includes('service_healthy frontend')
    && !stage14.includes('up -d frontend'));
  check('19 PostgreSQL is preserved on stage 14 resume', install.includes('service_healthy db')
    && !stage14.includes('up -d db'));
  check('20 migration is not duplicated on stage 14 resume', install.includes('RESUME_START_STAGE=11-migrations')
    && install.includes('[[ "$migration" == "${latest##*/}" ]]'));
  check('21 edge health is an explicit gate', stage14.includes("service_healthy edge || die 'Nginx nao ficou saudavel.'")
    && install.includes('"edge_healthy='));
  check('22 final health and state precede gate removal', finalStage.indexOf('curl --resolve')
    < finalStage.indexOf('write_installation_state')
    && finalStage.indexOf('write_installation_state') < finalStage.indexOf('rm -f -- "$INSTALLATION_GATE_FILE"')
    && finalStage.indexOf('rm -f -- "$INSTALLATION_GATE_FILE"') < finalStage.indexOf('commit_app_symlink'));
  check('23 updater accepts no arbitrary command', !daemon.includes('eval ') && !daemon.includes('bash -c')
    && requestValidator.includes("operation !== 'install-update'") && requestValidator.includes('timingSafeEqual'));

  const fullPassword = resolve(root, '..', 'FullPassword-reference');
  const forbiddenRuntimePaths = new RegExp(`/opt/${'full' + 'password'}|${'full' + 'password'}_${'n' + 'ginx'}`, 'iu');
  let fullPasswordSafe = !forbiddenRuntimePaths.test(install + daemon);
  if (existsSync(resolve(fullPassword, '.git'))) {
    const status = spawnSync('git', ['-C', fullPassword, 'status', '--porcelain=v1'], { encoding: 'utf8' });
    const head = spawnSync('git', ['-C', fullPassword, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    fullPasswordSafe = fullPasswordSafe && status.status === 0 && status.stdout.trim() === ''
      && head.status === 0 && head.stdout.trim() === '804008b5df5d0931ec5d95227fed44086f430d76';
  }
  check('24 Full Password remains uncoupled and unchanged when reference is present', fullPasswordSafe);

  if (checks.length !== 24) throw new Error(`Expected 24 checks, got ${checks.length}`);
  console.log(`Updater installation lifecycle validated: ${checks.length} mandatory scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
