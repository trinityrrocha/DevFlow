export const THEME_STORAGE_KEY = 'devflow-theme';
export const THEMES = Object.freeze(['light', 'dark']);

export function isValidTheme(value) {
  return THEMES.includes(value);
}

export function readStoredTheme(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isValidTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function resolvePreferredTheme({ storage = globalThis.localStorage, matchMedia = globalThis.matchMedia } = {}) {
  const stored = readStoredTheme(storage);
  if (stored) return stored;
  try {
    return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme, root = globalThis.document?.documentElement) {
  const normalized = isValidTheme(theme) ? theme : 'light';
  if (!root) return normalized;
  root.classList.toggle('dark', normalized === 'dark');
  root.dataset.theme = normalized;
  root.style.colorScheme = normalized;
  const themeColor = globalThis.document?.querySelector?.('meta[name="theme-color"]');
  themeColor?.setAttribute('content', normalized === 'dark' ? '#020617' : '#f8fafc');
  return normalized;
}

export function persistTheme(theme, storage = globalThis.localStorage) {
  if (!isValidTheme(theme)) return false;
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function oppositeTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}
