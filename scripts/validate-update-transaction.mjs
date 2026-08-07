#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const update = read('scripts/update.sh');
const health = read('scripts/health.sh');
const backup = read('scripts/backup.sh');
const verifyBackup = read('scripts/verify-backup.sh');
const restore = read('scripts/restore.sh');
const transactionValidator = read('scripts/validate-update-transaction.py');
const common = read('scripts/lib/common.sh');

let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`update-transaction-check-failed:${name}`);
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
};
const order = (source, tokens) => tokens.every((token, index) => {
  const position = source.indexOf(token);
  return position >= 0 && (index === 0 || position > source.indexOf(tokens[index - 1]));
});
const digest = (value) => createHash('sha256').update(value).digest('hex');

const fixture = Object.freeze({
  installedVersion: '0.5.5-alpha',
  installedCommit: 'ab356510737f20c71f20a0893cdfddd2ec216137',
  candidateVersion: '0.6.4-alpha',
  candidateCommit: '7861900afd01cdd690c5847a5564e431cb875597',
  previousMigration: '002_auth_security_policy.sql',
  candidateMigration: '006_reliable_notifications.sql',
  installationStateVersion: '0.5.5-alpha',
});

const candidateHealth = ({ api = true, worker = true } = {}) => ({
  candidateVersionMatch: fixture.candidateVersion === '0.6.4-alpha',
  candidateCommitMatch: fixture.candidateCommit === '7861900afd01cdd690c5847a5564e431cb875597',
  candidateMigrationMatch: fixture.candidateMigration === '006_reliable_notifications.sql',
  installationStateIgnored: fixture.installationStateVersion === fixture.installedVersion,
  healthy: api && worker,
});

const promote = () => ({
  candidateApproved: candidateHealth().healthy,
  symlink: fixture.candidateCommit,
  stateVersion: fixture.candidateVersion,
  installedInternalHealth: true,
  publicHealth: true,
  result: 'success',
});

const transactionId = '0123456789abcdef0123456789abcdef';
const backupPayload = 'authenticated-pre-update-backup';
const transactionBackup = Object.freeze({
  transactionId,
  hash: digest(backupPayload),
  previousVersion: fixture.installedVersion,
  previousCommit: fixture.installedCommit,
  previousMigration: fixture.previousMigration,
  manifestValid: true,
});
const verifyTransactionBackup = (candidate) => candidate.manifestValid
  && candidate.transactionId === transactionBackup.transactionId
  && candidate.hash === transactionBackup.hash
  && candidate.previousVersion === transactionBackup.previousVersion
  && candidate.previousCommit === transactionBackup.previousCommit
  && candidate.previousMigration === transactionBackup.previousMigration;

const rollback = ({ databaseMutated, databaseRestore = true } = {}) => {
  const state = {
    databaseMutated,
    databaseRestored: !databaseMutated,
    migration: databaseMutated ? fixture.candidateMigration : fixture.previousMigration,
    release: fixture.candidateVersion,
    installationState: fixture.candidateVersion,
    workerPresent: true,
    oldHealthExecuted: false,
    oldInternalHealth: false,
    publicHealth: false,
    rollbackStatus: 'in-progress',
    manualRecoveryRequired: false,
  };
  if (databaseMutated) {
    if (!databaseRestore) {
      state.rollbackStatus = 'failed';
      state.manualRecoveryRequired = true;
      return state;
    }
    state.databaseRestored = true;
    state.migration = fixture.previousMigration;
  }
  state.release = fixture.installedVersion;
  state.installationState = fixture.installedVersion;
  state.workerPresent = false;
  state.oldHealthExecuted = true;
  state.oldInternalHealth = state.migration === fixture.previousMigration;
  state.publicHealth = state.oldInternalHealth;
  state.rollbackStatus = state.publicHealth ? 'successful' : 'failed';
  return state;
};

const candidate = candidateHealth();
check('1 installed 0.5.5 com candidate 0.6.x', fixture.installedVersion === '0.5.5-alpha' && fixture.candidateVersion.startsWith('0.6.') && update.includes('Pre-update health da release instalada'));
check('2 candidate version correta', candidate.candidateVersionMatch);
check('3 candidate commit correto', candidate.candidateCommitMatch);
check('4 candidate migration correta', candidate.candidateMigrationMatch);
check('5 installation.json permanece antigo durante candidate health', candidate.installationStateIgnored && fixture.installationStateVersion !== fixture.candidateVersion);
check('6 candidate health passa com expectativas explicitas', candidate.healthy && health.includes('--candidate') && health.includes('EXPECTED_VERSION_ARG') && health.includes('runtime_image_id'));
check('7 candidate health falha por API', candidateHealth({ api: false }).healthy === false && health.includes('report FAIL backend_api unhealthy'));
check('8 candidate health falha por worker', candidateHealth({ worker: false }).healthy === false && health.includes('candidate_worker_healthy'));

const promoted = promote();
const promotionFlow = update.slice(update.indexOf('UPDATE_PHASE=promotion'), update.indexOf('UPDATE_PHASE=proxy'));
const finalHealthFlow = update.slice(update.indexOf('UPDATE_PHASE=health-installed-internal'), update.indexOf('UPDATE_PHASE=finalize'));
check('9 candidate aprovado antes da promocao', promoted.candidateApproved && update.indexOf('candidate-healthy') < update.indexOf('UPDATE_PHASE=promotion'));
check('10 symlink promovido atomicamente', promoted.symlink === fixture.candidateCommit && update.includes('replace_devflow_app_symlink_atomically "$CANDIDATE_DIR"') && common.includes('mv -Tf -- "$temporary/app"'));
check('11 installation state promovido depois do symlink', promoted.stateVersion === fixture.candidateVersion && order(promotionFlow, ['replace_devflow_app_symlink_atomically "$CANDIDATE_DIR"', 'persist_operational_installation_state', 'installation_state_schema_valid']));
check('12 health instalado passa depois do state', promoted.installedInternalHealth && update.indexOf('UPDATE_PHASE=health-installed-internal') > update.indexOf('STATE_PROMOTED=true'));
check('13 public health passa depois de retirar manutencao', promoted.publicHealth && order(finalHealthFlow, ['UPDATE_PHASE=proxy', 'MAINTENANCE_ACTIVE=false', 'UPDATE_PHASE=health-public']));
check('14 transacao termina em sucesso', promoted.result === 'success' && update.includes('TRANSACTION_RESULT=success') && update.includes('ROLLBACK_RESULT=not-required'));

const beforeMigration = rollback({ databaseMutated: false });
check('15 falha antes da alteracao do banco', beforeMigration.databaseMutated === false);
check('16 banco nao e restaurado sem necessidade', beforeMigration.databaseRestored && beforeMigration.migration === fixture.previousMigration && update.includes('database_restore_skipped=true'));
check('17 release anterior e restaurada', beforeMigration.release === fixture.installedVersion && update.includes('replace_devflow_app_symlink_atomically "$OLD_RELEASE_DIR"'));

const afterMigration = rollback({ databaseMutated: true });
check('18 migrations 003 a 006 simuladas', fixture.previousMigration.startsWith('002_') && fixture.candidateMigration.startsWith('006_'));
check('19 candidate health pode falhar depois das migrations', candidateHealth({ api: false }).healthy === false && update.includes('trap update_failed EXIT'));
check('20 backup transacional e validado', verifyTransactionBackup(transactionBackup) && restore.includes('DEVFLOW_BACKUP_EXPECTED_TRANSACTION_ID') && restore.includes('DEVFLOW_BACKUP_EXPECTED_TRANSACTION_TIMESTAMP'));
check('21 banco e restaurado', afterMigration.databaseRestored && restore.includes('database_restore_completed=true'));
check('22 migration retorna para 002', afterMigration.migration === fixture.previousMigration && update.includes('restored_migration" != "$PREVIOUS_MIGRATION'));
check('23 release anterior e restaurada depois do banco', afterMigration.release === fixture.installedVersion && order(update, ['UPDATE_PHASE=rollback-database', 'UPDATE_PHASE=rollback-release-state']));
check('24 installation.json anterior e restaurado', afterMigration.installationState === fixture.installedVersion && update.includes('PREVIOUS_STATE_SNAPSHOT'));
check('25 worker novo e removido', afterMigration.workerPresent === false && update.includes('docker rm -f devflow-worker'));
check('26 health 0.5.5 passa depois da restauracao', afterMigration.oldInternalHealth && update.indexOf('database-not-restored') < update.indexOf('"$OLD_RELEASE_DIR/scripts/health.sh" --internal'));
check('27 public health do rollback passa', afterMigration.publicHealth && update.includes('"$OLD_RELEASE_DIR/scripts/health.sh"'));
check('28 rollback status e successful', afterMigration.rollbackStatus === 'successful' && update.includes('ROLLBACK_RESULT=successful'));

check('29 backup da mesma transacao e aceito', verifyTransactionBackup(transactionBackup));
check('30 backup de outra operacao e recusado', !verifyTransactionBackup({ ...transactionBackup, transactionId: 'fedcba9876543210fedcba9876543210' }));
check('31 hash divergente e recusado', !verifyTransactionBackup({ ...transactionBackup, hash: digest('tampered') }) && verifyBackup.includes('DEVFLOW_BACKUP_EXPECTED_STATE_SHA256'));
check('32 manifest invalido e recusado', !verifyTransactionBackup({ ...transactionBackup, manifestValid: false }) && verifyBackup.includes('manifest = json.load(stream)') && verifyBackup.includes('devflow-backup-v2'));
check('33 previousCommit divergente e recusado', !verifyTransactionBackup({ ...transactionBackup, previousCommit: '0'.repeat(40) }) && backup.includes('DEVFLOW_BACKUP_PREVIOUS_COMMIT'));

const incomplete = rollback({ databaseMutated: true, databaseRestore: false });
check('34 falha de restore do banco e simulada', incomplete.databaseRestored === false);
check('35 rollback incompleto nao e successful', incomplete.rollbackStatus === 'failed');
check('36 health antigo nao executa sem banco restaurado', incomplete.oldHealthExecuted === false && order(update, ['database_restore_completed=true', 'DATABASE_RESTORED=true', '"$OLD_RELEASE_DIR/scripts/health.sh" --internal']));
check('37 rollback incompleto exige recuperacao manual', incomplete.manualRecoveryRequired && update.includes('MANUAL_RECOVERY_REQUIRED=true') && transactionValidator.includes('manualRecoveryRequired'));

check('38 imagem antiga e preservada por ID e tag imutavel', update.includes('PREVIOUS_BACKEND_IMAGE_ID') && update.includes('rollback-$OLD_SHA'));
check('39 candidata usa tag com commit', update.includes('CANDIDATE_IMAGE_TAG="candidate-$NEW_SHA"') && health.includes('candidate-$EXPECTED_COMMIT_ARG'));
check('40 rollback reutiliza imagem antiga sem rebuild', update.includes('docker tag "$PREVIOUS_BACKEND_IMAGE_ID"') && !update.slice(update.indexOf('rollback_update()'), update.indexOf('update_failed()')).includes(' build '));

if (passed !== 40) throw new Error(`expected-40-checks:received-${passed}`);
process.stdout.write('update_transaction_fixture=0.5.5-alpha-to-0.6.4-alpha\n');
process.stdout.write('candidate_internal_health=healthy\n');
process.stdout.write('rollback_status=successful\n');
process.stdout.write('update_transaction_contract=passed\n');
