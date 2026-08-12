#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const update = read('scripts/update.sh');
const schema = read('scripts/validate-update-transaction.py');
let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`update-transaction-check-failed:${name}`);
  process.stdout.write(`ok ${++passed} - ${name}\n`);
};
const rollback = update.slice(update.indexOf('rollback_update()'), update.indexOf('update_failed()'));
const normal = update.slice(update.indexOf("log WARN 'O update nao cria backup"));

check('schema transacional v3', update.includes('"schemaVersion": 3') && schema.includes('schemaVersion must be 3'));
check('snapshot de installation json preservado', update.includes('PREVIOUS_STATE_SNAPSHOT') && update.includes('PREVIOUS_STATE_HASH'));
check('imagens anteriores preservadas por id', update.includes('PREVIOUS_BACKEND_IMAGE_ID') && update.includes('rollback-$OLD_SHA'));
check('update normal nao chama backup', !normal.includes('"$SCRIPT_DIR/backup.sh"'));
check('update normal nao chama verify', !normal.includes('"$SCRIPT_DIR/verify-backup.sh"'));
check('rollback nao chama restore de dados', !rollback.includes('restore.sh'));
check('database mutation registrada conservadoramente', update.includes('DATABASE_MUTATED=true'));
check('restore manual possivelmente necessario registrado', update.includes('MANUAL_DATA_RESTORE_MAY_BE_REQUIRED=true'));
check('schema exige flag quando banco mutado', schema.includes('database mutation must flag possible manual data restore'));
check('release anterior restaurada atomicamente', rollback.includes('replace_devflow_app_symlink_atomically "$OLD_RELEASE_DIR"'));
check('installation json anterior restaurado', rollback.includes('installation.json'));
check('containers anteriores usam imagens preservadas', rollback.includes('docker tag "$PREVIOUS_BACKEND_IMAGE_ID"'));
check('health da release anterior decide compatibilidade', rollback.includes('"$OLD_RELEASE_DIR/scripts/health.sh" --internal'));
check('health incompatível exige recuperacao manual', rollback.includes('MANUAL_RECOVERY_REQUIRED=true'));
check('falha deixa diagnostico explicito', update.includes('manual_data_restore_may_be_required='));
check('sem down migrations', !update.includes('down migration') && !update.includes('migrate down'));
check('promocao somente apos candidate health', update.indexOf('candidate-healthy') < update.indexOf('UPDATE_PHASE=promotion'));
check('resultado sucesso exige health e state', schema.includes('successful transaction is incomplete'));

process.stdout.write(`update_transaction_contract=passed checks=${passed}\n`);
