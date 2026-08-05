import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap.sh'), 'utf8');
const install = readFileSync(resolve(root, 'scripts/install.sh'), 'utf8');
const bash = process.env.DEVFLOW_TEST_BASH
  || (process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-bootstrap-interface-'));
const fixture = resolve(temporary, 'helpers.sh');
const helperStart = bootstrap.indexOf('select_public_mode()');
const helperEnd = bootstrap.indexOf('\nusage() {', helperStart);
const contractStart = install.indexOf('validate_noninteractive_install_contract()');
const contractEnd = install.indexOf('\nvalidate_noninteractive_install_contract\n', contractStart)
  + '\nvalidate_noninteractive_install_contract\n'.length;
if (helperStart < 0 || helperEnd < 0 || contractStart < 0 || contractEnd < 0) {
  throw new Error('Bootstrap interface helpers were not found.');
}
writeFileSync(fixture, `log() { printf 'bootstrap-log:%s\\n' "$*" >&2; }\n${bootstrap.slice(helperStart, helperEnd)}\n${install.slice(contractStart, contractEnd)}\n`);

const run = (body) => spawnSync(bash, ['-c', `source "$1"; shift; ${body}`, '_', fixture], { encoding: 'utf8' });
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Bootstrap interface test failed: ${label}`);
  checks.push(label);
};

try {
  const noArguments = run('SELECTED_MODE=; FORWARDED_ARGS=(); select_public_mode; printf "mode=%s\\nargs=%s\\n" "$SELECTED_MODE" "${FORWARDED_ARGS[*]}"');
  const vpsRegression = run('fake_installer(){ if [[ "${1:-}" == --install ]]; then printf "installation_started=true\\n"; return 0; fi; printf "preflight=passed\\nchanges_applied=false\\n"; }; SELECTED_MODE=; FORWARDED_ARGS=(); select_public_mode; run_internal_installer fake_installer "${FORWARDED_ARGS[@]}"');
  check('01 no arguments selects interactive install', noArguments.status === 0
    && noArguments.stdout.includes('mode=install') && noArguments.stdout.includes('args=--install')
    && vpsRegression.status === 0 && vpsRegression.stdout.includes('installation_started=true')
    && !vpsRegression.stdout.includes('preflight=passed') && !vpsRegression.stdout.includes('changes_applied=false')
    && bootstrap.includes('run_internal_installer "$CHECKOUT/scripts/install.sh" "${FORWARDED_ARGS[@]}"')
    && install.includes('Dominio do DevFlow:') && install.includes('E-mail administrativo:')
    && install.includes("'INSTALAR DEVFLOW' 'CANCELAR'") && install.includes('external-firewall'));

  const cancelled = run('cancel_installer(){ printf "changes_applied=false\\n"; return 20; }; SELECTED_MODE=install; run_internal_installer cancel_installer');
  check('02 cancellation is successful and non-mutating', cancelled.status === 0
    && cancelled.stdout.includes('changes_applied=false') && !cancelled.stdout.includes('concluída')
    && install.includes("cancel_installation 'Instalacao cancelada.'"));

  const checkMode = run('SELECTED_MODE=check; FORWARDED_ARGS=(--check); select_public_mode; printf "%s|%s" "$SELECTED_MODE" "${FORWARDED_ARGS[*]}"');
  check('03 check remains check', checkMode.status === 0 && checkMode.stdout === 'check|--check'
    && install.includes("'mode=check\\ninstallation_mode=isolated"));

  const dryRunMode = run('SELECTED_MODE=dry-run; FORWARDED_ARGS=(--dry-run); select_public_mode; printf "%s|%s" "$SELECTED_MODE" "${FORWARDED_ARGS[*]}"');
  check('04 dry-run remains dry-run', dryRunMode.status === 0 && dryRunMode.stdout === 'dry-run|--dry-run'
    && install.includes("'mode=dry-run'"));

  const explicitInstall = run('SELECTED_MODE=install; FORWARDED_ARGS=(--install); select_public_mode; printf "%s|%s" "$SELECTED_MODE" "${FORWARDED_ARGS[*]}"');
  check('05 explicit install remains install', explicitInstall.status === 0 && explicitInstall.stdout === 'install|--install');

  const resumeMode = run('SELECTED_MODE=resume; FORWARDED_ARGS=(--resume); select_public_mode; printf "%s|%s" "$SELECTED_MODE" "${FORWARDED_ARGS[*]}"');
  check('06 resume remains resume', resumeMode.status === 0 && resumeMode.stdout === 'resume|--resume');

  const incomplete = run('die(){ printf "ERRO:%s\\n" "$*" >&2; return 41; }; MODE=install; DOMAIN=; ADMIN_EMAIL_INPUT=; FIREWALL_CONFIRMED=false; validate_noninteractive_install_contract');
  check('07 incomplete noninteractive install fails before mutation', incomplete.status === 41
    && incomplete.stderr.includes('--domain, --admin-email e --firewall-confirmed'));

  const complete = run('die(){ return 41; }; MODE=install; DOMAIN=dev.example.com; ADMIN_EMAIL_INPUT=admin@example.com; FIREWALL_CONFIRMED=true; validate_noninteractive_install_contract; printf complete');
  check('08 complete noninteractive install is accepted', complete.status === 0 && complete.stdout === 'complete');

  const failed = run('fail_installer(){ return 23; }; SELECTED_MODE=install; run_internal_installer fail_installer');
  check('09 internal failure propagates status without success', failed.status === 23
    && failed.stderr.includes('status=23') && !failed.stdout.includes('concluída'));

  const messages = run("for mode in check dry-run install resume; do printf '%s:' \"$mode\"; bootstrap_success_message \"$mode\" | tr '\\n' '|'; echo; done");
  check('10 check and dry-run report completion while install and resume remain silent', messages.status === 0
    && messages.stdout.includes('check:Bootstrap de verificação concluído.|Nenhuma alteração foi aplicada.|')
    && messages.stdout.includes('dry-run:Simulação concluída.|Nenhuma alteração foi aplicada.|')
    && messages.stdout.includes('install:\n')
    && messages.stdout.includes('resume:\n'));

  console.log(`Bootstrap interface validated: ${checks.length} scenarios, including no-argument --install forwarding.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
