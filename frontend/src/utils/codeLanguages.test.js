import { describe, expect, it } from 'vitest';
import { detectCodeLanguage } from './codeLanguages';

describe('deteccao de linguagem por arquivo', () => {
  it('reconhece extensoes comuns sem diferenciar maiusculas', () => {
    expect(detectCodeLanguage('src/App.JSX')).toBe('javascript');
    expect(detectCodeLanguage('database/migration.sql')).toBe('sql');
    expect(detectCodeLanguage('config/settings.yaml')).toBe('yaml');
  });

  it('mantem a escolha manual quando a extensao e desconhecida', () => {
    expect(detectCodeLanguage('Dockerfile')).toBeNull();
    expect(detectCodeLanguage('arquivo.custom')).toBeNull();
  });
});
