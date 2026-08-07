import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const install = read('scripts/install.sh');
const uninstall = read('scripts/uninstall.sh');
const common = read('scripts/lib/common.sh');
const updateCli = read('scripts/update-cli.sh');
const update = read('scripts/update.sh');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Interactive menu test failed: ${label}`);
  checks.push(label);
};

check('installation menu has numeric options', common.includes('Escolha [1/2]:'));
check('installation primary action is explicit', install.includes("'INSTALAR DEVFLOW' 'CANCELAR'"));
check('domain prompt is singular', (install.match(/Dominio do DevFlow:/g) || []).length === 1);
check('email prompt is singular', (install.match(/read -r -p 'E-mail administrativo:/g) || []).length === 1);
check('uninstall has three options', uninstall.includes('Escolha [1/2/3]:'));
check('uninstall preserves data option', uninstall.includes('REMOVER APLICACAO E PRESERVAR DADOS'));
check('uninstall purge option is explicit', uninstall.includes('REMOVER TUDO, INCLUINDO BANCO E UPLOADS'));
check('noninteractive mode requires explicit configuration', install.includes('execucao nao interativa'));
check('update CLI has numeric update and cancel options', updateCli.includes('1 - ATUALIZAR DEVFLOW') && updateCli.includes('2 - CANCELAR'));
check('update engine remains noninteractive', !update.includes('/dev/tty') && !update.includes('require_numeric_confirmation application-update'));

console.log(`Interactive menus validated: ${checks.length} scenarios.`);
