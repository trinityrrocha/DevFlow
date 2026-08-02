import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bundledPython = resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe');
const python = process.env.DEVFLOW_TEST_PYTHON
  || (process.platform === 'win32' && existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const bashCandidates = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'] : ['bash'];
const bash = bashCandidates.find(existsSync) || bashCandidates[0];
const result = spawnSync(bash, [resolve(root, 'tests/integration/compose-discovery.test.sh')], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, DEVFLOW_TEST_PYTHON: python },
});

if (result.status !== 0) {
  throw new Error(`Compose discovery tests failed:\n${result.stdout}\n${result.stderr}`);
}
process.stdout.write(result.stdout);
