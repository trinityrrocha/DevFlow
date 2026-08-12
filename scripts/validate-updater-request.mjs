#!/usr/bin/env node
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [requestPath, expectedId, requestRoot] = process.argv.slice(2);
const secret = process.env.UPDATE_REQUEST_SECRET || '';
const fail = (message) => { process.stderr.write(`invalid-update-request:${message}\n`); process.exit(2); };
if (!requestPath || !expectedId || !requestRoot || secret.length < 64) fail('arguments');
const root = resolve(requestRoot);
const processingPath = resolve(requestPath);
if (processingPath !== resolve(root, 'processing', `${expectedId}.json`)) fail('path');
if (existsSync(resolve(root, 'processed', `${expectedId}.json`))
  || existsSync(resolve(root, 'failed', `${expectedId}.json`))) fail('replay');
let stat;
try { stat = lstatSync(requestPath); } catch { fail('missing'); }
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) fail('unsafe-file');
let request;
try { request = JSON.parse(readFileSync(requestPath, 'utf8')); } catch { fail('json'); }
const keys = Object.keys(request).sort();
const expectedKeys = request.schemaVersion === 2
  ? ['action', 'id', 'nonce', 'operation', 'requestedAt', 'requestedBy', 'requester', 'schemaVersion', 'signature', 'timestamp'].sort()
  : ['action', 'backupId', 'id', 'nonce', 'operation', 'requestedAt', 'requestedBy', 'requester', 'schemaVersion', 'signature', 'timestamp'].sort();
if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) fail('keys');
const allowedOperations = new Set(['install-update', 'create-backup', 'verify-backup', 'restore-backup', 'delete-backup']);
const legacy = request.schemaVersion === 2 && request.action === 'update' && request.operation === 'install-update';
const current = request.schemaVersion === 3 && request.action === 'operation' && allowedOperations.has(request.operation);
if ((!legacy && !current) || request.id !== expectedId || request.timestamp !== request.requestedAt
  || request.requester !== request.requestedBy) fail('contract');
if (current) {
  const needsBackup = !['install-update', 'create-backup'].includes(request.operation);
  if ((needsBackup && !/^[0-9a-f]{32}$/.test(request.backupId || ''))
    || (!needsBackup && request.backupId !== null)) fail('backup-id');
}
if (!/^[0-9a-f-]{36}$/.test(request.id) || !/^[0-9a-f]{64}$/.test(request.nonce)) fail('identity');
if (typeof request.requestedBy !== 'string' || request.requestedBy.length < 3 || request.requestedBy.length > 320) fail('actor');
const requestedAt = Date.parse(request.requestedAt);
const age = Date.now() - requestedAt;
if (!Number.isFinite(requestedAt) || age < -300000 || age > 7 * 86400000) fail('timestamp');
const unsigned = {
  schemaVersion: request.schemaVersion, id: request.id, action: request.action,
  timestamp: request.timestamp, requester: request.requester, operation: request.operation,
  requestedAt: request.requestedAt, requestedBy: request.requestedBy, nonce: request.nonce
};
if (request.schemaVersion === 3) unsigned.backupId = request.backupId;
const canonical = JSON.stringify(unsigned);
const calculated = Buffer.from(createHmac('sha256', secret).update(canonical).digest('hex'));
const received = Buffer.from(String(request.signature || ''));
if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) fail('signature');
process.stdout.write(`operation_request_valid=true\nrequest_id=${request.id}\noperation=${request.operation}\nbackup_id=${request.backupId || ''}\n`);
