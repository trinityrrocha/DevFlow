import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Link, useNavigate } from '../router';
import api from '../services/api';
import StatusBadge from '../components/StatusBadge';
import NewTaskModal from '../components/NewTaskModal';
import { useAuth } from '../context/AuthContext';
import { label } from '../utils/formatters';
import { formatSignedDuration } from '../utils/timing';

const compactDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(value)) : '—';

export default function Tasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ tasks: [], pagination: {} });
  const [filters, setFilters] = useState({ search: '', state: '', kind: '', priority: '', overdue: '' });
  const [priorities, setPriorities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const canCreate = user.is_super_admin || user.permissions?.includes('tasks.create');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      setData((await api.get('/tasks', { params })).data);
    } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { api.get('/catalogs/priorities').then(({ data: value }) => setPriorities(value.items.filter((item) => item.is_active))); }, []);

  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><h1 className="text-2xl font-bold">Tarefas</h1>{canCreate && <button type="button" onClick={() => setNewTaskOpen(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Nova Tarefa</button>}</header>
    <section className="card p-4"><div className="grid gap-3 md:grid-cols-5"><label className="relative"><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Buscar titulo ou codigo" className="field pl-10" /></label><Filter value={filters.state} onChange={(value) => setFilters({ ...filters, state: value })} options={['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED']} placeholder="Todos os estados" /><Filter value={filters.kind} onChange={(value) => setFilters({ ...filters, kind: value })} options={['REQUEST', 'BUG']} placeholder="Todos os tipos" /><Filter value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={priorities.map((item) => [item.id, item.name])} placeholder="Todas as prioridades" /><Filter value={filters.overdue} onChange={(value) => setFilters({ ...filters, overdue: value })} options={[["true", "Atrasadas"], ["false", "Dentro do prazo"]]} placeholder="Todos os prazos" /></div></section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><div role="table" className="min-w-[1120px] text-sm"><div role="row" className="flex h-10 items-center border-b border-slate-300 bg-slate-200/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-700"><Header className="w-[32%]">Tarefa</Header><Header className="w-[12%]">Etapa</Header><Header className="w-[10%]">Estado</Header><Header className="w-[11%]">Prioridade</Header><Header className="w-[10%]">Responsaveis</Header><Header className="w-[16%]">Estimado / restante</Header><Header className="w-[9%]">Criada em</Header></div>
      <div role="rowgroup" className="divide-y divide-slate-100">{loading && <div className="flex h-10 items-center justify-center text-slate-500">Carregando tarefas...</div>}{!loading && !data.tasks.length && <div className="flex h-10 items-center justify-center text-slate-500">Nenhuma tarefa encontrada.</div>}{!loading && data.tasks.map((task) => <div role="row" key={task.id} className="flex h-10 items-center hover:bg-slate-50"><Cell className="w-[32%] min-w-0"><Link to={`/task/${task.id}`} title={`DF-${String(task.task_number).padStart(6, '0')} · ${task.title}`} className="block truncate font-medium text-indigo-700 hover:underline">DF-{String(task.task_number).padStart(6, '0')} · {task.title}</Link></Cell><Cell className="w-[12%] truncate">{task.stage_name}</Cell><Cell className="w-[10%]"><StatusBadge value={task.state} /></Cell><Cell className="w-[11%]"><StatusBadge value={task.priority} /></Cell><Cell className="w-[10%]"><div className="flex items-center gap-1"><Avatar name={task.backend_assignee_name} role="Backend" /><Avatar name={task.frontend_assignee_name} role="Frontend" /></div></Cell><Cell className={`w-[16%] whitespace-nowrap text-xs ${task.overdue_now ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{formatSignedDuration(task.estimated_duration_seconds)} | {formatSignedDuration(task.remaining_seconds)}</Cell><Cell className="w-[9%] whitespace-nowrap text-xs text-slate-500">{compactDate(task.created_at)}</Cell></div>)}</div></div></div><div className="border-t px-4 py-3 text-xs text-slate-500">{data.pagination.total || 0} tarefa(s)</div></section>
    <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={(task) => { setNewTaskOpen(false); navigate(`/task/${task.id}`); }} />
  </div>;
}

function Header({ className, children }) { return <div role="columnheader" className={`px-3 ${className}`}>{children}</div>; }
function Cell({ className, children }) { return <div role="cell" className={`flex h-10 items-center px-3 ${className}`}>{children}</div>; }
function Avatar({ name, role }) { const display = name || 'Nao atribuido'; return <span title={`${role}: ${display}`} aria-label={`${role}: ${display}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">{display.trim().charAt(0).toUpperCase() || '?'}</span>; }
function Filter({ value, onChange, options, placeholder }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="field"><option value="">{placeholder}</option>{options.map((option) => { const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, label(option)]; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select>; }
