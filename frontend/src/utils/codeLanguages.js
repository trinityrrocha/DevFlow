export const CODE_LANGUAGES = [
  ['plaintext', 'Texto'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
  ['sql', 'SQL'], ['python', 'Python'], ['json', 'JSON'], ['html', 'HTML'],
  ['css', 'CSS'], ['shell', 'Shell / Bash'], ['yaml', 'YAML'], ['xml', 'XML'],
  ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['go', 'Go'],
  ['php', 'PHP'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['markdown', 'Markdown']
];

const EXTENSIONS = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', sql: 'sql', py: 'python', json: 'json',
  html: 'html', htm: 'html', css: 'css', scss: 'css', less: 'css', sh: 'shell',
  bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  go: 'go', php: 'php', rb: 'ruby', rs: 'rust', md: 'markdown', markdown: 'markdown'
};

export function detectCodeLanguage(fileName) {
  const name = String(fileName || '').trim().toLowerCase();
  if (!name.includes('.')) return null;
  return EXTENSIONS[name.split('.').pop()] || null;
}
