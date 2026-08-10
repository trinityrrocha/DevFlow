import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(frontendRoot, file), 'utf8');

describe('experiencia de tarefas e anotacoes GitHub', () => {
  const detail = read('src/pages/TaskDetail.jsx');
  const list = read('src/pages/Tasks.jsx');
  const editor = read('src/components/CodeEditor.jsx');
  const monaco = read('src/services/monaco.js');
  const frontendPackage = JSON.parse(read('package.json'));

  it('usa um unico toggle reativo sem botao Cancelar', () => {
    expect(detail).toContain("task.timer_status === 'running' ? 'pause'");
    expect(detail).toContain("task.timer_status === 'running' ? <Pause");
    expect(detail).toContain("{task.timer_status === 'running' ? 'Pause' : 'Iniciar'}");
    expect(detail).toContain('aria-busy={timerPending}');
    expect(detail).toContain('animate-spin');
    expect(detail).not.toContain("timerAction('cancel')");
    expect(detail).not.toContain("stateAction('cancel')");
    expect(detail).not.toContain("timerAction('complete')");
    expect(detail).not.toContain('Concluir tempo');
    expect(detail).toContain('{!isRoadmapStage && <section');
    expect(detail).toContain('summaryIsRoadmap ? []');
    expect(detail).toContain('data.stage_touch_by_user');
  });

  it('renderiza previews nativos e icones sem autoplay', () => {
    expect(detail).toContain('<img src={url}');
    expect(detail).toContain('<video src={url} controls preload="metadata"');
    expect(detail).toContain('object-cover');
    expect(detail).toContain('FileArchive');
    expect(detail).toContain('FileSpreadsheet');
    expect(detail).not.toContain('autoPlay');
  });

  it('mantem o cabecalho da lista destacado e sem subtitulo redundante', () => {
    expect(list).toContain('border-slate-300 bg-slate-200/80');
    expect(list).not.toContain('Ciclo de desenvolvimento e prioridades da equipe.');
  });

  it('declara Monaco e os campos estruturados do editor', () => {
    expect(frontendPackage.dependencies['@monaco-editor/react']).toBeTruthy();
    for (const field of ['file_name', 'language', 'code_content', 'explanation']) expect(detail).toContain(field);
    expect(detail).toContain("language: 'auto'");
    expect(detail).toContain('resolveCodeLanguage(form.file_name, form.language)');
    expect(detail).toContain('expanded === card.id');
    expect(detail).toContain('navigator.clipboard.writeText(card.code_content');
    expect(detail).toContain('api.delete(`/tasks/${task.id}/github/${card.id}`)');
    expect(editor).toContain("lineNumbers: 'on'");
    expect(editor).toContain('readOnly');
    expect(editor).toContain('minimap: { enabled: false }');
    expect(monaco).not.toContain('http');
  });

  it('mantem o modelo editavel no Monaco e le o codigo somente ao salvar', () => {
    expect(editor).toContain('{ defaultValue: value }');
    expect(editor).toContain('onClick={() => editorRef.current?.focus()}');
    expect(editor).toContain("placeholder: readOnly ? undefined : 'Cole ou digite o codigo aqui...'");
    expect(editor).toContain('loading={<EditorLoading');
    expect(editor).not.toContain('onChange={(nextValue)');
    expect(detail).toContain('codeEditorRef.current?.getValue()');
    expect(detail).toContain('code_content: codeContent');
    expect(detail).toContain('minHeight="400px"');
    expect(detail).not.toContain('onChange={(value) => setForm({ ...form, code_content: value })');
  });
});
