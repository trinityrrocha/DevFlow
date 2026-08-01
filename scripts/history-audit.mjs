import { spawnSync } from 'node:child_process';

const ownerName = 'trinityrrocha';
const ownerEmail = 'trinityrocha@sti1.com.br';
const maxBlobBytes = 8 * 1024 * 1024;
const excludedAuditPaths = [
  ':(exclude)scripts/repository-audit.mjs',
  ':(exclude)scripts/history-audit.mjs',
];

function git(args, { allowNoMatches = false, input } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (allowNoMatches && result.status === 1) return '';
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} falhou.`);
  }
  return result.stdout;
}

const commits = git(['rev-list', '--all']).trim().split(/\r?\n/).filter(Boolean);
const objectLines = git(['rev-list', '--objects', '--all']).trim().split(/\r?\n/).filter(Boolean);
const objectIds = [...new Set(objectLines.map((line) => line.split(' ', 1)[0]))];
const objectInfo = git(
  ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
  { input: `${objectIds.join('\n')}\n` },
).trim().split(/\r?\n/).filter(Boolean);

const failures = [];
for (const line of objectInfo) {
  const [oid, type, sizeText] = line.split(' ');
  const size = Number(sizeText);
  if (type === 'blob' && size > maxBlobBytes) {
    failures.push(`${oid}: blob histórico excede ${maxBlobBytes} bytes (${size})`);
  }
}

const forbiddenName = /(^|\/)(?:\.env(?:\..+)?|backups?|dumps?|logs?|storage|uploads?|data)(\/|$)|\.(?:pem|key|p12|pfx|dfbackup|dump|backup|log)$/i;
for (const commit of commits) {
  const paths = git(['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean);
  for (const path of paths) {
    if (path !== '.env.example' && forbiddenName.test(path)) {
      failures.push(`${commit}:${path}: nome proibido no histórico`);
    }
  }

  const matches = git([
    'grep', '-I', '-n', '-E',
    '-e', '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
    '-e', '-----BEGIN CERTIFICATE-----',
    '-e', '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}',
    '-e', 'github_pat_[A-Za-z0-9_]{20,}',
    '-e', 'AKIA[0-9A-Z]{16}',
    '-e', 'xox[baprs]-[A-Za-z0-9-]{20,}',
    '-e', 'sk_(live|test)_[A-Za-z0-9]{16,}',
    '-e', 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    '-e', 'https?://[^ /:]+:[^ /@]+@',
    '-e', '[A-Za-z]:\\\\Users\\\\[^\\ ]+',
    commit, '--', '.', ...excludedAuditPaths,
  ], { allowNoMatches: true });
  if (matches.trim()) failures.push(...matches.trim().split(/\r?\n/));
}

const metadata = git([
  'log', '--all',
  '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e',
]);
for (const record of metadata.split('\x1e').map((value) => value.trim()).filter(Boolean)) {
  const [commit, authorName, authorEmail, committerName, committerEmail, ...bodyParts] = record.split('\x1f');
  const body = bodyParts.join('\x1f');
  if (authorName !== ownerName || committerName !== ownerName || authorEmail !== ownerEmail || committerEmail !== ownerEmail) {
    failures.push(`${commit}: autoria diferente da identidade exclusiva do proprietário`);
  }
  if (/Co-authored-by:|Codex|OpenAI|\[bot\]/i.test(body)) {
    failures.push(`${commit}: mensagem contém coautoria ou identidade automatizada`);
  }
}

if (failures.length) {
  console.error('Auditoria do histórico Git falhou:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const blobCount = objectInfo.filter((line) => line.includes(' blob ')).length;
console.log(`Histórico Git aprovado: ${commits.length} commit(s), ${objectIds.length} objeto(s), ${blobCount} blob(s).`);
