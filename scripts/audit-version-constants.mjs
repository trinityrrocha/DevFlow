import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const historicalVersions = /0\.(?:2\.0|3\.[0-3]|4\.[0-5])-alpha/g;
const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const findings = [];

const classify = (path) => {
  if (path === 'CHANGELOG.md') return 'changelog';
  if (path.startsWith('docs/')) return 'documentação histórica';
  if (/(^|\/)(?:test|tests|__tests__)(\/|$)/.test(path)
      || /^scripts\/validate-.*\.mjs$/.test(path)) return 'teste';
  return 'constante operacional indevida';
};

const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (!entry.isFile() || statSync(absolute).size > 2_000_000) continue;
    const path = relative(root, absolute).replaceAll('\\', '/');
    let content;
    try { content = readFileSync(absolute, 'utf8'); } catch { continue; }
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const versions = [...line.matchAll(historicalVersions)].map((match) => match[0]);
      if (versions.length) findings.push({ path, line: index + 1, versions, classification: classify(path) });
    }
  }
};

visit(root);

const invalid = findings.filter(({ classification }) => classification === 'constante operacional indevida');
const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap.sh'), 'utf8');
if (/EXPECTED_VERSION=['"][0-9]/.test(bootstrap) || bootstrap.includes('RAW_VERSION_URL')) {
  invalid.push({
    path: 'scripts/bootstrap.sh',
    line: 0,
    versions: ['versão fixa'],
    classification: 'constante operacional indevida',
  });
}

const totals = findings.reduce((accumulator, finding) => {
  accumulator[finding.classification] = (accumulator[finding.classification] || 0) + finding.versions.length;
  return accumulator;
}, {});

for (const classification of ['changelog', 'documentação histórica', 'teste', 'constante operacional indevida']) {
  console.log(`${classification}=${totals[classification] || 0}`);
}

if (invalid.length) {
  for (const finding of invalid) {
    console.error(`${finding.path}:${finding.line}: ${finding.versions.join(', ')} [${finding.classification}]`);
  }
  throw new Error('Constantes de versão histórica permanecem em arquivos operacionais.');
}

console.log(`Auditoria concluída: ${findings.length} ocorrências classificadas; nenhuma constante operacional indevida.`);
