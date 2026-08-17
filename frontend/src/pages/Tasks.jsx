import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { Link, useNavigate } from '../router';
import api, { errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import NewTaskModal from '../components/NewTaskModal';
import { useAuth } from '../context/AuthContext';
import { label, priorityDisplayName } from '../utils/formatters';
import { formatSignedDuration } from '../utils/timing';
import { COMPLETED_TASK_STATES, OPEN_TASK_STATES, OperationalStateIcon, TaskCategoryIcon, TaskTypeIcon } from '../utils/taskPresentation';
import { groupTasks, TASK_GROUP_OPTIONS } from '../utils/taskGrouping';
import {
  compactTaskDuration, DEFAULT_TASK_FILTERS, hasActiveTaskFilters,
  paginationWindow, TASK_SORT_DEFAULT_DIRECTIONS, taskCountLabel
} from '../utils/taskList';

const compactDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(value)) : '—';

export default function Tasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ tasks: [], pagination: {} });
  const [lifecycle, setLifecycle] = useState('open');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ ...DEFAULT_TASK_FILTERS });
  const [sorting, setSorting] = useState({ by: '', direction: '' });
  const [groupBy, setGroupBy] = useState(null);
  const [preferenceError, setPreferenceError] = useState('');
  const [priorities, setPriorities] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const canCreate = user.is_super_admin || user.permissions?.includes('tasks.create');

  const updateFilter = (name, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  };
  const clearFilters = () => {
    setPage(1);
    setFilters({ ...DEFAULT_TASK_FILTERS });
  };
  const changeLifecycle = (value) => {
    setLifecycle(value);
    setPage(1);
    const allowed = value === 'open' ? OPEN_TASK_STATES : COMPLETED_TASK_STATES;
    setFilters((current) => ({ ...current, state: allowed.includes(current.state) ? current.state : '' }));
  };
  const toggleSort = (by) => {
    setPage(1);
    setSorting((current) => ({
      by,
      direction: current.by === by
        ? (current.direction === 'asc' ? 'desc' : 'asc')
        : TASK_SORT_DEFAULT_DIRECTIONS[by]
    }));
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries({
        ...filters,
        lifecycle,
        page,
        sort_by: sorting.by,
        sort_direction: sorting.direction
      }).filter(([, value]) => value !== ''));
      const response = (await api.get('/tasks', { params })).data;
      setData(response);
      const lastPage = Math.max(1, response.pagination?.total_pages || 1);
      if (page > lastPage) setPage(lastPage);
    } finally { setLoading(false); }
  }, [filters, lifecycle, page, sorting]);

  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    Promise.all([api.get('/catalogs/priorities'), api.get('/catalogs/stages')]).then(([priorityResponse, stageResponse]) => {
      setPriorities(priorityResponse.data.items.filter((item) => item.is_active).sort((left, right) => Number(right.weight) - Number(left.weight)));
      setStages(stageResponse.data.items);
    });
  }, []);
  useEffect(() => {
    let active = true;
    setGroupBy(null);
    setPreferenceError('');
    api.get('/tasks/preferences')
      .then(({ data: preference }) => {
        if (active) setGroupBy(preference.grouping === 'none' ? '' : preference.grouping);
      })
      .catch((requestError) => {
        if (active) {
          setGroupBy('');
          setPreferenceError(errorMessage(requestError));
        }
      });
    return () => { active = false; };
  }, [user.id, user.company_id]);

  const changeGrouping = async (value) => {
    const previous = groupBy || '';
    setGroupBy(value);
    setPreferenceError('');
    try {
      await api.patch('/tasks/preferences', { grouping: value || 'none' });
    } catch (requestError) {
      setGroupBy(previous);
      setPreferenceError(errorMessage(requestError));
    }
  };

  const stateOptions = lifecycle === 'open' ? OPEN_TASK_STATES : COMPLETED_TASK_STATES;
  const groupedTasks = useMemo(() => groupTasks(data.tasks, groupBy || ''), [data.tasks, groupBy]);
  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><h1 className="text-2xl font-bold">Tarefas</h1>{canCreate && <button type="button" onClick={() => setNewTaskOpen(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Nova Tarefa</button>}</header>
    <div className="flex border-b border-slate-200 dark:border-slate-700" role="tablist" aria-label="Situação das tarefas"><button type="button" role="tab" aria-selected={lifecycle === 'open'} onClick={() => changeLifecycle('open')} className={`border-b-2 px-5 py-2 text-sm font-semibold ${lifecycle === 'open' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-300' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Abertas</button><button type="button" role="tab" aria-selected={lifecycle === 'completed'} onClick={() => changeLifecycle('completed')} className={`border-b-2 px-5 py-2 text-sm font-semibold ${lifecycle === 'completed' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-300' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Concluídas</button></div>
    <section className="card p-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <label className="relative self-end"><span className="sr-only">Buscar tarefas</span><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Buscar título ou código" className="field pl-10" /></label>
        <Filter labelText="Estado" value={filters.state} onChange={(value) => updateFilter('state', value)} options={stateOptions} placeholder="Todos os estados" />
        <Filter labelText="Categoria" value={filters.category} onChange={(value) => updateFilter('category', value)} options={[["BUG", "Bug"], ["DEV", "Dev"]]} placeholder="Todas as categorias" />
        <Filter labelText="Etapa" value={filters.stage} onChange={(value) => updateFilter('stage', value)} options={stages.map((item) => [item.code, item.name])} placeholder="Todas as etapas" />
        <Filter labelText="Prioridade" value={filters.priority} onChange={(value) => updateFilter('priority', value)} options={priorities.map((item) => [item.id, priorityDisplayName(item)])} placeholder="Todas as prioridades" />
        <Filter labelText="Prazo" value={filters.overdue} onChange={(value) => updateFilter('overdue', value)} options={[["true", "Atrasadas"], ["false", "Dentro do prazo"]]} placeholder="Todos os prazos" />
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="mb-1 block">Agrupar por</span><select aria-label="Agrupar por" value={groupBy || ''} disabled={groupBy === null} onChange={(event) => changeGrouping(event.target.value)} className="field disabled:cursor-wait disabled:opacity-60">{TASK_GROUP_OPTIONS.map(([value, text]) => <option key={value || 'none'} value={value}>{text}</option>)}</select></label>
      </div>
      <div className="mt-3 flex min-h-6 items-center justify-end">{hasActiveTaskFilters(filters) && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300"><X className="h-3.5 w-3.5" aria-hidden="true" />Limpar filtros</button>}</div>
      {preferenceError && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">Não foi possível salvar sua preferência: {preferenceError}</p>}
    </section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><div role="table" className="min-w-[1120px] text-sm"><div role="row" className="flex h-10 items-center border-b border-slate-300 bg-slate-200/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><SortableHeader className="w-[29%]" sortKey="task" sorting={sorting} onSort={toggleSort}>Tarefa</SortableHeader><Header className="w-[8%]">Categoria</Header><SortableHeader className="w-[11%]" sortKey="stage" sorting={sorting} onSort={toggleSort}>Etapa</SortableHeader><Header className="w-[10%]">Estado</Header><SortableHeader className="w-[10%]" sortKey="priority" sorting={sorting} onSort={toggleSort}>Prioridade</SortableHeader><Header className="w-[11%]">Responsáveis</Header><Header className="w-[13%]">Estimado / restante</Header><SortableHeader className="w-[8%]" sortKey="created_at" sorting={sorting} onSort={toggleSort}>Criada em</SortableHeader></div>
      <div role="rowgroup" className="divide-y divide-slate-100 dark:divide-slate-800">{loading && <div className="flex h-10 items-center justify-center text-slate-500 dark:text-slate-400">Carregando tarefas...</div>}{!loading && !data.tasks.length && <div className="flex h-10 items-center justify-center text-slate-500 dark:text-slate-400">Nenhuma tarefa encontrada.</div>}{!loading && groupedTasks.map((group) => <Fragment key={group.key}>{groupBy && <div role="row" className="flex h-9 items-center border-y border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><span>{group.label} · {taskCountLabel(group.tasks.length)}</span></div>}{group.tasks.map((task) => <TaskRow key={task.id} task={task} />)}</Fragment>)}</div></div></div><Pagination pagination={data.pagination} page={page} setPage={setPage} /></section>
    <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={(task) => { setNewTaskOpen(false); navigate(`/task/${task.id}`); }} />
  </div>;
}

function TaskRow({ task }) {
  const estimate = compactTaskDuration(task.estimated_duration_seconds);
  const remaining = compactTaskDuration(task.remaining_seconds);
  const durationTitle = `Estimado: ${task.estimated_duration_seconds == null ? 'não definido' : formatSignedDuration(task.estimated_duration_seconds)} · Restante: ${task.remaining_seconds == null ? 'não definido' : formatSignedDuration(task.remaining_seconds)}`;
  return <div role="row" className="flex h-11 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50"><Cell className="w-[29%] min-w-0"><div className="flex min-w-0 items-center gap-2"><TaskTypeIcon code={task.request_type} label={task.task_type_name} /><OperationalStateIcon timerStatus={task.timer_status} /><Link to={`/task/${task.id}`} title={`DF-${String(task.task_number).padStart(6, '0')} · ${task.title}`} className="block truncate font-medium text-indigo-700 hover:underline dark:text-indigo-300">DF-{String(task.task_number).padStart(6, '0')} · {task.title}</Link></div></Cell><Cell className="w-[8%]"><TaskCategoryIcon task={task} /></Cell><Cell className="w-[11%] truncate" title={`Etapa: ${task.stage_name}`}>{task.stage_name}</Cell><Cell className="w-[10%]"><StatusBadge context="Estado" value={task.state} /></Cell><Cell className="w-[10%]"><StatusBadge context="Prioridade" value={task.priority} /></Cell><Cell className="w-[11%]"><div className="flex items-center gap-1"><Avatar name={task.backend_assignee_name} role="Backend" /><Avatar name={task.frontend_assignee_name} role="Frontend" /></div></Cell><Cell className={`w-[13%] whitespace-nowrap text-xs ${task.overdue_now ? 'font-semibold text-red-700 dark:text-red-300' : 'text-slate-600 dark:text-slate-300'}`}><span title={durationTitle} aria-label={durationTitle}>{estimate} / {remaining}</span></Cell><Cell className="w-[8%] whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{compactDate(task.created_at)}</Cell></div>;
}

function Pagination({ pagination, page, setPage }) {
  const pages = pagination.total_pages || 0;
  const visiblePages = paginationWindow(page, pages);
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300"><span>{taskCountLabel(pagination.total)}</span>{pages > 1 && <nav className="flex items-center gap-1" aria-label="Paginação de tarefas"><button type="button" title="Página anterior" aria-label="Página anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>{visiblePages.map((pageNumber) => <button type="button" key={pageNumber} aria-label={`Página ${pageNumber}`} aria-current={pageNumber === page ? 'page' : undefined} onClick={() => setPage(pageNumber)} className={`h-8 min-w-8 rounded-md px-2 font-semibold ${pageNumber === page ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{pageNumber}</button>)}<button type="button" title="Próxima página" aria-label="Próxima página" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></nav>}</div>;
}

function SortableHeader({ className, sortKey, sorting, onSort, children }) {
  const active = sorting.by === sortKey;
  const Icon = sorting.direction === 'asc' ? ArrowUp : ArrowDown;
  const directionText = sorting.direction === 'asc' ? 'crescente' : 'decrescente';
  return <div role="columnheader" aria-sort={active ? (sorting.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 ${className}`}><button type="button" title={active ? `Ordenação ${directionText}` : `Ordenar por ${children}`} aria-label={active ? `${children}, ordem ${directionText}` : `Ordenar por ${children}`} onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-indigo-700 dark:hover:text-indigo-300">{children}{active && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}</button></div>;
}
function Header({ className, children }) { return <div role="columnheader" className={`px-3 ${className}`}>{children}</div>; }
function Cell({ className, children }) { return <div role="cell" className={`flex h-11 items-center px-3 ${className}`}>{children}</div>; }
function Avatar({ name, role }) { const display = name || 'Não atribuído'; return <span title={`${role}: ${display}`} aria-label={`${role}: ${display}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{display.trim().charAt(0).toUpperCase() || '?'}</span>; }
function Filter({ labelText, value, onChange, options, placeholder }) { return <label className="self-end"><span className="sr-only">{labelText}</span><select aria-label={labelText} value={value} onChange={(event) => onChange(event.target.value)} className="field"><option value="">{placeholder}</option>{options.map((option) => { const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, label(option)]; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select></label>; }
