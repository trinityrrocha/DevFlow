import {
  Bug, CircleDot, FileCode2, Gauge, GitPullRequestArrow, Layers3,
  Palette, PauseCircle, PlayCircle, Puzzle, RefreshCcw, Sparkles, Wrench
} from 'lucide-react';

export const TASK_TYPE_PRESENTATION = Object.freeze({
  NEW_FEATURE: { label: 'Nova funcionalidade', icon: Sparkles },
  IMPROVEMENT: { label: 'Melhoria', icon: Layers3 },
  VISUAL_ADJUSTMENT: { label: 'Ajuste visual', icon: Palette },
  PERFORMANCE: { label: 'Performance', icon: Gauge },
  REFACTORING: { label: 'Refatoração', icon: RefreshCcw },
  FIX: { label: 'Correção', icon: Wrench },
  INTEGRATION: { label: 'Integração', icon: GitPullRequestArrow },
  DOCUMENTATION: { label: 'Documentação', icon: FileCode2 },
  OTHER: { label: 'Outro', icon: Puzzle },
  BUG_REPORT: { label: 'Bug', icon: Bug }
});

export const OPEN_TASK_STATES = Object.freeze(['ACTIVE', 'PAUSED']);
export const COMPLETED_TASK_STATES = Object.freeze(['COMPLETED', 'CANCELED']);

export function TaskTypeIcon({ code, fallbackKind }) {
  const presentation = TASK_TYPE_PRESENTATION[code]
    || (fallbackKind === 'BUG' ? TASK_TYPE_PRESENTATION.BUG_REPORT : { label: 'Tipo de tarefa', icon: CircleDot });
  const Icon = presentation.icon;
  return <span title={presentation.label} aria-label={`Tipo: ${presentation.label}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Icon className="h-4 w-4" aria-hidden="true" /></span>;
}

export function OperationalStateIcon({ timerStatus }) {
  if (timerStatus === 'running') return <span title="Cronômetro em execução" aria-label="Estado operacional: em execução" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><PlayCircle className="h-4 w-4" aria-hidden="true" /></span>;
  if (timerStatus === 'paused') return <span title="Cronômetro pausado" aria-label="Estado operacional: pausada" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><PauseCircle className="h-4 w-4" aria-hidden="true" /></span>;
  return null;
}
