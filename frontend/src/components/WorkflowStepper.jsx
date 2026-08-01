import { Check, Circle } from 'lucide-react';

export default function WorkflowStepper({ stages, current, state }) {
  const currentIndex = stages.findIndex((stage) => (typeof stage === 'string' ? stage : stage.id) === current);
  return (
    <ol className="flex min-w-max items-center" aria-label="Fluxo da tarefa">
      {stages.map((stage, index) => {
        const stageId = typeof stage === 'string' ? stage : stage.id;
        const stageName = typeof stage === 'string' ? stage : stage.name;
        const complete = index < currentIndex || state === 'COMPLETED';
        const active = stageId === current;
        return (
          <li key={stageId} className="flex items-center">
            <div className="flex flex-col items-center">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                complete ? 'border-indigo-600 bg-indigo-600 text-white'
                  : active ? 'border-indigo-600 bg-white text-indigo-600'
                    : 'border-slate-300 bg-white text-slate-400'
              }`}>
                {complete ? <Check className="h-4 w-4" /> : <Circle className="h-3 w-3" fill="currentColor" />}
              </span>
              <span className={`mt-1 max-w-24 text-center text-xs ${active ? 'font-semibold text-indigo-700' : 'text-slate-500'}`}>{stageName}</span>
            </div>
            {index < stages.length - 1 && <span className={`mb-5 h-0.5 w-10 sm:w-16 ${index < currentIndex ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
