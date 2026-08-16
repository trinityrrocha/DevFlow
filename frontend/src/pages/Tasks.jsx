import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { Link, useNavigate } from '../router';
import api from '../services/api';
import StatusBadge from '../components/StatusBadge';
import NewTaskModal from '../components/NewTaskModal';
import { useAuth } from '../context/AuthContext';
import { label } from '../utils/formatters';
import { formatSignedDuration } from '../utils/timing';
import { COMPLETED_TASK_STATES, OPEN_TASK_STATES, OperationalStateIcon, TaskTypeIcon } from '../utils/taskPresentation';

const compactDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(value)) : '—';

export default function Tasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ tasks: [], pagination: {} });
  const [lifecycle, setLifecycle] = useState('open');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', state: '', kind: '', priority: '', overdue: '' });
  const [priorities, setPriorities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const canCreate = user.is_super_admin || user.permissions?.includes('tasks.create');
  const updateFilter = (name, value) => { setPage(1); setFilters((current) => ({ ...current, [name]: value })); };
  const changeLifecycle = (value) => {
    setLifecycle(value); setPage(1);
    const allowed = value === 'open' ? OPEN_TASK_STATES : COMPLETED_TASK_STATES;
    setFilters((current) => ({ ...current, state: allowed.includes(current.state) ? current.state : '' }));
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, lifecycle, page }).filter(([, value]) => value !== ''));
      const response = (await api.get('/tasks', { params })).data;
      setData(response);
      const lastPage = Math.max(1, response.pagination?.total_pages || 1);
      if (page > lastPage) setPage(lastPage);
    } finally { setLoading(false); }
  }, [filters, lifecycle, page]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { api.get('/catalogs/priorities').then(({ data: value }) => setPriorities(value.items.filter((item) => item.is_active))); }, []);

  const stateOptions = lifecycle === 'open' ? OPEN_TASK_STATES : COMPLETED_TASK_STATES;
  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><h1 className="text-2xl font-bold">Tarefas</h1>{canCreate && <button type="button" onClick={() => setNewTaskOpen(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Nova Tarefa</button>}</header>
    <div className="flex border-b border-slate-200 dark:border-slate-700" role="tablist" aria-label="Situação das tarefas"><button type="button" role="tab" aria-selected={lifecycle === 'open'} onClick={() => changeLifecycle('open')} className={`border-b-2 px-5 py-2 text-sm font-semibold ${lifecycle === 'open' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Abertas</button><button type="button" role="tab" aria-selected={lifecycle === 'completed'} onClick={() => changeLifecycle('completed')} className={`border-b-2 px-5 py-2 text-sm font-semibold ${lifecycle === 'completed' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Concluídas</button></div>
    <section className="card p-4"><div className="grid gap-3 md:grid-cols-5"><label className="relative"><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Buscar titulo ou codigo" className="field pl-10" /></label><Filter value={filters.state} onChange={(value) => updateFilter('state', value)} options={stateOptions} placeholder="Todos os estados" /><Filter value={filters.kind} onChange={(value) => updateFilter('kind', value)} options={['REQUEST', 'BUG']} placeholder="Todos os tipos" /><Filter value={filters.priority} onChange={(value) => updateFilter('priority', value)} options={priorities.map((item) => [item.id, item.name])} placeholder="Todas as prioridades" /><Filter value={filters.overdue} onChange={(value) => updateFilter('overdue', value)} options={[["true", "Atrasadas"], ["false", "Dentro do prazo"]]} placeholder="Todos os prazos" /></div></section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><div role="table" className="min-w-[1160px] text-sm"><div role="row" className="flex h-10 items-center border-b border-slate-300 bg-slate-200/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-700"><Header className="w-[35%]">Tarefa</Header><Header className="w-[12%]">Etapa</Header><Header className="w-[10%]">Estado</Header><Header className="w-[11%]">Prioridade</Header><Header className="w-[9%]">Responsaveis</Header><Header className="w-[15%]">Estimado / restante</Header><Header className="w-[8%]">Criada em</Header></div>
      <div role="rowgroup" className="divide-y divide-slate-100">{loading && <div className="flex h-10 items-center justify-center text-slate-500">Carregando tarefas...</div>}{!loading && !data.tasks.length && <div className="flex h-10 items-center justify-center text-slate-500">Nenhuma tarefa encontrada.</div>}{!loading && data.tasks.map((task) => <div role="row" key={task.id} className="flex h-11 items-center hover:bg-slate-50"><Cell className="w-[35%] min-w-0"><div className="flex min-w-0 items-center gap-2"><TaskTypeIcon code={task.request_type} fallbackKind={task.kind} /><OperationalStateIcon timerStatus={task.timer_status} /><Link to={`/task/${task.id}`} title={`DF-${String(task.task_number).padStart(6, '0')} · ${task.title}`} className="block truncate font-medium text-indigo-700 hover:underline">DF-{String(task.task_number).padStart(6, '0')} · {task.title}</Link></div></Cell><Cell className="w-[12%] truncate">{task.stage_name}</Cell><Cell className="w-[10%]"><StatusBadge value={task.state} /></Cell><Cell className="w-[11%]"><StatusBadge value={task.priority} /></Cell><Cell className="w-[9%]"><div className="flex items-center gap-1"><Avatar name={task.backend_assignee_name} role="Backend" /><Avatar name={task.frontend_assignee_name} role="Frontend" /></div></Cell><Cell className={`w-[15%] whitespace-nowrap text-xs ${task.overdue_now ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{formatSignedDuration(task.estimated_duration_seconds)} | {formatSignedDuration(task.remaining_seconds)}</Cell><Cell className="w-[8%] whitespace-nowrap text-xs text-slate-500">{compactDate(task.created_at)}</Cell></div>)}</div></div></div><Pagination pagination={data.pagination} page={page} setPage={setPage} /></section>
    <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={(task) => { setNewTaskOpen(false); navigate(`/task/${task.id}`); }} />
  </div>;
}

function Pagination({ pagination, page, setPage }) {
  const pages = pagination.total_pages || 0;
  return <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-slate-500"><span>{pagination.total || 0} tarefa(s)</span>{pages > 1 && <nav className="flex items-center gap-3" aria-label="Paginação de tarefas"><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</button><span>Página {page} de {pages}</span><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></button></nav>}</div>;
}
function Header({ className, children }) { return <div role="columnheader" className={`px-3 ${className}`}>{children}</div>; }
function Cell({ className, children }) { return <div role="cell" className={`flex h-11 items-center px-3 ${className}`}>{children}</div>; }
function Avatar({ name, role }) { const display = name || 'Nao atribuido'; return <span title={`${role}: ${display}`} aria-label={`${role}: ${display}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">{display.trim().charAt(0).toUpperCase() || '?'}</span>; }
function Filter({ value, onChange, options, placeholder }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="field"><option value="">{placeholder}</option>{options.map((option) => { const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, label(option)]; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select>; }
