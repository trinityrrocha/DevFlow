import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Link, useNavigate } from '../router';
import api from '../services/api';
import StatusBadge from '../components/StatusBadge';
import NewTaskModal from '../components/NewTaskModal';
import { useAuth } from '../context/AuthContext';
import { formatDate, label } from '../utils/formatters';
import { formatSignedDuration } from '../utils/timing';

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
      const response = await api.get('/tasks', { params });
      setData(response.data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    api.get('/catalogs/priorities')
      .then((response) => setPriorities(response.data.items.filter((item) => item.is_active)));
  }, []);

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold">Tarefas</h1><p className="mt-1 text-sm text-slate-500">Solicitações e bugs de todo o ciclo.</p></div>{canCreate && <button type="button" onClick={() => setNewTaskOpen(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Nova Tarefa</button>}</header>
      <section className="card p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="relative md:col-span-1"><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Buscar título ou código" className="field pl-10" /></label>
          <Filter value={filters.state} onChange={(value) => setFilters({ ...filters, state: value })} options={['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED']} placeholder="Todos os estados" />
          <Filter value={filters.kind} onChange={(value) => setFilters({ ...filters, kind: value })} options={['REQUEST', 'BUG']} placeholder="Todos os tipos" />
          <Filter value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={priorities.map((item) => [item.id, item.name])} placeholder="Todas as prioridades" />
          <Filter value={filters.overdue} onChange={(value) => setFilters({ ...filters, overdue: value })} options={[["true", "Atrasadas"], ["false", "Dentro do prazo"]]} placeholder="Todos os prazos" />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Tarefa</th><th className="px-4 py-3">Etapa</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Responsáveis</th><th className="px-4 py-3">Estimado / restante</th><th className="px-4 py-3">Criada em</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Carregando tarefas...</td></tr>}
              {!loading && data.tasks.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Nenhuma tarefa encontrada.</td></tr>}
              {!loading && data.tasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-md px-4 py-3"><Link to={`/task/${task.id}`} className="font-medium text-indigo-700 hover:underline">DF-{String(task.task_number).padStart(6, '0')} · {task.title}</Link><div className="mt-1"><StatusBadge value={task.kind} /></div></td>
                  <td className="px-4 py-3">{task.stage_name}</td>
                  <td className="px-4 py-3"><StatusBadge value={task.state} /></td>
                  <td className="px-4 py-3"><StatusBadge value={task.priority} /></td>
                  <td className="px-4 py-3 text-xs"><p>B: {task.backend_assignee_name}</p><p>F: {task.frontend_assignee_name}</p></td>
                  <td className="px-4 py-3"><p>{formatSignedDuration(task.estimated_duration_seconds)}</p><p className={`text-xs ${task.overdue_now ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{task.overdue_now ? 'Atrasada · ' : ''}{formatSignedDuration(task.remaining_seconds)}</p></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(task.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">{data.pagination.total || 0} tarefa(s)</div>
      </section>
      <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={(task) => { setNewTaskOpen(false); navigate(`/task/${task.id}`); }} />
    </div>
  );
}

function Filter({ value, onChange, options, placeholder }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="field"><option value="">{placeholder}</option>{options.map((option) => {
    const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, label(option)];
    return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
  })}</select>;
}
