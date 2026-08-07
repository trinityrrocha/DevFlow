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
const expectedKeys = ['id', 'nonce', 'operation', 'requestedAt', 'requestedBy', 'schemaVersion', 'signature'].sort();
if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) fail('keys');
if (request.schemaVersion !== 1 || request.id !== expectedId || request.operation !== 'install-update') fail('contract');
if (!/^[0-9a-f-]{36}$/.test(request.id) || !/^[0-9a-f]{64}$/.test(request.nonce)) fail('identity');
if (typeof request.requestedBy !== 'string' || request.requestedBy.length < 3 || request.requestedBy.length > 320) fail('actor');
const requestedAt = Date.parse(request.requestedAt);
const age = Date.now() - requestedAt;
if (!Number.isFinite(requestedAt) || age < -300000 || age > 7 * 86400000) fail('timestamp');
const canonical = JSON.stringify({
  schemaVersion: request.schemaVersion,
  id: request.id,
  operation: request.operation,
  requestedAt: request.requestedAt,
  requestedBy: request.requestedBy,
  nonce: request.nonce
});
const calculated = Buffer.from(createHmac('sha256', secret).update(canonical).digest('hex'));
const received = Buffer.from(String(request.signature || ''));
if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) fail('signature');
process.stdout.write(`update_request_valid=true\nrequest_id=${request.id}\noperation=install-update\n`);
