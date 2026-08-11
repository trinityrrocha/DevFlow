import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { applyTheme, oppositeTheme, persistTheme, readStoredTheme, resolvePreferredTheme } from '../utils/theme';

export const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => resolvePreferredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (readStoredTheme()) return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const followSystem = (event) => {
      if (!readStoredTheme()) setThemeState(event.matches ? 'dark' : 'light');
    };
    media?.addEventListener?.('change', followSystem);
    return () => media?.removeEventListener?.('change', followSystem);
  }, []);

  const setTheme = useCallback((nextTheme) => {
    setThemeState((current) => {
      const resolved = typeof nextTheme === 'function' ? nextTheme(current) : nextTheme;
      if (!['light', 'dark'].includes(resolved)) return current;
      persistTheme(resolved);
      applyTheme(resolved);
      return resolved;
    });
  }, []);

  const toggleTheme = useCallback(() => setTheme((current) => oppositeTheme(current)), [setTheme]);
  const value = useMemo(() => ({ theme, setTheme, toggleTheme, isDark: theme === 'dark' }), [setTheme, theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
