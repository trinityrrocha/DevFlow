#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicWriteOperationalJson } from './lib/operational-files.mjs';

const [backupArgument, destinationArgument] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`backup-catalog-failed:${message}\n`); process.exit(2); };
const backupRoot = resolve(backupArgument || '');
const destination = resolve(destinationArgument || '');
if (backupRoot !== '/opt/devflow/backups' || !destination.startsWith('/var/lib/devflow/updater/')) fail('path');
if (!existsSync(backupRoot) || lstatSync(backupRoot).isSymbolicLink()) fail('root');
const canonicalRoot = realpathSync(backupRoot);
const pattern = /^devflow-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dfbackup$/;
const backups = [];
for (const filename of readdirSync(backupRoot)) {
  if (!pattern.test(filename)) continue;
  const source = join(backupRoot, filename);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(source)) !== canonicalRoot) continue;
  const id = createHash('sha256').update(filename).digest('hex').slice(0, 32);
  let metadata = {};
  try {
    const metadataFile = join(backupRoot, '.metadata', `${id}.json`);
    const metadataStat = lstatSync(metadataFile);
    if (metadataStat.isFile() && !metadataStat.isSymbolicLink() && metadataStat.size <= 8192) metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  } catch { /* unverified backups have no cache */ }
  backups.push({
    id, filename, createdAt: (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(),
    sizeBytes: stat.size, status: metadata.status === 'verified' ? 'verified' : 'available',
    applicationVersion: metadata.applicationVersion || null,
    applicationCommit: metadata.applicationCommit || null,
    databaseMigration: metadata.databaseMigration || null,
    format: metadata.format || null, verifiedAt: metadata.verifiedAt || null
  });
}
backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
atomicWriteOperationalJson(destination, { schemaVersion: 1, generatedAt: new Date().toISOString(), backups });
