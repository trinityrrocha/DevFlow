import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'tmp', 'temp']);
const forbiddenNames = [
  /^\.env(?:\..+)?$/,
  /\.(?:pem|key|p12|pfx|dfbackup|dump|backup|log)$/i,
  /(?:^|[-_.])(?:secrets?|credentials?)(?:[-_.]|$)/i,
];
const allowedNames = new Set(['.env.example']);
const textExtensions = new Set([
  '', '.cjs', '.conf', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.service',
  '.sh', '.sql', '.template', '.timer', '.txt', '.yaml', '.yml',
]);
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Windows user path', /[A-Za-z]:\\Users\\[^\\\s]+/i],
];
const localUsername = process.env.USERNAME || process.env.USER;
if (localUsername && localUsername.length >= 3) {
  const escapedUsername = localUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  secretPatterns.push(['local workstation username', new RegExp(`\\b${escapedUsername}\\b`, 'i')]);
}

const failures = [];
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) files.push(absolute);
  }
}

walk(root);

for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const name = rel.split('/').at(-1);
  if (!allowedNames.has(name) && forbiddenNames.some((pattern) => pattern.test(name))) {
    failures.push(`${rel}: nome de arquivo proibido para publicação`);
  }
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const body = readFileSync(file, 'utf8');
  if (rel !== 'scripts/repository-audit.mjs') {
    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(body)) failures.push(`${rel}: padrão sensível detectado (${label})`);
    }
  }
  if (name === '.env.example') {
    for (const line of body.split(/\r?\n/)) {
      if (/^(?:DB_PASSWORD|JWT_SECRET|ADMIN_BOOTSTRAP_TOKEN|CONFIG_ENCRYPTION_KEY|SMTP_PASSWORD|BACKUP_PASSPHRASE)\s*=\s*\S+/.test(line)) {
        failures.push(`${rel}: exemplo contém valor em variável sensível`);
      }
    }
  }
  if (extname(file).toLowerCase() !== '.md') continue;
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0].split(':')[0]);
    if (!target) continue;
    const destination = resolve(dirname(file), target);
    if (!destination.startsWith(root) || !existsSync(destination) || lstatSync(destination).isDirectory()) {
      failures.push(`${rel}: link interno inválido (${match[1]})`);
    }
  }
}

if (failures.length) {
  console.error('Auditoria do repositório falhou:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Auditoria do repositório aprovada: ${files.length} arquivos inspecionados.`);
