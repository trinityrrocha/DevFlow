import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { formatDate } from '../utils/formatters';

export default function Audit() {
  const [data, setData] = useState({ events: [], pagination: {} });
  const [filters, setFilters] = useState({ operation: '', actor_email: '', status: '' });
  const [applied, setApplied] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await api.get('/audit', { params: applied });
      setData(response.data);
      setError('');
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, [applied]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Auditoria</h1>
          <p className="mt-1 text-sm text-slate-500">Trilha imutável das operações sensíveis do sistema.</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw className="mr-2 h-4 w-4" />Atualizar</button>
      </header>

      <form
        onSubmit={(event) => { event.preventDefault(); setApplied(Object.fromEntries(Object.entries(filters).filter(([, value]) => value))); }}
        className="card grid gap-3 p-4 md:grid-cols-4"
      >
        <input className="field" placeholder="Operação" value={filters.operation} onChange={(event) => setFilters({ ...filters, operation: event.target.value })} />
        <input className="field" placeholder="E-mail do ator" value={filters.actor_email} onChange={(event) => setFilters({ ...filters, actor_email: event.target.value })} />
        <select className="field" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">Todos os resultados</option>
          <option value="SUCCESS">Sucesso</option>
          <option value="DENIED">Negado</option>
          <option value="FAILED">Falha</option>
        </select>
        <button className="btn-primary"><Search className="mr-2 h-4 w-4" />Filtrar</button>
      </form>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Ator</th><th className="px-4 py-3">Operação</th><th className="px-4 py-3">Entidade</th><th className="px-4 py-3">Resultado</th><th className="px-4 py-3">Request ID</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.events.map((event) => (
                <tr key={event.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(event.created_at)}</td>
                  <td className="px-4 py-3">{event.actor_email || 'Sistema'}</td>
                  <td className="px-4 py-3 font-medium">{event.operation}</td>
                  <td className="px-4 py-3 text-slate-600">{event.entity_type || '—'}{event.entity_id ? <span className="block max-w-40 truncate text-xs text-slate-400">{event.entity_id}</span> : null}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${event.status === 'SUCCESS' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{event.status}</span></td>
                  <td className="max-w-48 truncate px-4 py-3 font-mono text-xs text-slate-400">{event.request_id || '—'}</td>
                </tr>
              ))}
              {data.events.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-slate-500">Nenhum evento encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          {data.pagination.total || 0} evento(s) · página {data.pagination.page || 1} de {data.pagination.total_pages || 1}
        </div>
      </section>
    </div>
  );
}
