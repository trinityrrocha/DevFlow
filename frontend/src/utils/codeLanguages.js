export const CODE_LANGUAGES = [
  ['auto', 'Detectar automaticamente'], ['pascal', 'Pascal / Delphi'],
  ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['sql', 'SQL'],
  ['python', 'Python'], ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'],
  ['scss', 'SCSS'], ['xml', 'XML'], ['markdown', 'Markdown'],
  ['shell', 'Shell / Bash'], ['powershell', 'PowerShell'], ['php', 'PHP'],
  ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['yaml', 'YAML'], ['go', 'Go'], ['ruby', 'Ruby'], ['rust', 'Rust'],
  ['plaintext', 'Texto simples']
];

const EXTENSIONS = {
  pas: 'pascal', pp: 'pascal', dpr: 'pascal', lpr: 'pascal', inc: 'pascal',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', sql: 'sql', py: 'python', json: 'json',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss', sh: 'shell',
  bash: 'shell', zsh: 'shell', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', xml: 'xml', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', go: 'go', rb: 'ruby', rs: 'rust', md: 'markdown', markdown: 'markdown', env: 'plaintext', txt: 'plaintext'
};

export const CODE_LANGUAGE_VALUES = new Set(CODE_LANGUAGES.slice(1).map(([value]) => value));
const CODE_LANGUAGE_LABELS = new Map(CODE_LANGUAGES);

export function codeLanguageLabel(language) {
  return CODE_LANGUAGE_LABELS.get(normalizeCodeLanguage(language)) || 'Texto simples';
}

export function normalizeCodeLanguage(language) {
  const aliases = { delphi: 'pascal', js: 'javascript', ts: 'typescript', py: 'python', bash: 'shell', ps1: 'powershell', cs: 'csharp', text: 'plaintext' };
  const normalized = String(language || '').trim().toLowerCase();
  const resolved = aliases[normalized] || normalized;
  return CODE_LANGUAGE_VALUES.has(resolved) ? resolved : 'plaintext';
}

export function detectLanguageFromFileName(fileName) {
  const name = String(fileName || '').trim().toLowerCase().replace(/\\/g, '/');
  if (!name || name.endsWith('/.env') || name === '.env' || name.includes('/.env.')) return 'plaintext';
  const leaf = name.split('/').pop();
  if (!leaf?.includes('.')) return 'plaintext';
  return EXTENSIONS[leaf.split('.').pop()] || 'plaintext';
}

export function resolveCodeLanguage(fileName, selection = 'auto') {
  return selection === 'auto' ? detectLanguageFromFileName(fileName) : normalizeCodeLanguage(selection);
}

export const detectCodeLanguage = detectLanguageFromFileName;
