const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createGithubCardSchema, updateGithubCardSchema } = require('../src/validation/githubCard');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const valid = { file_name: 'backend/auth.pas', language: 'pascal', code_content: 'begin\n  Result := True;\nend.' };

describe('anotacoes de codigo GitHub', () => {
  it('valida criacao e edicao com Pascal normalizado', () => {
    expect(createGithubCardSchema.parse(valid)).toEqual(valid);
    expect(updateGithubCardSchema.parse({ language: 'powershell' })).toEqual({ language: 'powershell' });
  });

  it('rejeita linguagem invalida, codigo vazio e payload que tente definir o autor', () => {
    expect(() => createGithubCardSchema.parse({ ...valid, language: 'executavel' })).toThrow();
    expect(() => createGithubCardSchema.parse({ ...valid, code_content: '   ' })).toThrow();
    expect(() => createGithubCardSchema.parse({ ...valid, author_id: '00000000-0000-0000-0000-000000000000' })).toThrow();
    expect(() => updateGithubCardSchema.parse({ code_content: '' })).toThrow();
  });

  it('mede o limite de 200 KB em bytes UTF-8', () => {
    expect(() => createGithubCardSchema.parse({ ...valid, code_content: 'a'.repeat(200001) })).toThrow(/200 KB/);
    expect(() => createGithubCardSchema.parse({ ...valid, code_content: 'á'.repeat(100001) })).toThrow(/200 KB/);
  });

  it('preserva autor e etapa na edicao e protege exclusao logica', () => {
    const service = read('src/services/taskService.js');
    const routes = read('src/routes/taskRoutes.js');
    expect(service).toContain('payload.explanation || null, req.user.id, task.current_stage_id');
    expect(service).not.toMatch(/UPDATE task_github_metadata SET[\s\S]{0,300}author_id=/);
    expect(service).toContain("hasPermission(req.user, 'tasks.manage')");
    expect(service).toContain('deleted_at=CURRENT_TIMESTAMP');
    expect(service).toContain('github.deleted_at IS NULL');
    expect(routes).toContain("router.delete('/:id/github/:cardId', requirePermission('tasks.manage')");
  });

  it('mantem migration 009 imutavel e evolui exclusao no passo 010', () => {
    const migration009 = read('../database/migrations/009_github_code_annotations.sql');
    const migration010 = read('../database/migrations/010_github_card_soft_deletion.sql');
    for (const field of ['file_name', 'language', 'code_content', 'explanation', 'author_id', 'stage_id', 'created_at']) expect(migration009).toContain(field);
    expect(migration010).toContain('deleted_at');
    expect(migration010).toContain('deleted_by');
    expect(migration010).not.toContain('DELETE FROM');
  });
});
