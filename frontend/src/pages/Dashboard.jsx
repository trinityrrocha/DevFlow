import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bug, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Code2, ListTodo, Monitor, PauseCircle, RefreshCw, TrendingUp, X } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import MetricCard from '../components/MetricCard';
import { Link } from '../router';
import { formatDuration, label } from '../utils/formatters';

const metricCards = [
  ['total_tasks', 'Total de tarefas', ListTodo, 'indigo'],
  ['completed_tasks', 'Concluídas', CheckCircle2, 'green'],
  ['active_tasks', 'Em andamento', TrendingUp, 'indigo'],
  ['paused_tasks', 'Pausadas', PauseCircle, 'amber'],
  ['total_bugs', 'Total de Bugs', Bug, 'red'],
  ['resolved_bugs', 'Bugs resolvidos', CheckCircle2, 'green'],
  ['pending_bugs', 'Bugs pendentes', AlertTriangle, 'red'],
  ['backend_bugs', 'Bugs Backend', Code2, 'red'],
  ['frontend_bugs', 'Bugs Frontend', Monitor, 'red']
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    try { setData((await api.get('/dashboard')).data); }
    finally { setLoading(false); }
  }, []);
  const loadDetails = useCallback(async (metric, page = 1) => {
    setDetailLoading(true); setDetailError('');
    try { setDetails((await api.get(`/dashboard/details/${metric}`, { params: { page, limit: 20 } })).data); }
    catch (error) { setDetailError(errorMessage(error)); }
    finally { setDetailLoading(false); }
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
      <header className="flex items-start justify-between"><div><h1 className="text-2xl font-bold">Dashboard</h1><p className="mt-1 text-sm text-slate-500">Indicadores atualizados a cada 15 segundos.</p></div><button onClick={load} className="btn-secondary"><RefreshCw className="mr-2 h-4 w-4" />Atualizar</button></header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metricCards.map(([metric, title, Icon, tone]) => <MetricCard key={metric} title={title} value={general[metric] || 0} icon={Icon} tone={tone} onClick={() => loadDetails(metric)} />)}
        <MetricCard title="Tempo médio" value={formatDuration(general.average_completion_seconds)} icon={Clock3} tone="slate" subtitle="da abertura efetiva à conclusão" />
      </section>
      <section className="grid gap-6 xl:grid-cols-3">
        {['priority', 'environment', 'kind'].map((dimension) => <Distribution key={dimension} dimension={dimension} general={general} />)}
      </section>
      <DeveloperMetrics data={data} />
      <section className="card p-5"><h2 className="font-semibold">Tempo médio por etapa</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(general.average_by_stage || []).map((item) => <div key={item.stage} className="rounded-md border border-slate-200 p-3"><p className="text-xs font-medium text-slate-500">{item.stage_name || label(item.stage)}</p><p className="mt-1 font-semibold">{formatDuration(item.average_seconds)}</p></div>)}</div></section>
      {(details || detailLoading || detailError) && <DetailModal details={details} loading={detailLoading} error={detailError} close={() => { setDetails(null); setDetailError(''); }} loadPage={loadDetails} />}
    </div>
  );
}

function Distribution({ dimension, general }) {
  return <article className="card p-5"><h2 className="font-semibold">{dimension === 'priority' ? 'Por prioridade' : dimension === 'environment' ? 'Por ambiente' : 'Por tipo'}</h2><div className="mt-4 space-y-3">{(general.distributions?.[dimension] || []).map((item) => <div key={item.value}><div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">{item.label || label(item.value)}</span><strong>{item.total}</strong></div><svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full overflow-hidden rounded-full" aria-hidden="true"><rect width="100" height="8" className="fill-slate-100" /><rect width={Math.max(5, (item.total / Math.max(1, general.total_tasks)) * 100)} height="8" className="fill-indigo-500" /></svg></div>)}</div></article>;
}

function DeveloperMetrics({ data }) {
  return <section className="card overflow-hidden"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Métricas por desenvolvedor</h2><p className="text-xs text-slate-500">Fórmula de qualidade v{data?.formula_version}; use o ranking com contexto humano.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Desenvolvedor</th><th className="px-4 py-3">Concluídas</th><th className="px-4 py-3">Bugs corrigidos</th><th className="px-4 py-3">Tempo ativo</th><th className="px-4 py-3">Média por tarefa</th><th className="px-4 py-3">Média por etapa</th><th className="px-4 py-3">Aprovação</th><th className="px-4 py-3">Retrabalhos</th><th className="px-4 py-3">Qualidade</th><th className="px-4 py-3">Produtividade</th></tr></thead><tbody className="divide-y divide-slate-100">{(data?.developers || []).map((developer) => <tr key={developer.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-semibold text-indigo-600">{developer.productivity_rank}</td><td className="px-4 py-3"><p className="font-medium">{developer.name}</p><p className="text-xs text-slate-400">{developer.email}</p></td><td className="px-4 py-3">{developer.completed_tasks}</td><td className="px-4 py-3">{developer.bugs_fixed}</td><td className="px-4 py-3">{formatDuration(developer.total_seconds)}</td><td className="px-4 py-3">{formatDuration(developer.average_task_seconds)}</td><td className="px-4 py-3 text-xs">{Object.entries(developer.average_by_stage || {}).length === 0 ? '—' : Object.entries(developer.average_by_stage).map(([stage, seconds]) => <span key={stage} className="mr-2 whitespace-nowrap">{label(stage)}: {formatDuration(seconds)}</span>)}</td><td className="px-4 py-3">{developer.approval_rate}%</td><td className="px-4 py-3">{developer.reworks}</td><td className="px-4 py-3"><Score value={developer.quality_index} /></td><td className="px-4 py-3 font-medium">{developer.productivity_score}</td></tr>)}</tbody></table></div></section>;
}

function DetailModal({ details, loading, error, close, loadPage }) {
  const metric = details?.metric;
  const title = metricCards.find(([value]) => value === metric)?.[1] || 'Detalhes do indicador';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="dashboard-detail-title"><div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"><div className="flex items-center justify-between"><h2 id="dashboard-detail-title" className="text-lg font-semibold">{title}</h2><button type="button" onClick={close} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fechar detalhes"><X className="h-5 w-5" /></button></div>{loading && <p className="py-10 text-center text-sm text-slate-500">Carregando registros...</p>}{error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{details && !loading && <><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Tarefa</th><th className="px-3 py-2">Registro / Bug</th><th className="px-3 py-2">Lado</th><th className="px-3 py-2">Responsável</th><th className="px-3 py-2">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{details.items.map((item) => <tr key={`${item.record_id}:${item.side || 'record'}`}><td className="px-3 py-3"><Link to={`/task/${item.task_id}`} className="font-medium text-indigo-600 hover:underline">{item.task_code}</Link>{item.related_task_title && <p className="max-w-xs truncate text-xs text-slate-500">{item.related_task_title}</p>}</td><td className="px-3 py-3"><Link to={`/task/${item.record_id}`} className="text-indigo-600 hover:underline">{item.record_code}</Link><p className="max-w-xs truncate text-xs text-slate-500">{item.title}</p></td><td className="px-3 py-3">{item.side ? label(item.side) : '—'}</td><td className="px-3 py-3">{item.assignee_name || '—'}</td><td className="px-3 py-3">{label(item.state)}</td></tr>)}{details.items.length === 0 && <tr><td colSpan="5" className="px-3 py-8 text-center text-slate-500">Nenhum registro compõe este indicador.</td></tr>}</tbody></table></div><div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-slate-500"><span>{details.pagination.total} registro(s)</span>{details.pagination.total_pages > 1 && <nav className="flex items-center gap-3" aria-label="Paginação dos detalhes"><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={details.pagination.page === 1} onClick={() => loadPage(metric, details.pagination.page - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</button><span>{details.pagination.page} de {details.pagination.total_pages}</span><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={details.pagination.page === details.pagination.total_pages} onClick={() => loadPage(metric, details.pagination.page + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></button></nav>}</div></>}</div></div>;
}

function Score({ value }) {
  const color = value >= 80 ? 'fill-green-500' : value >= 60 ? 'fill-amber-500' : 'fill-red-500';
  return <div className="flex items-center gap-2"><svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-16 overflow-hidden rounded-full" aria-hidden="true"><rect width="100" height="8" className="fill-slate-100" /><rect width={value} height="8" className={color} /></svg><span>{value}</span></div>;
}
