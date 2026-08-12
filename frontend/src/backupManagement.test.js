import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./pages/Backups.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('./pages/Settings.jsx', import.meta.url), 'utf8');

describe('gestao de backups e alerta de update', () => {
  it('oferece listagem, criacao e polling sem bloquear HTTP', () => {
    expect(page).toContain("api.get('/operations/backups')");
    expect(page).toContain("queue('post', '/operations/backups')");
    expect(page).toContain('window.setInterval(poll, 4000)');
    expect(page).toContain('Criando backup...');
    expect(page).toContain('Verificando...');
    expect(page).toContain('Restaurando...');
    expect(page).toContain('Excluindo...');
  });

  it('exige confirmacoes fortes para restore e delete', () => {
    expect(page).toContain("const required = restore ? 'RESTAURAR' : 'EXCLUIR'");
    expect(page).toContain('A restauracao substituira os dados atuais');
    expect(page).toContain('disabled={typed !== required}');
  });

  it('mostra o aviso de backup sem impor gate por idade ou quantidade', () => {
    expect(settings).toContain('Antes de atualizar, recomendamos criar um backup atual do DevFlow.');
    expect(settings).toContain('O processo de atualizacao nao cria backup automaticamente.');
    expect(settings).toContain('Ir para Backups');
    expect(settings).toContain('Continuar atualizacao');
    expect(settings).not.toContain('backupAge');
  });
});
