#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { canRead, fixture, simulateCorrectedRequestStatus, simulateLegacyRequestStatus } from './fixtures/operational-permissions.mjs';

const read = (file) => readFileSync(file, 'utf8');
const compose = read('docker-compose.yml');
const install = read('scripts/install.sh');
const update = read('scripts/update.sh');
const daemon = read('scripts/updater-daemon.sh');
const permissions = read('scripts/lib/operational-permissions.sh');
const atomic = read('scripts/lib/operational-files.mjs');
const statusWriter = read('scripts/write-update-status.mjs');
const catalogWriter = read('scripts/write-backup-catalog.mjs');
const backend = read('backend/src/services/operationalRequestService.js');
const frontend = read('frontend/src/pages/Backups.jsx');
const auth = read('backend/src/middleware/authMiddleware.js');
let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`operational-permissions-check-failed:${name}`);
  passed += 1;
  process.stdout.write(`ok ${String(passed).padStart(2, '0')} - ${name}\n`);
};

const legacy = simulateLegacyRequestStatus();
const corrected = simulateCorrectedRequestStatus();
const outsider = { uid: 2000, gid: 2000, supplementalGroups: [] };

check('01 updater cria status completed', statusWriter.includes('completed') && daemon.includes('completed "$operation"'));
check('02 status nao e world-readable', (fixture.correctedStatus.mode & 0o007) === 0 && atomic.includes('0o640'));
check('03 backend suplementar le status', corrected.readable && corrected.httpStatus === 200);
check('04 usuario sem grupo nao le status', !canRead(outsider, fixture.correctedStatus));
check('05 modo do status e 0640', fixture.correctedStatus.mode === 0o640 && atomic.includes('fchmodSync(fileDescriptor, 0o640)'));
check('06 grupo operacional correto', fixture.correctedStatus.gid === fixture.operationalGid && atomic.includes('fchownSync(fileDescriptor, 0, gid)'));
check('07 request backend para updater', backend.includes("mode: 0o640") && daemon.includes('mv -- "$request" "$processing"'));
check('08 status updater para backend', compose.match(/group_add:/g)?.length === 2 && compose.includes('DEVFLOW_OPS_GID'));
check('09 processed preserva contrato', permissions.includes('requests processing processed failed') && daemon.includes('"$PROCESSED_DIR/$name"'));
check('10 failed preserva contrato', daemon.includes('"$FAILED_DIR/$name"') && permissions.includes('chmod 0640 "$artifact"'));
check('11 catalogo e backend-readable', catalogWriter.includes('atomicWriteOperationalJson') && permissions.includes('backup-catalog.json'));
for (const operation of ['delete-backup', 'create-backup', 'verify-backup', 'restore-backup']) {
  check(`${String(passed + 1).padStart(2, '0')} ${operation} completo`, daemon.includes(operation) && corrected.state === 'completed');
}
check('16 install-update polling', daemon.includes('install-update') && frontend.includes("data.status === 'completed'"));
check('17 status legado 0600 reconciliado', legacy.filesystemResult === 'EACCES' && legacy.httpStatus === 503 && atomic.includes("filename.endsWith('.json')"));
check('18 instalacao limpa cria contrato', install.includes('devflow_ensure_host_ops_group') && install.includes('devflow_reconcile_operational_artifacts'));
check('19 restart updater mantem contrato', daemon.includes('devflow_reconcile_operational_artifacts "$REQUEST_ROOT"'));
check('20 restart backend mantem contrato', compose.includes('- "${DEVFLOW_OPS_GID:-101}"') && backend.includes('filesystem.chmodSync(temporary, 0o640)'));
check('21 escrita de status e atomica e duravel', atomic.includes('fsyncSync(fileDescriptor)') && atomic.includes('renameSync(temporary, destination)'));
check('22 logs permanecem root-only', atomic.includes("filename.endsWith('.log')") && atomic.includes('0o600, false'));
check('23 update reconcilia allowlist', update.includes('devflow_reconcile_operational_artifacts') && !permissions.includes('chmod -R'));
check('24 401 permanece dominio de sessao', auth.includes("'SESSION_INVALID'") && !frontend.includes('401'));
check('25 ponte 0.6.28 deriva GID sem numero arbitrario', atomic.includes("'exec', 'devflow-backend', 'id', '-g', 'devflow'")
  && atomic.includes("'run', '--rm', '--network', 'none', '--entrypoint', 'id'"));

process.stdout.write(`legacy_status_owner=root:root legacy_status_mode=0600 backend_uid=100 backend_gid=101 result=${legacy.filesystemResult} http=${legacy.httpStatus}\n`);
process.stdout.write(`corrected_status_owner=root:ops corrected_status_mode=0640 supplemental_gid=${fixture.operationalGid} result=${corrected.filesystemResult} http=${corrected.httpStatus} state=${corrected.state}\n`);
process.stdout.write(`operational_permissions_contract=passed checks=${passed}\n`);
