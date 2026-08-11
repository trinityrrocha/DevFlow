import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const layout = read('src/layouts/DashboardLayout.jsx');
const toggle = read('src/components/ThemeToggle.jsx');
const css = read('src/index.css');
const login = read('src/pages/Login.jsx');
const main = read('src/main.jsx');
const html = read('index.html');

describe('contrato visual do tema', () => {
  it('11 exibe o botao de tema no header autenticado', () => {
    expect(layout).toContain('<ThemeToggle />');
    expect(layout.indexOf('<ThemeToggle />')).toBeLessThan(layout.indexOf('<Bell className'));
  });

  it('12 mostra Moon quando light esta ativo', () => {
    expect(toggle).toContain(": <Moon className=\"h-5 w-5\"");
  });

  it('13 mostra Sun quando dark esta ativo', () => {
    expect(toggle).toContain("isDark ? <Sun className=\"h-5 w-5\"");
  });

  it('14 fornece aria-label e title contextuais', () => {
    expect(toggle).toContain("isDark ? 'Ativar tema claro' : 'Ativar tema escuro'");
    expect(toggle).toContain('aria-label={label}');
    expect(toggle).toContain('title={label}');
  });

  it('15 o clique alterna o tema sem recarregar', () => {
    expect(toggle).toContain('onClick={toggleTheme}');
    expect(toggle).not.toContain('location.reload');
  });

  it('16 notificacoes continuam com polling e acoes', () => {
    expect(layout).toContain('refreshNotifications');
    expect(layout).toContain("api.post('/notifications/read-all')");
  });

  it('17 perfil e troca de empresa continuam disponiveis', () => {
    expect(layout).toContain('profile-menu');
    expect(layout).toContain('switchCompany(event.target.value)');
  });

  it('18 menu mobile continua responsivo', () => {
    expect(layout).toContain('mobile-navigation');
    expect(layout).toContain('lg:hidden');
  });

  it('19 field possui superficie e contraste dark', () => {
    expect(css).toMatch(/\.field[\s\S]*dark:border-slate-700[\s\S]*dark:bg-slate-900[\s\S]*dark:text-slate-100/);
  });

  it('20 textarea-field possui superficie e contraste dark', () => {
    expect(css).toMatch(/\.textarea-field[\s\S]*dark:border-slate-700[\s\S]*dark:bg-slate-900[\s\S]*dark:text-slate-100/);
  });

  it('21 card possui borda e superficie dark', () => {
    expect(css).toMatch(/\.card[\s\S]*dark:border-slate-700[\s\S]*dark:bg-slate-900/);
  });

  it('22 btn-secondary possui estados dark', () => {
    expect(css).toMatch(/\.btn-secondary[\s\S]*dark:bg-slate-900[\s\S]*dark:hover:bg-slate-800/);
  });

  it('23 btn-danger preserva semantica no tema dark', () => {
    expect(css).toMatch(/\.btn-danger[\s\S]*dark:text-red-300[\s\S]*dark:hover:bg-red-950\/50/);
  });

  it('24 dropdown de navegacao usa surface dark', () => {
    expect(layout).toContain('dark:border-slate-700 dark:bg-slate-900');
    expect(layout).toContain('dark:hover:bg-slate-800');
  });

  it('25 menu de notificacoes adapta nao lidas', () => {
    expect(layout).toContain('dark:bg-indigo-950/40');
    expect(layout).toContain('dark:text-slate-300');
  });

  it('26 menu do perfil usa contraste dark', () => {
    expect(layout).toMatch(/profile-menu[\s\S]*dark:border-slate-700 dark:bg-slate-900/);
  });

  it('27 tabelas possuem cabecalho linha e divisores dark', () => {
    expect(css).toContain('html.dark table');
    expect(css).toContain('html.dark thead');
    expect(css).toContain('html.dark tbody tr:hover');
  });

  it('28 modais recebem surface escura sem mudar overlays', () => {
    expect(css).toContain("html.dark [role='dialog'] .card");
    expect(read('src/components/NewTaskModal.jsx')).toContain('bg-slate-900/60');
  });

  it('29 login respeita e permite alternar o tema', () => {
    expect(login).toContain('<ThemeToggle className="absolute right-4 top-4" />');
    expect(login).toContain('dark:bg-slate-950');
  });

  for (const [number, name, file] of [
    [30, 'Dashboard', 'src/pages/Dashboard.jsx'],
    [31, 'Tasks', 'src/pages/Tasks.jsx'],
    [32, 'Profile', 'src/pages/Profile.jsx'],
    [33, 'Settings', 'src/pages/Settings.jsx'],
    [34, 'Clients', 'src/pages/Clients.jsx'],
    [35, 'Projects', 'src/pages/Projects.jsx'],
    [36, 'Audit', 'src/pages/Audit.jsx']
  ]) {
    it(`${number} ${name} permanece coberto pelo tema global`, () => {
      const page = read(file);
      expect(page).toMatch(/className=/);
      expect(css).toContain('Compatibilidade visual para componentes legados');
      expect(main).toContain('<ThemeProvider>');
      expect(html).toContain("'devflow-theme'");
    });
  }
});
