import { useEffect, useState } from 'react';
import { detectEditorTheme } from '../utils/editorTheme';

export default function useEditorTheme() {
  const [theme, setTheme] = useState(() => detectEditorTheme(document.documentElement));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(detectEditorTheme(root)));
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
