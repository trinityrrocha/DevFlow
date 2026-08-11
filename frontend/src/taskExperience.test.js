import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(frontendRoot, file), 'utf8');

describe('experiencia de tarefas e anotacoes GitHub', () => {
  const detail = read('src/pages/TaskDetail.jsx');
  const checklist = read('src/components/StagePrerequisiteChecklist.jsx');
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

  it('renderiza QA e anexos em timelines centralizadas com dimensoes exatas', () => {
    expect(detail).toContain('Registrar Novo Teste');
    expect(detail).toContain('max-w-[490px]');
    expect(detail).toContain('w-[490px]');
    expect(detail).toContain('h-[171px] w-[490px]');
    expect(detail).toContain('relative mx-auto w-[538px] border-l border-slate-200');
    expect(detail).toContain('aria-labelledby="task-test-title"');
    for (const field of ['validated_profiles', 'environment', 'backend_info', 'frontend_info', 'testing_notes']) expect(detail).toContain(field);
    expect(detail).toContain('<CheckboxGroup legend="Ambiente"');
    expect(detail).toContain('<CheckboxGroup legend="Perfis Validados"');
    expect(detail).toContain('type="checkbox"');
    expect(detail).toContain('api.get(\'/users/profiles\')');
    expect(detail).toContain('qaComponentOptions(form.backend_info)');
    expect(detail).toContain('qaComponentOptions(form.frontend_info)');
    expect(detail).toContain("body.append('sourceSection', 'testes')");
    expect(detail).toContain("body.append('sourceSection', 'comentarios')");
    expect(detail).toContain("body.append('sourceSection', 'geral')");
    expect(detail).toContain('attachmentSourceLabel(item.source_section)');
    expect(detail).toContain('const orderedTests = [...data.tests].sort');
    expect(detail).toContain('new Date(b.created_at) - new Date(a.created_at)');
  });

  it('remove os perfis proibidos das opções selecionáveis de QA', () => {
    expect(detail).toContain("const QA_EXCLUDED_PROFILES = new Set(['Cliente', 'Desenvolvedor Backend', 'Desenvolvedor Frontend'])");
    expect(detail).toContain('systemProfiles.filter((profile) => !QA_EXCLUDED_PROFILES.has(profile.name))');
    expect(detail).toContain('form.validated_profiles.filter((profile) => !QA_EXCLUDED_PROFILES.has(profile))');
  });

  it('oferece revisão dedicada na etapa de aprovação do frontend', () => {
    expect(detail).toContain("isFrontendApprovalStage");
    expect(detail).toContain('<FrontendApprovalPanel');
    expect(detail).toContain('Descrição/Observações de Aprovação');
    expect(detail).toContain('Motivo da Reprovação');
    expect(detail).toContain('Anexar evidência da reprovação');
    expect(detail).toContain("decision: 'APPROVED'");
    expect(detail).toContain("decision: 'REJECTED'");
  });

  it('posiciona o checklist de pre-requisitos junto ao avanço de etapa', () => {
    expect(detail).toContain('<StagePrerequisiteChecklist task={task} tests={data.tests} githubCards={data.github_cards} attachments={data.attachments} />');
    expect(detail).toContain('aria-describedby="stage-prerequisite-checklist"');
    expect(detail).toContain('disabled={saving || advanceBlocked}');
    for (const item of ['Testes de QA aprovados', 'Cards do GitHub vinculados', 'Anexos inseridos', 'Pendências obrigatórias']) expect(checklist).toContain(item);
    expect(checklist).toContain('task.missing_requirements || []');
    expect(checklist).toContain("test.stage_id === currentStageId && test.status === 'APPROVED'");
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
