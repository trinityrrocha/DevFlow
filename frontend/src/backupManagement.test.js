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
    expect(page).toContain("setMessage({ type: 'success', text: data.message })");
  });

  it('exige confirmacoes fortes para restore e delete', () => {
    expect(page).toContain("const required = restore ? 'RESTAURAR' : 'EXCLUIR'");
    expect(page).toContain('A restauracao substituira os dados atuais');
    expect(page).toContain('disabled={typed !== required}');
  });

  it('mostra o aviso de backup sem impor gate por idade ou quantidade', () => {
    expect(settings).toContain('Recomendamos possuir um backup recente antes de atualizar.');
    expect(settings).toContain('O WebUpdater nao cria nem exige backup automatico.');
    expect(settings).toContain('Atualizar DevFlow');
    expect(settings).not.toContain('Ir para Backups');
    expect(settings).not.toContain('backupAge');
  });
});
