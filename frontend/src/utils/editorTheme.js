export function resolveMonacoTheme(theme) {
  return theme === 'dark' ? 'vs-dark' : 'vs';
}

export function detectEditorTheme(root) {
  const declared = root?.dataset?.theme || root?.getAttribute?.('data-color-scheme');
  if (declared === 'dark' || root?.classList?.contains('dark')) return 'dark';
  return 'light';
}
