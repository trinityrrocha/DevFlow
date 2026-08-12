#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const [rootArgument, id] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`backup-resolution-failed:${message}\n`); process.exit(2); };
if (!rootArgument || !/^[0-9a-f]{32}$/.test(id || '')) fail('arguments');
const root = resolve(rootArgument);
if (root !== '/opt/devflow/backups' || !existsSync(root)) fail('root');
const rootStat = lstatSync(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('unsafe-root');
const canonicalRoot = realpathSync(root);
const pattern = /^devflow-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dfbackup$/;
for (const filename of readdirSync(root)) {
  if (!pattern.test(filename)) continue;
  const calculated = createHash('sha256').update(filename).digest('hex').slice(0, 32);
  if (calculated !== id) continue;
  const source = join(root, filename);
  const stat = lstatSync(source);
  const canonical = realpathSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || dirname(canonical) !== canonicalRoot || basename(canonical) !== filename) fail('unsafe-file');
  process.stdout.write(`${canonical}\n`);
  process.exit(0);
}
fail('not-found');
