import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bash = process.env.DEVFLOW_TEST_BASH
  || (process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) walk(absolute);
    else if (absolute.endsWith('.sh')) files.push(absolute);
  }
};
walk(resolve(root, 'scripts'));
for (const file of files) {
  const result = spawnSync(bash, ['-n', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Bash syntax failed for ${relative(root, file)}:\n${result.stderr}`);
  }
}
console.log(`Bash syntax validated: ${files.length} scripts.`);
