#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const engine = read('scripts/update.sh');
const cli = read('scripts/update-cli.sh');
const daemon = read('scripts/updater-daemon.sh');
const bootstrap = read('scripts/update-bootstrap.sh');
const validator = read('scripts/validate-updater-request.mjs');
const statusWriter = read('scripts/write-update-status.mjs');
const service = read('backend/src/services/updateOperationService.js');
const routes = read('backend/src/routes/updateOperationRoutes.js');
const frontend = read('frontend/src/pages/Settings.jsx');
const migrate = read('backend/scripts/migrate.js');
const worker = read('backend/src/workers/emailWorker.js');
const emailOutbox = read('backend/src/services/emailOutboxService.js');
const common = read('scripts/lib/common.sh');

let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`update-workflow-check-failed:${name}`);
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
};

check('1 motor funciona sem TTY', !engine.includes('/dev/tty') && !engine.includes('-t 0') && !engine.includes('-t 1'));
check('2 motor nao solicita input', !engine.includes('require_numeric_confirmation application-update'));
check('3 remote HTTPS permitido', engine.includes("'https://github.com/trinityrrocha/DevFlow'"));
check('4 remote SSH permitido e demais recusados', engine.includes("'git@github.com:trinityrrocha/DevFlow.git'") && engine.includes('Remote origin nao autorizado'));
check('5 dirty Git bloqueia sem destruir', engine.includes('update_blocked=dirty-worktree') && engine.includes('--untracked-files=no') && !engine.includes('reset --hard') && !engine.includes('clean -fd'));
check('6 backup obrigatorio', engine.includes('scripts/backup.sh') && engine.indexOf('scripts/backup.sh') < engine.indexOf('UPDATE_PHASE=release'));
check('7 falha de backup interrompe', engine.includes("[[ -n \"$BACKUP_FILE\" && -s \"$BACKUP_FILE\" ]]") && engine.includes('verify-backup.sh'));
check('8 migrations aplicadas em ordem', migrate.includes('.sort(') && migrate.includes('schema_migrations'));
check('9 falha de migration aciona trap', engine.includes('run_devflow_migrations') && engine.includes('trap update_failed EXIT'));
check('10 servicos possuem allowlist', engine.includes('db|backend|frontend|worker|edge'));
check('11 servico invalido falha fechado', engine.includes('Servico de update nao autorizado'));
check('12 health final interno e publico', (engine.match(/scripts\/health\.sh/g) || []).length >= 4);
check('13 rollback automatico preservado', engine.includes('rollback_update') && engine.includes('ROLLBACK_ARMED=true'));
check('14 rollback incompleto nao e mascarado', engine.includes('ROLLBACK_RESULT=failed') && engine.includes('rollback_failures'));
check('15 worker participa e SMTP nao e gate', engine.includes('worker') && worker.includes('readyFile') && emailOutbox.includes('env.SMTP_ENABLED'));
check('16 CLI apresenta menu', cli.includes('1 - ATUALIZAR DEVFLOW') && cli.includes('2 - CANCELAR'));
check('17 CLI opcao 1 chama motor', cli.includes('1)') && cli.includes('"$ENGINE"'));
check('18 CLI opcao 2 cancela normalmente', cli.includes('operation_cancelled_by_user=true') && cli.includes('changes_applied=false'));
check('19 CLI repete input invalido', cli.includes('while true') && cli.includes('Opcao invalida'));
check('20 somente CLI usa dev tty', cli.includes('/dev/tty') && !engine.includes('/dev/tty'));
check('21 CLI check delega sem mutar', cli.includes('exec "$ENGINE" --check'));
check('22 daemon usa fila privada', ['REQUEST_DIR', 'PROCESSING_DIR', 'PROCESSED_DIR', 'FAILED_DIR'].every((item) => daemon.includes(item)));
check('23 daemon valida HMAC', daemon.includes('validate-updater-request.mjs') && validator.includes("createHmac('sha256'"));
check('24 request invalido vai para failed', daemon.includes('Solicitacao invalida recusada') && daemon.includes('FAILED_DIR'));
check('25 replay protection', validator.includes("fail('replay')") && validator.includes("resolve(root, 'processed'"));
check('26 lock atomico', daemon.includes('flock -n 8') && daemon.includes('update_in_progress=true'));
check('27 processing e recuperado', daemon.includes('for interrupted in "$PROCESSING_DIR"/*.json') && daemon.includes('pending'));
check('28 sucesso vai para processed', daemon.includes('PROCESSED_DIR/$name'));
check('29 falha vai para failed', daemon.includes('FAILED_DIR/$name'));
check('30 updater nao recria a si proprio', !engine.match(/build[^\n]*updater/u) && !daemon.includes("UPDATE_SERVICES='db backend frontend worker edge updater'"));
check('31 bootstrap baixa main atual', bootstrap.includes('git clone') && bootstrap.includes('--branch "$BRANCH"'));
check('32 bootstrap valida repository', bootstrap.includes('detected_remote') && bootstrap.includes('REPOSITORY'));
check('33 bootstrap valida commit e versao', bootstrap.includes('detected_commit') && bootstrap.includes('version='));
check('34 bootstrap executa CLI', bootstrap.includes('scripts/update-cli.sh'));
check('35 bootstrap propaga exit code', bootstrap.includes('exit "$status"'));
check('36 bootstrap remove temporario', bootstrap.includes('trap cleanup') && bootstrap.includes('rm -rf -- "$TEMP_ROOT"'));
check('37 sem shell arbitrario', validator.includes("operation !== 'install-update'") && !service.includes('exec(') && !service.includes('spawn('));
check('38 API nao controla servicos', !service.includes('UPDATE_SERVICES') && daemon.includes("UPDATE_SERVICES='db backend frontend worker edge'"));
check('39 logs e API sanitizados', common.includes('redact_stream') && service.includes('UPDATE_STATES') && !routes.includes('stdout'));
check('40 frontend confirma e acompanha status', frontend.includes('window.confirm') && frontend.includes('window.setInterval') && routes.includes("router.get('/requests/:id'"));

if (passed !== 40) throw new Error(`expected-40-checks:received-${passed}`);
process.stdout.write('update_workflow_contract=passed\n');
