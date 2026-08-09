import { describe, expect, it } from 'vitest';
import { detectEditorTheme, resolveMonacoTheme } from './editorTheme';

const root = (theme, darkClass = false) => ({
  dataset: { theme },
  getAttribute: () => null,
  classList: { contains: () => darkClass }
});

describe('tema do Monaco', () => {
  it('mapeia os temas claro e escuro sem criar um estado visual paralelo', () => {
    expect(detectEditorTheme(root('light'))).toBe('light');
    expect(detectEditorTheme(root('dark'))).toBe('dark');
    expect(detectEditorTheme(root(undefined, true))).toBe('dark');
    expect(resolveMonacoTheme('light')).toBe('vs');
    expect(resolveMonacoTheme('dark')).toBe('vs-dark');
  });
});
