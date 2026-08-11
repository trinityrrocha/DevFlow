import { Moon, Sun } from 'lucide-react';
import useTheme from '../hooks/useTheme';

export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${className}`}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {isDark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
