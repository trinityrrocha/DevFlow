import {
  chmodSync, chownSync, closeSync, existsSync, fchmodSync, fchownSync, fsyncSync,
  lstatSync, openSync, readdirSync, renameSync, rmSync, writeSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const validGid = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const OPERATIONAL_ROOT = '/var/lib/devflow/updater';

const secureArtifact = (target, gid, mode, groupReadable) => {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('operational-artifact-unsafe');
  chownSync(target, 0, groupReadable ? gid : 0);
  chmodSync(target, mode);
};

function reconcileOperationalReadContract(destination, gid) {
  const absolute = resolve(destination);
  if (absolute !== join(OPERATIONAL_ROOT, 'backup-catalog.json')
    && dirname(absolute) !== join(OPERATIONAL_ROOT, 'status')) {
    throw new Error('operational-path-invalid');
  }
  const directories = ['requests', 'processing', 'processed', 'failed', 'status'];
  for (const name of directories) {
    const directory = join(OPERATIONAL_ROOT, name);
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('operational-directory-unsafe');
    chownSync(directory, 0, gid);
    chmodSync(directory, name === 'requests' ? 0o2770 : 0o2750);
    for (const filename of readdirSync(directory)) {
      if (filename.endsWith('.json')) secureArtifact(join(directory, filename), gid, 0o640, true);
      if (filename.endsWith('.log') || filename.endsWith('.validation')) {
        secureArtifact(join(directory, filename), gid, 0o600, false);
      }
    }
  }
  chownSync(OPERATIONAL_ROOT, 0, gid);
  chmodSync(OPERATIONAL_ROOT, 0o2750);
  secureArtifact(join(OPERATIONAL_ROOT, 'backup-catalog.json'), gid, 0o640, true);
  secureArtifact(join(OPERATIONAL_ROOT, 'daemon.ready'), gid, 0o600, false);
}

export function resolveOperationalGid(destination) {
  const configured = Number(process.env.DEVFLOW_OPS_GID || '');
  if (validGid(configured)) return configured;
  let detected;
  try {
    detected = Number(execFileSync('docker', ['exec', 'devflow-backend', 'id', '-g', 'devflow'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).trim());
  } catch { detected = Number.NaN; }
  if (!validGid(detected)) {
    const tag = String(process.env.DEVFLOW_IMAGE_TAG || 'latest');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tag)) throw new Error('operational-image-tag-invalid');
    try {
      detected = Number(execFileSync('docker', [
        'run', '--rm', '--network', 'none', '--entrypoint', 'id',
        `devflow-backend:${tag}`, '-g', 'devflow'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim());
    } catch { detected = Number.NaN; }
  }
  if (!validGid(detected)) throw new Error('operational-gid-unavailable');
  const parent = lstatSync(dirname(destination));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('operational-parent-unsafe');
  return detected;
}

export function atomicWriteOperationalJson(destination, payload) {
  const gid = resolveOperationalGid(destination);
  reconcileOperationalReadContract(destination, gid);
  const temporary = `${destination}.${process.pid}.tmp`;
  let fileDescriptor;
  let directoryDescriptor;
  try {
    fileDescriptor = openSync(temporary, 'wx', 0o640);
    writeSync(fileDescriptor, `${JSON.stringify(payload)}\n`, null, 'utf8');
    fchmodSync(fileDescriptor, 0o640);
    fchownSync(fileDescriptor, 0, gid);
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporary, destination);
    directoryDescriptor = openSync(dirname(destination), 'r');
    fsyncSync(directoryDescriptor);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}
