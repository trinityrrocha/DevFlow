import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const bash = process.env.DEVFLOW_TEST_BASH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const bashPath = (value) => process.platform === 'win32'
  ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : value;
const commonPath = bashPath(resolve(root, 'scripts/lib/common.sh'));
const install = read('scripts/install.sh');
const common = read('scripts/lib/common.sh');
const allScripts = [common, install, read('scripts/update.sh'), read('scripts/publish.sh'),
  read('scripts/uninstall.sh'), read('scripts/migrate-proxy-to-host-nginx.sh')].join('\n');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Interactive menu test failed: ${label}`);
  checks.push(label);
};
const runMenu = (input, extra = '') => spawnSync(bash, ['-c', `
  source "$1"
  is_interactive_terminal() { return 0; }
  ${extra}
  status=0
  prompt_numeric_confirmation test-prompt 'Menu de teste.' 'EXECUTAR TESTE' || status=$?
  printf '\nstatus=%s\n' "$status"
`, '_', commonPath], { input, encoding: 'utf8', env: { ...process.env, DB_PASSWORD: 'NEVER_PRINT_THIS_SECRET' } });

const chooseOne = runMenu('1\n');
const chooseTwo = runMenu('2\n');
const emptyThenOne = runMenu('\n1\n');
const textThenOne = runMenu('texto\n1\n');
const zeroThenOne = runMenu('0\n1\n');
const threeThenOne = runMenu('3\n1\n');
const invalidThenOne = runMenu('x\n1\n');
const invalidThenTwo = runMenu('x\n2\n');
const noTty = spawnSync(bash, ['-c', `source "$1"; status=0; prompt_numeric_confirmation test 'Teste.' 'EXECUTAR' || status=$?; printf 'status=%s\n' "$status"`, '_', commonPath], { encoding: 'utf8' });
const interrupted = runMenu('', 'read() { return 130; }');
const marker = resolve(root, '.menu-must-not-change');
rmSync(marker, { force: true });
const cancellation = spawnSync(bash, ['-c', `
  source "$1"; is_interactive_terminal() { return 0; }
  require_numeric_confirmation cancellation 'Teste.' 'ALTERAR'
  touch "$2"
`, '_', commonPath, bashPath(marker)], { input: '2\n', encoding: 'utf8' });

check('choice 1 proceeds', chooseOne.stdout.includes('status=0') && chooseOne.stdout.includes('confirmation_choice=1'));
check('choice 2 cancels', chooseTwo.stdout.includes('status=10') && chooseTwo.stdout.includes('confirmation_choice=2'));
check('empty input repeats', emptyThenOne.stdout.includes('Opção inválida') && emptyThenOne.stdout.includes('status=0'));
check('text input repeats', textThenOne.stdout.includes('Opção inválida') && textThenOne.stdout.includes('status=0'));
check('zero input repeats', zeroThenOne.stdout.includes('Opção inválida') && zeroThenOne.stdout.includes('status=0'));
check('choice 3 repeats in two-choice menu', threeThenOne.stdout.includes('Opção inválida') && threeThenOne.stdout.includes('status=0'));
check('invalid then 1 proceeds', invalidThenOne.stdout.includes('Opção inválida') && invalidThenOne.stdout.includes('confirmation_choice=1'));
check('invalid then 2 cancels', invalidThenTwo.stdout.includes('Opção inválida') && invalidThenTwo.stdout.includes('confirmation_choice=2'));
check('non-TTY fails closed', noTty.stdout.includes('interactive_confirmation_required=true')
  && noTty.stdout.includes('operation_cancelled=true') && noTty.stdout.includes('changes_applied=false')
  && noTty.stdout.includes('status=11'));
check('Ctrl+C is represented by controlled status 130', interrupted.stdout.includes('status=130'));
check('cancellation applies no change', cancellation.status === 0 && !existsSync(marker)
  && cancellation.stdout.includes('Operação cancelada pelo usuário.')
  && cancellation.stdout.includes('Nenhuma alteração foi aplicada.'));
check('old textual confirmation implementation is absent', !allScripts.includes('confirm_exact')
  && !allScripts.includes('Digite exatamente') && !allScripts.includes('Confirme escrevendo')
  && !allScripts.includes('Digite a frase'));
check('initial installation uses required numeric menu', install.includes("'A instalação interna do DevFlow está pronta.'")
  && install.includes("'INSTALAR DEVFLOW'"));
check('configuration recovery uses required numeric menu', install.includes("'Configuração parcial inválida detectada.'")
  && install.includes("'REGERAR CONFIGURAÇÃO DEVFLOW'"));
check('resume uses required numeric menu', install.includes("'Instalação incompleta encontrada.'")
  && install.includes("'RETOMAR INSTALAÇÃO DO DEVFLOW'"));
check('menus never print environment secrets', !chooseOne.stdout.includes('NEVER_PRINT_THIS_SECRET')
  && !noTty.stdout.includes('NEVER_PRINT_THIS_SECRET') && common.includes('confirmation_choice=$choice'));

rmSync(marker, { force: true });
if (checks.length !== 16) throw new Error(`Expected 16 checks, got ${checks.length}`);
console.log(`Interactive menu tests passed: ${checks.length} scenarios.`);
