import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(frontendRoot, file), 'utf8');

describe('experiencia de tarefas e anotacoes GitHub', () => {
  const detail = read('src/pages/TaskDetail.jsx');
  const list = read('src/pages/Tasks.jsx');
  const frontendPackage = JSON.parse(read('package.json'));

  it('usa um unico toggle reativo sem botao Cancelar', () => {
    expect(detail).toContain("task.timer_status === 'running' ? 'pause'");
    expect(detail).toContain("<Pause className=\"mr-2 h-4 w-4\" />Pause");
    expect(detail).not.toContain('>Cancelar</button>');
  });

  it('mantem o cabecalho da lista destacado e sem subtitulo redundante', () => {
    expect(list).toContain('border-slate-300 bg-slate-200/80');
    expect(list).not.toContain('Ciclo de desenvolvimento e prioridades da equipe.');
  });

  it('declara Monaco e os campos estruturados do editor', () => {
    expect(frontendPackage.dependencies['@monaco-editor/react']).toBeTruthy();
    for (const field of ['file_name', 'language', 'code_content', 'explanation']) expect(detail).toContain(field);
  });
});
