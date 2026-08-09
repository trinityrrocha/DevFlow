import { describe, expect, it } from 'vitest';
import { codeLanguageLabel, detectLanguageFromFileName, normalizeCodeLanguage, resolveCodeLanguage } from './codeLanguages';

describe('deteccao de linguagem por arquivo', () => {
  it('reconhece Pascal, JavaScript, TypeScript e SQL sem diferenciar maiusculas', () => {
    expect(detectLanguageFromFileName('backend/auth.PAS')).toBe('pascal');
    expect(detectLanguageFromFileName('ProjetoERP.dpr')).toBe('pascal');
    expect(detectLanguageFromFileName('src/App.JS')).toBe('javascript');
    expect(detectLanguageFromFileName('src/App.ts')).toBe('typescript');
    expect(detectLanguageFromFileName('src/App.tsx')).toBe('typescript');
    expect(detectLanguageFromFileName('database/migration.sql')).toBe('sql');
  });

  it('usa plaintext para arquivos desconhecidos, sem extensao e arquivos de ambiente', () => {
    expect(detectLanguageFromFileName('Dockerfile')).toBe('plaintext');
    expect(detectLanguageFromFileName('arquivo.custom')).toBe('plaintext');
    expect(detectLanguageFromFileName('config/.env.production')).toBe('plaintext');
  });

  it('preserva escolha manual e volta a acompanhar o arquivo no modo automatico', () => {
    expect(resolveCodeLanguage('src/App.tsx', 'pascal')).toBe('pascal');
    expect(resolveCodeLanguage('src/App.tsx', 'auto')).toBe('typescript');
    expect(resolveCodeLanguage('scripts/backup.ps1', 'auto')).toBe('powershell');
    expect(normalizeCodeLanguage('delphi')).toBe('pascal');
    expect(codeLanguageLabel('pascal')).toBe('Pascal / Delphi');
  });
});
