import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Link } from '../router';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';
import StrongConfirmationModal from '../components/StrongConfirmationModal';
import { formatDate, priorityDisplayName } from '../utils/formatters';
import { TaskCategoryIcon } from '../utils/taskPresentation';

export default function TaskTrash() {
  const { user } = useAuth();
  const [data, setData] = useState({ tasks: [], pagination: {} });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [emptyConfirmation, setEmptyConfirmation] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/tasks/trash', { params: { page, search: search || undefined } });
      setData(response.data);
      const lastPage = Math.max(1, response.data.pagination?.total_pages || 1);
      if (page > lastPage) setPage(lastPage);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);

  const restore = async (task) => {
    if (!window.confirm(`Restaurar ${task.code}? Todos os dados e relacionamentos serão preservados.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.post(`/tasks/${task.id}/restore`);
      setMessage(`${task.code} restaurada com sucesso.`);
      await load();
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const emptyTrash = async (confirmation) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await api.delete('/tasks/trash', { data: { confirmation } });
      setEmptyConfirmation(false);
      setMessage(`${response.data.permanently_deleted} tarefa(s) excluída(s) permanentemente.`);
      setPage(1);
      await load();
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const pagination = data.pagination || {};
  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><Link to="/task" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-indigo-600"><ChevronLeft className="mr-1 h-4 w-4" />Voltar às tarefas</Link><h1 className="mt-3 text-2xl font-bold">Lixeira de Tarefas</h1><p className="mt-1 text-sm text-slate-500">Tarefas excluídas permanecem disponíveis para restauração e auditoria.</p></div>{user.is_super_admin && <button type="button" className="btn-danger" disabled={busy || !pagination.total} onClick={() => setEmptyConfirmation(true)}><Trash2 className="mr-2 h-4 w-4" />Esvaziar lixeira</button>}</header>
    {(error || message) && <div role="alert" className={`rounded-md border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300' : 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300'}`}>{error || message}</div>}
    <section className="card p-4"><label className="relative block max-w-md text-sm font-medium"><span className="sr-only">Buscar na lixeira</span><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Buscar código ou título" className="field pl-10" /></label></section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-sm"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-3">Tarefa</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Etapa anterior</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Responsáveis</th><th className="px-4 py-3">Excluída por</th><th className="px-4 py-3">Data</th><th className="px-4 py-3 text-right">Ações</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{loading && <tr><td colSpan="8" className="px-4 py-10 text-center text-slate-500">Carregando lixeira...</td></tr>}{!loading && data.tasks.length === 0 && <tr><td colSpan="8" className="px-4 py-10 text-center text-slate-500">A lixeira está vazia.</td></tr>}{!loading && data.tasks.map((task) => <tr key={task.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="px-4 py-3"><p className="font-semibold text-indigo-700 dark:text-indigo-300">{task.code}</p><p className="max-w-64 truncate" title={task.title}>{task.title}</p></td><td className="px-4 py-3"><div className="flex items-center gap-2"><TaskCategoryIcon type={task.request_type} /><span>{task.task_type_name}</span></div></td><td className="px-4 py-3">{task.stage_name}</td><td className="px-4 py-3">{priorityDisplayName(task)}</td><td className="px-4 py-3 text-xs"><p>Backend: {task.backend_assignee_name}</p><p>Frontend: {task.frontend_assignee_name}</p></td><td className="px-4 py-3">{task.deleted_by_name || 'Não identificado'}</td><td className="px-4 py-3 whitespace-nowrap">{formatDate(task.deleted_at)}</td><td className="px-4 py-3 text-right"><button type="button" className="btn-secondary h-9 px-3" disabled={busy} aria-label={`Restaurar ${task.code}`} onClick={() => restore(task)}><RotateCcw className="mr-1.5 h-4 w-4" />Restaurar</button></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800"><span>{pagination.total || 0} tarefa(s) na lixeira</span>{pagination.total_pages > 1 && <nav className="flex items-center gap-3" aria-label="Paginação da lixeira"><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</button><span>Página {page} de {pagination.total_pages}</span><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={page >= pagination.total_pages} onClick={() => setPage((value) => value + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></button></nav>}</div></section>
    {emptyConfirmation && <StrongConfirmationModal title="Esvaziar lixeira" message={'Esta operação excluirá permanentemente todas as tarefas da lixeira.\n\nEssa ação não poderá ser desfeita.'} confirmationText="ESVAZIAR LIXEIRA" actionLabel="Excluir permanentemente" busy={busy} onCancel={() => setEmptyConfirmation(false)} onConfirm={emptyTrash} />}
  </div>;
}
