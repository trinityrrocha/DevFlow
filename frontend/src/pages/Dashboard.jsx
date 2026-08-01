import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bug, CheckCircle2, Clock3, ListTodo, PauseCircle, RefreshCw, TrendingUp } from 'lucide-react';
import api from '../services/api';
import MetricCard from '../components/MetricCard';
import { formatDuration, label } from '../utils/formatters';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await api.get('/dashboard');
      setData(response.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Carregando indicadores...</p>;
  const general = data?.general || {};

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold">Dashboard</h1><p className="mt-1 text-sm text-slate-500">Indicadores atualizados a cada 15 segundos.</p></div>
        <button onClick={load} className="btn-secondary"><RefreshCw className="mr-2 h-4 w-4" />Atualizar</button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total de tarefas" value={general.total_tasks || 0} icon={ListTodo} />
        <MetricCard title="Concluídas" value={general.completed_tasks || 0} icon={CheckCircle2} tone="green" />
        <MetricCard title="Em andamento" value={general.active_tasks || 0} icon={TrendingUp} />
        <MetricCard title="Pausadas" value={general.paused_tasks || 0} icon={PauseCircle} tone="amber" />
        <MetricCard title="Total de Bugs" value={general.total_bugs || 0} icon={Bug} tone="red" />
        <MetricCard title="Bugs resolvidos" value={general.resolved_bugs || 0} icon={CheckCircle2} tone="green" />
        <MetricCard title="Bugs pendentes" value={general.pending_bugs || 0} icon={AlertTriangle} tone="red" />
        <MetricCard title="Tempo médio" value={formatDuration(general.average_completion_seconds)} icon={Clock3} tone="slate" subtitle="da abertura efetiva à conclusão" />
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        {['priority', 'environment', 'kind'].map((dimension) => (
          <article key={dimension} className="card p-5">
            <h2 className="font-semibold">{dimension === 'priority' ? 'Por prioridade' : dimension === 'environment' ? 'Por ambiente' : 'Por tipo'}</h2>
            <div className="mt-4 space-y-3">
              {(general.distributions?.[dimension] || []).map((item) => (
                <div key={item.value}>
                  <div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">{item.label || label(item.value)}</span><strong>{item.total}</strong></div>
                  <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
                    <rect width="100" height="8" className="fill-slate-100" />
                    <rect width={Math.max(5, (item.total / Math.max(1, general.total_tasks)) * 100)} height="8" className="fill-indigo-500" />
                  </svg>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Métricas por desenvolvedor</h2><p className="text-xs text-slate-500">Fórmula de qualidade v{data?.formula_version}; use o ranking com contexto humano.</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
              <th className="px-4 py-3">#</th><th className="px-4 py-3">Desenvolvedor</th><th className="px-4 py-3">Concluídas</th><th className="px-4 py-3">Bugs corrigidos</th><th className="px-4 py-3">Tempo ativo</th><th className="px-4 py-3">Média por tarefa</th><th className="px-4 py-3">Média por etapa</th><th className="px-4 py-3">Aprovação</th><th className="px-4 py-3">Retrabalhos</th><th className="px-4 py-3">Qualidade</th><th className="px-4 py-3">Produtividade</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.developers || []).map((developer) => (
                <tr key={developer.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-indigo-600">{developer.productivity_rank}</td>
                  <td className="px-4 py-3"><p className="font-medium">{developer.name}</p><p className="text-xs text-slate-400">{developer.email}</p></td>
                  <td className="px-4 py-3">{developer.completed_tasks}</td>
                  <td className="px-4 py-3">{developer.bugs_fixed}</td>
                  <td className="px-4 py-3">{formatDuration(developer.total_seconds)}</td>
                  <td className="px-4 py-3">{formatDuration(developer.average_task_seconds)}</td>
                  <td className="px-4 py-3 text-xs">
                    {Object.entries(developer.average_by_stage || {}).length === 0
                      ? '—'
                      : Object.entries(developer.average_by_stage).map(([stage, seconds]) => (
                        <span key={stage} className="mr-2 whitespace-nowrap">{label(stage)}: {formatDuration(seconds)}</span>
                      ))}
                  </td>
                  <td className="px-4 py-3">{developer.approval_rate}%</td>
                  <td className="px-4 py-3">{developer.reworks}</td>
                  <td className="px-4 py-3"><Score value={developer.quality_index} /></td>
                  <td className="px-4 py-3 font-medium">{developer.productivity_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Tempo médio por etapa</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(general.average_by_stage || []).map((item) => (
            <div key={item.stage} className="rounded-md border border-slate-200 p-3"><p className="text-xs font-medium text-slate-500">{item.stage_name || label(item.stage)}</p><p className="mt-1 font-semibold">{formatDuration(item.average_seconds)}</p></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Score({ value }) {
  const color = value >= 80 ? 'fill-green-500' : value >= 60 ? 'fill-amber-500' : 'fill-red-500';
  return <div className="flex items-center gap-2"><svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-16 overflow-hidden rounded-full" aria-hidden="true"><rect width="100" height="8" className="fill-slate-100" /><rect width={value} height="8" className={color} /></svg><span>{value}</span></div>;
}
