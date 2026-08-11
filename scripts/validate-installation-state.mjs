import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const bundled = resolve(dirname(process.execPath), '..', '..', 'python', 'python.exe');
const python = process.env.DEVFLOW_TEST_PYTHON || (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
const validator = resolve(root, 'scripts/validate-installation-state.py');
const temporary = mkdtempSync(resolve(tmpdir(), 'devflow-state-v3-'));
const statePath = resolve(temporary, 'installation.json');
const checks = [];
const base = {
  schemaVersion: 3,
  installationMode: 'isolated',
  installedVersion: '0.6.23-alpha',
  installedCommit: '0123456789012345678901234567890123456789',
  installedRef: 'main',
  repository: 'https://github.com/trinityrrocha/DevFlow.git',
  applicationInstalled: true,
  applicationHealthy: true,
  externalPublicationEnabled: true,
  certificateIssued: true,
  domain: 'dev.example.com',
  adminEmail: 'admin@example.com',
  frontendUrl: 'https://dev.example.com',
  backendUrl: 'https://dev.example.com/api',
  migration: '001_initial_schema.sql',
};
const run = (mode, document = base) => spawnSync(python, [validator, mode, statePath], {
  input: mode === 'write' ? JSON.stringify(document) : undefined, encoding: 'utf8',
});
const check = (label, condition) => {
  if (!condition) throw new Error(`Installation state test failed: ${label}`);
  checks.push(label);
};

try {
  check('schema v3 writes atomically', run('write').status === 0 && existsSync(statePath));
  check('written state validates', run('validate').status === 0);
  check('mode is isolated', JSON.parse(readFileSync(statePath, 'utf8')).installationMode === 'isolated');
  check('unknown field rejected', run('write', { ...base, provider: 'host-nginx' }).status !== 0);
  check('shared schema v2 rejected', run('write', { ...base, schemaVersion: 2 }).status !== 0);
  check('publication must be enabled', run('write', { ...base, externalPublicationEnabled: false }).status !== 0);
  check('certificate must be issued', run('write', { ...base, certificateIssued: false }).status !== 0);
  check('domain and URLs must agree', run('write', { ...base, frontendUrl: 'https://other.example.com' }).status !== 0
    && run('write', { ...base, backendUrl: 'https://dev.example.com:444/api' }).status !== 0
    && run('write', { ...base, frontendUrl: 'https://dev.example.com/?debug=1' }).status !== 0);
  check('administrative email required', run('write', { ...base, adminEmail: 'invalid' }).status !== 0);
  writeFileSync(statePath, '{invalid');
  check('corrupt state rejected', run('validate').status !== 0);
  console.log(`Installation state v3 tests passed: ${checks.length} scenarios.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
