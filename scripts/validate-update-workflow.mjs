#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const update = read('scripts/update.sh');
const daemon = read('scripts/updater-daemon.sh');
const validator = read('scripts/validate-updater-request.mjs');
const backupOperation = read('scripts/backup-operation.sh');
const verify = read('scripts/verify-backup.sh');
const restore = read('scripts/restore.sh');
const service = read('backend/src/services/operationalRequestService.js');
const backupService = read('backend/src/services/backupOperationService.js');
const backupController = read('backend/src/controllers/backupOperationController.js');
const backupRoutes = read('backend/src/routes/backupOperationRoutes.js');
const frontend = read('frontend/src/pages/Backups.jsx');
const settings = read('frontend/src/pages/Settings.jsx');

let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`operational-workflow-check-failed:${name}`);
  process.stdout.write(`ok ${++passed} - ${name}\n`);
};
const updateMutation = update.slice(update.indexOf("log WARN 'O update nao cria backup"));

check('1 request web protegido', backupRoutes.includes('requireAuth, requireSuperAdmin'));
check('2 HMAC preservado', service.includes("createHmac('sha256'"));
check('3 fila privada atomica', service.includes("flag: 'wx'") && service.includes('renameSync(temporary, destination)'));
check('4 daemon valida e despacha allowlist', daemon.includes('validate-updater-request.mjs') && daemon.includes('create-backup|verify-backup|restore-backup|delete-backup'));
check('5 pre-health antes da release', update.indexOf('Pre-update health') < update.indexOf('UPDATE_PHASE=release'));
check('6 deteccao de update e changelog', update.includes('available_version=') && update.includes('CHANGELOG_SECTION'));
check('7 update nao cria backup automatico', !updateMutation.includes('"$SCRIPT_DIR/backup.sh"'));
check('8 update nao verifica backup automatico', !updateMutation.includes('"$SCRIPT_DIR/verify-backup.sh"'));
check('9 release candidata validada', update.includes('candidate-healthy') && update.includes('CANDIDATE_IMAGE_TAG'));
check('10 promocao atomica', update.includes('replace_devflow_app_symlink_atomically "$CANDIDATE_DIR"'));
check('11 health final interno e publico', update.includes('UPDATE_PHASE=health-installed-internal') && update.includes('UPDATE_PHASE=health-public'));
check('12 listagem por catalogo sanitizado', backupService.includes('BACKUP_FILENAME') && backupService.includes('isSymbolicLink'));
check('13 criacao usa script oficial', backupOperation.includes('"$SCRIPT_DIR/backup.sh"'));
check('14 falha operacional vai para failed', daemon.includes('FAILED_DIR/$name'));
check('15 verificacao usa script oficial', backupOperation.includes('"$SCRIPT_DIR/verify-backup.sh"'));
check('16 backup corrompido falha fechado', verify.includes('sha256sum -c checksums.sha256'));
check('17 restore exige confirmacao forte', backupController.includes("confirmation !== 'RESTAURAR'"));
check('18 restore usa script oficial e backup de seguranca', backupOperation.includes('safety_backup') && backupOperation.includes('"$SCRIPT_DIR/restore.sh"'));
check('19 falha de restore tenta safety backup', backupOperation.includes('safety_restore_status'));
check('20 delete exato sem glob', backupOperation.includes('rm -- "$backup_file"') && !backupOperation.includes('rm -rf -- "$backup_file"'));
check('21 id opaco validado', service.includes('BACKUP_ID_PATTERN'));
check('22 traversal sem path do cliente', !backupController.includes('req.body.path') && !backupOperation.includes('$3'));
check('23 symlink recusado', backupService.includes('stat.isSymbolicLink') && read('scripts/resolve-backup-id.mjs').includes('stat.isSymbolicLink'));
check('24 somente Super Admin', backupRoutes.includes('requireSuperAdmin'));
check('25 CSRF global e rate limit local', backupRoutes.includes('sensitiveLimiter'));
check('26 eventos de auditoria', ['BACKUP_CREATED', 'BACKUP_VERIFIED', 'BACKUP_RESTORED', 'BACKUP_DELETED', 'BACKUP_FAILED', 'RESTORE_FAILED'].every((event) => backupController.includes(event)));
check('27 lock operacional global', daemon.includes('/run/lock/devflow/operations.lock') && read('scripts/backup.sh').includes('/run/lock/devflow/operations.lock'));
check('28 retencao exibida', frontend.includes('Retencao automatica:') && backupService.includes('BACKUP_RETENTION_DAYS'));
check('29 namespace compartilhado sem /tmp privado', verify.includes('TEMP_ROOT=/opt/devflow/tmp') && !verify.includes('${TMPDIR:-/tmp}'));
check('30 aviso de backup sem gate', settings.includes('O processo de atualizacao nao cria backup automaticamente.') && !settings.includes('backupAge'));
check('31 polling operacional', frontend.includes('window.setInterval(poll, 4000)'));
check('32 restore temp tambem compartilhado', restore.includes('TEMP_ROOT=/opt/devflow/tmp'));

process.stdout.write(`operational_workflow_contract=passed checks=${passed}\n`);
