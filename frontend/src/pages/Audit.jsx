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

      <SessionsCard />

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

function SessionsCard() {
  const [data, setData] = useState({ sessions: [], pagination: {} });
  const [filters, setFilters] = useState({ search: '', status: 'active' });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData((await api.get('/audit/sessions', { params: filters })).data); setError(''); }
    catch (requestError) { setError(errorMessage(requestError)); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (session) => {
    if (!window.confirm(`Encerrar a sessao de ${session.name}?`)) return;
    try { await api.post(`/audit/sessions/${session.id}/revoke`); await load(); }
    catch (requestError) { setError(errorMessage(requestError)); }
  };
  return <section className="card overflow-hidden"><div className="border-b border-slate-200 p-4"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><h2 className="font-semibold">Sessoes ativas e encerradas</h2><p className="text-xs text-slate-500">Login, ultimo acesso, origem e motivo real do encerramento.</p></div><div className="flex gap-2"><input aria-label="Pesquisar usuario nas sessoes" className="field" placeholder="Nome ou e-mail" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /><select aria-label="Filtrar status das sessoes" className="field" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="active">Ativas</option><option value="expired">Expiradas</option><option value="revoked">Revogadas</option><option value="all">Todas</option></select></div></div>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Login / ultimo acesso</th><th className="px-4 py-3">Origem</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Encerramento</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{data.sessions.map((session) => <tr key={session.id}><td className="px-4 py-3"><p className="font-medium">{session.name}{session.is_current && <span className="ml-2 rounded bg-indigo-50 px-2 py-1 text-[10px] text-indigo-700">ATUAL</span>}</p><p className="text-xs text-slate-500">{session.email} · {session.roles?.join(', ') || 'USER'}</p></td><td className="px-4 py-3"><p>{formatDate(session.login_at)}</p><p className="text-xs text-slate-500">{formatDate(session.last_seen_at)}</p></td><td className="max-w-xs px-4 py-3"><p>{session.ip_address || 'Nao informado'}</p><p className="truncate text-xs text-slate-500" title={session.user_agent}>{session.user_agent || 'User-agent nao informado'}</p></td><td className="px-4 py-3">{session.status}</td><td className="px-4 py-3"><p>{session.revoked_at ? formatDate(session.revoked_at) : '—'}</p><p className="text-xs text-slate-500">{session.revoke_reason || '—'}</p></td><td className="px-4 py-3 text-right">{session.status === 'active' && !session.is_current && <button type="button" onClick={() => revoke(session)} className="btn-danger h-8">Encerrar</button>}</td></tr>)}{data.sessions.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-slate-500">Nenhuma sessao encontrada.</td></tr>}</tbody></table></div><div className="border-t px-4 py-3 text-xs text-slate-500">{data.pagination.total || 0} sessao(oes)</div></section>;
}
