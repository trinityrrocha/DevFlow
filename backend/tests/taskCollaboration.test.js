const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('cadastros e dossie tecnico da tarefa', () => {
  const catalogController = read('src/controllers/catalogController.js');
  const catalogService = read('src/services/catalogService.js');
  const taskController = read('src/controllers/taskController.js');
  const taskService = read('src/services/taskService.js');
  const timingService = read('src/services/taskTimingService.js');
  const attachmentService = read('src/services/attachmentService.js');
  const migration = `${read('../database/migrations/007_task_collaboration_and_generated_codes.sql')}\n${read('../database/migrations/008_smtp_settings_and_github_cards.sql')}\n${read('../database/migrations/009_github_code_annotations.sql')}\n${read('../database/migrations/010_github_card_soft_deletion.sql')}`;

  it('aceita filtro de cliente vazio sem tentar validar UUID vazio', () => {
    expect(catalogController).toContain("value === '' ? undefined : value");
  });

  it('gera codigos imutaveis para clientes e projetos no backend', () => {
    expect(catalogService).toContain("'CLI_' || UPPER(REPLACE(id::text,'-',''))");
    expect(catalogService).toContain("'PRJ_' || UPPER(REPLACE(id::text,'-',''))");
    expect(catalogService).not.toContain("const allowed = ['name', 'code'");
    const projectSchema = catalogController.split('const projectSchema =')[1].split('const catalogSchemas')[0];
    expect(projectSchema).not.toMatch(/\n\s+code,/);
  });

  it('mapeia todos os eventos de cronometro para valores aceitos pelo banco', () => {
    expect(timingService).toContain("resume: 'RESUMED'");
    expect(timingService).not.toContain("complete: 'COMPLETED'");
    expect(timingService).not.toContain("cancel: 'CANCELLED'");
    expect(timingService).not.toContain('`${action.toUpperCase()}D`');
  });

  it('persiste perfis testados, registros GitHub 1:N e anexos contextualizados', () => {
    for (const field of ['tested_as_super_admin', 'tested_as_admin', 'tested_as_user', 'notes_code']) {
      expect(taskController).toContain(field);
      expect(taskService).toContain(field);
      expect(migration).toContain(field);
    }
    expect(attachmentService).toContain('context.test_id');
    expect(attachmentService).toContain('context.comment_id');
    expect(taskService).toContain('AS attachments');
    expect(migration).toContain('PRIMARY KEY (id)');
    expect(taskService).toContain('github_cards: github.rows');
    for (const field of ['file_name', 'language', 'code_content', 'explanation', 'author_id', 'stage_id']) {
      expect(migration).toContain(field);
      expect(taskService).toContain(field);
    }
  });
});
