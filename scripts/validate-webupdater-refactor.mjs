#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fixture, simulateLegacyAfterPull, simulateNewFlow } from './fixtures/webupdater-0.6.26.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const update = read('scripts/update.sh');
const daemon = read('scripts/updater-daemon.sh');
const requestValidator = read('scripts/validate-updater-request.mjs');
const operationService = read('backend/src/services/operationalRequestService.js');
const updateService = read('backend/src/services/updateOperationService.js');
const settings = read('frontend/src/pages/Settings.jsx');
const layout = read('frontend/src/layouts/DashboardLayout.jsx');
const version = read('scripts/version.sh');
const health = read('scripts/health.sh');
const compose = read('docker-compose.yml');
const index = read('frontend/index.html');

const oldFailure = simulateLegacyAfterPull({ certificateMounted: false });
const newSuccess = simulateNewFlow({});
let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`webupdater-refactor-check-failed:${name}`);
  process.stdout.write(`ok ${++passed} - ${name}\n`);
};

check('1 check update sem update', simulateNewFlow({ installed: fixture.availableCommit, available: fixture.availableCommit }).result === 'current');
check('2 check com update disponivel', newSuccess.result === 'completed');
check('3 changelog ausente nao bloqueia', updateService.includes('if (checkAvailable)') && updateService.includes("changelog = ''"));
check('4 changelog invalido nao bloqueia', updateService.indexOf('checkAvailable = true') < updateService.lastIndexOf('changelog = changelogSection'));
check('5 update continua sem changelog', !update.includes('CHANGELOG') && newSuccess.steps.includes('build'));
check('6 versao instalada exposta', updateService.includes('installedVersion: env.DEVFLOW_VERSION'));
check('7 versao disponivel por VERSION e commit', updateService.includes('/VERSION') && updateService.includes('/commits/main'));
check('8 request Web protegido', updateService.includes("operation: 'install-update'") && operationService.includes("createHmac('sha256',"));
check('9 fila atomica', operationService.includes("flag: 'wx'") && operationService.includes('renameSync(temporary, destination)'));
check('10 HMAC nonce e replay', requestValidator.includes('timingSafeEqual') && requestValidator.includes('nonce') && requestValidator.includes('replay'));
check('11 daemon valida e processa', daemon.includes('validate-updater-request.mjs') && daemon.includes('scripts/update.sh'));
check('12 lock global', daemon.includes('/run/lock/devflow/operations.lock') && update.includes('flock -n 9'));
check('13 pre-health antes do Git', update.indexOf('Pre-update health') < update.indexOf('git clone --quiet'));
check('14 git fetch', update.includes('fetch origin main'));
check('15 checkout main', update.includes('checkout main'));
check('16 pull fast-forward', update.includes('pull --ff-only origin main'));
check('17 build allowlist fixa', update.includes('build backend frontend updater') && !update.includes('for service in $UPDATE_SERVICES'));
check('18 migrations sob o mesmo lock', update.includes('run_devflow_migrations') && update.indexOf('flock -n 9') < update.indexOf('run_devflow_migrations'));
check('19 compose up sem updater', update.includes('up -d --wait --remove-orphans db backend worker frontend edge'));
check('20 backend healthy', health.includes('backend:backend_image') && compose.includes('container_name: devflow-backend'));
check('21 worker healthy', health.includes('worker:worker_image') && compose.includes('container_name: devflow-worker'));
check('22 frontend healthy', health.includes('frontend:frontend_image') && compose.includes('container_name: devflow-frontend'));
check('23 nginx healthy', health.includes('edge:nginx_image') && compose.includes('container_name: devflow-nginx'));
check('24 final health', update.includes('CURRENT_STEP=final-health') && update.includes('run_context_health "$NEW_RELEASE_DIR"'));
check('25 installation identity atomica', update.includes('replace_devflow_app_symlink_atomically') && update.includes('write_installation_state'));
check('26 updater permanece ativo', update.includes('docker exec devflow-updater test') && !update.includes('up -d --wait --no-deps --force-recreate updater'));
check('27 frontend tolera indisponibilidade', settings.includes('isTransientUpdatePollingError') && settings.includes("api.get('/health', { timeout: 3000 })"));
check('28 notificacoes pausam durante update', layout.includes("sessionStorage.getItem('devflow:update-active')"));
check('29 success completed', update.includes('write_status completed') && daemon.includes('PROCESSED_DIR/$name'));
check('30 failed claro', update.includes('write_status failed') && daemon.includes('FAILED_DIR/$name'));
check('31 rollback antes de migrations', simulateNewFlow({ failAt: 'build' }).manualRecoveryRequired === false);
check('32 rollback apos container failure', simulateNewFlow({ failAt: 'compose-up' }).manualRecoveryRequired === true);
check('33 rollback restaura tag normal, source e version identity', simulateNewFlow({ failAt: 'compose-up' }).imageTag === `release-${fixture.installedCommit}` && update.includes('restore_source_checkout') && version.includes('active_release='));
check('34 maintenance nao participa do update', !update.includes('docker-compose.maintenance.yml') && !update.includes('devflow-maintenance'));
check('35 nenhuma tag temporaria orfa', update.includes('remove_temporary_images') && !update.includes('CANDIDATE_IMAGE_TAG'));
check('36 CSP sem inline', index.includes('src="/theme-bootstrap.js"') && !index.includes('<script>'));
check('37 theme bootstrap servido', read('frontend/public/theme-bootstrap.js').includes('localStorage'));
check('38 fixture 0.6.26 prova falha antiga e fluxo novo', oldFailure.exitCode === 1 && oldFailure.realFailedPhase === 'source' && oldFailure.displayedPhase === 'rollback-started' && newSuccess.steps.slice(0, 4).join(',') === 'pre-health,git-fetch,git-checkout,git-pull' && newSuccess.result === 'completed');

process.stdout.write(`webupdater_refactor_contract=passed checks=${passed}\n`);
process.stdout.write(`legacy_failure_exit_code=${oldFailure.exitCode} legacy_real_phase=${oldFailure.realFailedPhase} legacy_displayed_phase=${oldFailure.displayedPhase}\n`);
process.stdout.write(`fixture_transition=${fixture.installedVersion}->${fixture.availableVersion} simulated_result=${newSuccess.result}\n`);
