import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachmentTimelineItems, githubTimelineItems, historyTimelineItems, qaTimelineItems } from './utils/timeline';
import { Bug, Sparkles } from 'lucide-react';
import { TASK_TYPE_PRESENTATION, TaskTypeIcon } from './utils/taskPresentation';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

describe('melhorias rastreaveis da experiencia operacional', () => {
  const detail = read('src/pages/TaskDetail.jsx');
  const centralTimeline = read('src/components/CentralTimeline.jsx');
  const tasks = read('src/pages/Tasks.jsx');
  const taskPresentation = read('src/utils/taskPresentation.jsx');
  const smtp = read('src/components/SmtpSettings.jsx');
  const users = read('src/pages/Users.jsx');
  const dashboard = read('src/pages/Dashboard.jsx');
  const metricCard = read('src/components/MetricCard.jsx');

  it('separa QA, GitHub e anexos semanticamente em uma unica timeline central', () => {
    const qa = qaTimelineItems([{ id: 'qa', created_at: '2026-08-16T12:00:00Z', backend_info: 'Validado', frontend_info: 'Pronto para teste' }]);
    expect(qa.map((item) => item.side)).toEqual(['backend', 'frontend']);
    expect(githubTimelineItems([{ id: 'gh', technical_area: 'BOTH' }]).map((item) => item.side)).toEqual(['backend', 'frontend']);
    expect(attachmentTimelineItems([
      { id: 'front', source_section: 'frontend', created_at: '2026-08-16T11:00:00Z' },
      { id: 'back', source_section: 'backend', created_at: '2026-08-16T12:00:00Z' }
    ]).map((item) => item.side)).toEqual(['backend', 'frontend']);
    expect(centralTimeline).toContain("md:before:left-1/2");
    expect(detail).toContain('Área técnica');
  });

  it('mantem a ordem cronologica do historico e alterna apenas na camada visual', () => {
    const ordered = historyTimelineItems([
      { id: 'old', created_at: '2026-08-15T12:00:00Z' },
      { id: 'new', created_at: '2026-08-16T12:00:00Z' }
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['new', 'old']);
    expect(detail).toContain('<CentralTimeline items={combined} alternate');
    expect(centralTimeline).toContain("index % 2 === 0 ? 'left' : 'right'");
    expect(centralTimeline).toContain("const sideLabel = alternate ? ''");
  });

  it('remove o card externo do workflow sem remover o stepper', () => {
    expect(detail).toContain('<section className="-mt-2 overflow-x-auto py-1" aria-label="Etapas da tarefa">');
    expect(detail).not.toContain('<section className="card overflow-x-auto p-5"><WorkflowStepper');
  });

  it('organiza SMTP em quatro linhas compactas dentro do card de 590px', () => {
    expect(smtp).toContain('max-w-[590px]');
    expect(smtp).toContain('data-smtp-row="connection"');
    expect(smtp).toContain('lg:grid-cols-[270px_minmax(0,1fr)_minmax(0,1fr)]');
    expect(smtp).toContain('data-smtp-row="credentials"');
    expect(smtp).toContain('lg:grid-cols-[minmax(0,1fr)_135px_135px]');
    expect(smtp).toContain('data-smtp-row="identity"');
    expect(smtp).toContain('data-smtp-row="addresses"');
    expect(smtp).toContain('sm:grid-cols-2');
    expect(smtp).not.toContain('overflow-x-auto');
    expect(smtp).toContain('Mostrar senha SMTP');
  });

  it('pagina somente os 21 historicos recentes em blocos de sete', () => {
    expect(users).toContain('const HISTORY_PAGE_SIZE = 7');
    expect(users).toContain('const MAX_HISTORY = 21');
    expect(users).toContain('.slice(0, MAX_HISTORY)');
    expect(users).toContain('Math.ceil(history.length / HISTORY_PAGE_SIZE)');
    expect(users).toContain('pageItems = history.slice');
  });

  it('centraliza todos os tipos reais e estados operacionais em icones acessiveis', () => {
    for (const type of ['NEW_FEATURE', 'IMPROVEMENT', 'VISUAL_ADJUSTMENT', 'PERFORMANCE', 'REFACTORING', 'FIX', 'INTEGRATION', 'DOCUMENTATION', 'OTHER', 'BUG_REPORT']) expect(taskPresentation).toContain(type);
    expect(taskPresentation).toContain('icon: Bug');
    expect(taskPresentation).toContain("timerStatus === 'running'");
    expect(taskPresentation).toContain("timerStatus === 'paused'");
    expect(taskPresentation).toContain('aria-label={`Tipo: ${presentation.label}`}');
    expect(tasks).toContain('<TaskTypeIcon');
    expect(tasks).toContain('<OperationalStateIcon');
  });

  it('usa especificamente Lucide Bug apenas para o tipo real BUG_REPORT', () => {
    expect(TASK_TYPE_PRESENTATION.BUG_REPORT.icon).toBe(Bug);
    expect(TASK_TYPE_PRESENTATION.NEW_FEATURE.icon).toBe(Sparkles);
    expect(TaskTypeIcon({ code: 'BUG_REPORT' }).props).toMatchObject({ title: 'Report Bug', 'aria-label': 'Tipo: Report Bug' });
    expect(TaskTypeIcon({ code: 'NEW_FEATURE' }).props.title).toBe('Nova funcionalidade');
    expect(taskPresentation).toContain('dark:bg-slate-800 dark:text-slate-300');
  });

  it('separa abertas e finalizadas preservando filtros e resetando pagina', () => {
    expect(taskPresentation).toContain("['ACTIVE', 'PAUSED']");
    expect(taskPresentation).toContain("['COMPLETED', 'CANCELED']");
    expect(tasks).toContain("useState('open')");
    expect(tasks).toContain('Abertas');
    expect(tasks).toContain('Concluídas');
    expect(tasks).toContain('setPage(1)');
    expect(tasks).toContain('lastPage = Math.max(1');
  });

  it('torna cards operacionais rastreaveis por drill-down paginado', () => {
    expect(dashboard).toContain("['backend_bugs', 'Bugs Backend'");
    expect(dashboard).toContain("['frontend_bugs', 'Bugs Frontend'");
    expect(dashboard).toContain('api.get(`/dashboard/details/${metric}`');
    expect(dashboard).toContain('Link to={`/task/${item.task_id}`}');
    expect(dashboard).toContain('details.pagination.total_pages');
    expect(metricCard).toContain("role={onClick ? 'button' : undefined}");
  });
});
