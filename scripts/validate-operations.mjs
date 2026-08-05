import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const install = read('scripts/install.sh');
const bootstrap = read('scripts/bootstrap.sh');
const update = read('scripts/update.sh');
const operation = read('scripts/update-operation.sh');
const restore = read('scripts/restore.sh');
const health = read('scripts/health.sh');
const daemon = read('scripts/updater-daemon.sh');
const requestValidator = read('scripts/validate-updater-request.mjs');
const updateService = read('backend/src/services/updateOperationService.js');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Operations validation failed: ${label}`);
  checks.push(label);
};

check('installer does not update', !/--update|MODE.*update|install\.sh --update/u.test(install));
check('bootstrap uses canonical public repository', bootstrap.includes("REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'"));
check('bootstrap validates remote commit', bootstrap.includes('REMOTE_COMMIT') && bootstrap.includes('fsck --strict'));
check('bootstrap validates version contract', bootstrap.includes('devflow_validate_checkout_version_consistency'));
check('installer supports check dry-run install resume', ['--check', '--dry-run', '--install', '--resume'].every((flag) => install.includes(flag)));
check('common flow asks only domain and admin email', install.includes('Dominio do DevFlow:') && install.includes('E-mail administrativo:'));
check('numeric confirmation is used', install.includes('prompt_numeric_confirmation initial-installation'));
check('dry-run precedes persistent directories', install.indexOf('if [[ "$MODE" == dry-run ]]') < install.indexOf('install -d -m 0750 "$DEVFLOW_INSTALL_ROOT"'));
check('old parameters fail explicitly', install.includes('foi descontinuado') && install.includes('--proxy-mode'));
check('updater has exclusive lock', update.includes('flock -n'));
check('updater checks canonical remote', update.includes('trinityrrocha/DevFlow'));
check('updater displays version and changelog', update.includes('Versão instalada:') && update.includes('CHANGELOG_SECTION'));
check('updater verifies backup', update.includes('backup.sh') && update.includes('verify-backup.sh'));
check('updater enters maintenance', update.includes('enter_maintenance'));
check('updater applies migrations', update.includes('run_devflow_migrations'));
check('updater validates internal and external health', update.includes('health.sh" --internal')
  && (update.match(/DEVFLOW_HEALTH_ALLOW_PENDING_VERSION=true/g) || []).length === 2
  && health.includes('skipped-maintenance') && health.includes('ALLOW_PENDING_STATE'));
check('updater rolls back automatically', update.includes('rollback_update') && update.includes('restore.sh'));
check('restore supports coordinated rollback', restore.includes('DEVFLOW_RESTORE_NO_START'));
check('all update entrypoints delegate to single motor', operation.includes('exec "$SCRIPT_DIR/update.sh"')
  && daemon.includes('scripts/update.sh') && !daemon.includes('install.sh'));
check('private queue requires signed allowlisted requests', updateService.includes("createHmac('sha256'")
  && requestValidator.includes("operation !== 'install-update'") && requestValidator.includes('timingSafeEqual'));
check('health is isolated and externally published', health.includes('installation_mode=isolated') && health.includes('external_publication_enabled=true'));

console.log(`Isolated operational flows validated: ${checks.length} checks.`);
