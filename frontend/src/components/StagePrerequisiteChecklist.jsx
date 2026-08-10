import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';

export default function StagePrerequisiteChecklist({ task, tests = [], githubCards = [], attachments = [] }) {
  const currentStageId = task.current_stage_id;
  const evidenceItems = [
    {
      label: 'Testes de QA aprovados',
      completed: tests.some((test) => test.stage_id === currentStageId && test.status === 'APPROVED')
    },
    {
      label: 'Cards do GitHub vinculados',
      completed: githubCards.some((card) => card.stage_id === currentStageId)
    },
    {
      label: 'Anexos inseridos',
      completed: attachments.length > 0
    }
  ];
  const pendingRequirements = task.missing_requirements || [];

  return (
    <aside id="stage-prerequisite-checklist" className={`w-full max-w-xl rounded-xl border p-4 ${pendingRequirements.length > 0 ? 'border-amber-300 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60'}`} aria-label="Checklist de pré-requisitos da etapa">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Checklist da etapa atual</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pendingRequirements.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {pendingRequirements.length > 0 ? `${pendingRequirements.length} pendência(s)` : 'Pronto para avançar'}
        </span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {evidenceItems.map((item) => <li key={item.label} className={`flex items-center gap-2 text-sm ${item.completed ? 'text-emerald-700' : 'text-slate-500'}`}>
          {item.completed ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span><span className="sr-only">{item.completed ? 'Concluído: ' : 'Pendente: '}</span>{item.label}</span>
        </li>)}
      </ul>
      {pendingRequirements.length > 0 ? <div className="mt-4 border-t border-amber-200 pt-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800"><AlertTriangle className="h-4 w-4" />Pendências obrigatórias</p>
        <ul className="mt-2 space-y-1.5">{pendingRequirements.map((requirement) => <li key={requirement} className="flex items-start gap-2 text-sm text-amber-800"><Circle className="mt-0.5 h-4 w-4 shrink-0" /><span>{requirement}</span></li>)}</ul>
      </div> : <p className="mt-4 border-t border-emerald-200 pt-3 text-sm font-medium text-emerald-700">Todos os requisitos obrigatórios foram concluídos.</p>}
    </aside>
  );
}
