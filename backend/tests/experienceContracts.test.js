const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('contratos de listagem, historico e area GitHub', () => {
  const controller = read('src/controllers/taskController.js');
  const service = read('src/services/taskService.js');
  const users = read('src/controllers/userController.js');
  const githubValidation = read('src/validation/githubCard.js');
  const migration = read('../database/migrations/015_github_technical_area.sql');

  it('mapeia ciclo aberto e finalizado pelos estados reais do dominio', () => {
    expect(controller).toContain("lifecycle: z.enum(['open', 'completed'])");
    expect(service).toContain("t.state IN ('ACTIVE','PAUSED')");
    expect(service).toContain("t.state IN ('COMPLETED','CANCELED')");
    expect(service).toContain('if (filters.state)');
    expect(service).toContain('if (filters.search)');
  });

  it('limita no backend o historico aos 21 eventos mais recentes', () => {
    expect(users).toContain('ORDER BY created_at DESC LIMIT 21');
  });

  it('adiciona classificacao tecnica segura sem alterar migration aplicada', () => {
    expect(githubValidation).toContain("z.enum(['BACKEND', 'FRONTEND', 'BOTH'])");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS technical_area');
    expect(migration).toContain("CHECK (technical_area IN ('BACKEND','FRONTEND','BOTH'))");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
  });
});
