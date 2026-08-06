import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyForm = { name: '', code: '', contact_name: '', contact_email: '', notes: '', is_active: true };

export default function Clients() {
  const { user } = useAuth();
  const canManage = user.is_super_admin || user.permissions?.includes('clients.manage');
  const [data, setData] = useState({ clients: [], pagination: {} });
  const [filters, setFilters] = useState({ search: '', status: 'all', page: 1 });
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/catalogs/clients', { params: filters });
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openForm = (client = null) => {
    setForm(client ? { ...emptyForm, ...client } : emptyForm);
    setDialog(client ? { type: 'edit', client } : { type: 'create' });
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === '' ? null : value]));
      if (dialog.type === 'create') await api.post('/catalogs/clients', payload);
      else await api.patch(`/catalogs/clients/${dialog.client.id}`, payload);
      setDialog(null);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const toggle = async (client) => {
    await api.patch(`/catalogs/clients/${client.id}`, { is_active: !client.is_active });
    await load();
  };

  const remove = async (client) => {
    if (!window.confirm(`Excluir o cliente ${client.name}? A operacao sera bloqueada se houver projetos vinculados.`)) return;
    try {
      await api.delete(`/catalogs/clients/${client.id}`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold">Clientes</h1><p className="mt-1 text-sm text-slate-500">Clientes da empresa ativa e seus vinculos com projetos.</p></div>{canManage && <button type="button" onClick={() => openForm()} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Novo cliente</button>}</header>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section className="card p-4"><div className="grid gap-3 sm:grid-cols-[1fr_14rem]"><label className="relative"><span className="sr-only">Pesquisar clientes</span><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input className="field pl-10" placeholder="Pesquisar nome, codigo ou contato" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 1 })} /></label><select aria-label="Filtrar clientes por status" className="field" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></div></section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Projetos</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Acoes</th></tr></thead><tbody className="divide-y divide-slate-100">
      {loading && <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">Carregando clientes...</td></tr>}
      {!loading && data.clients.length === 0 && <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">Nenhum cliente encontrado.</td></tr>}
      {!loading && data.clients.map((client) => <tr key={client.id}><td className="px-4 py-3"><p className="font-medium">{client.name}</p><p className="text-xs text-slate-500">{client.code || 'Sem codigo'}</p></td><td className="px-4 py-3"><p>{client.contact_name || 'Nao informado'}</p><p className="text-xs text-slate-500">{client.contact_email}</p></td><td className="px-4 py-3">{client.project_count}</td><td className="px-4 py-3">{client.is_active ? 'Ativo' : 'Inativo'}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => setDialog({ type: 'view', client })} className="rounded p-2 text-slate-600 hover:bg-slate-100" aria-label={`Visualizar ${client.name}`}><Eye className="h-4 w-4" /></button>{canManage && <><button type="button" onClick={() => openForm(client)} className="rounded p-2 text-indigo-600 hover:bg-indigo-50" aria-label={`Editar ${client.name}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => toggle(client)} className="btn-secondary h-8 px-2 text-xs">{client.is_active ? 'Desativar' : 'Ativar'}</button><button type="button" onClick={() => remove(client)} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={`Excluir ${client.name}`}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}
    </tbody></table></div><Pagination pagination={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></section>
    {dialog && <Dialog title={dialog.type === 'create' ? 'Novo cliente' : dialog.type === 'edit' ? 'Editar cliente' : 'Detalhes do cliente'} onClose={() => setDialog(null)}>{dialog.type === 'view' ? <dl className="grid gap-3 text-sm sm:grid-cols-2"><Detail label="Nome" value={dialog.client.name} /><Detail label="Codigo" value={dialog.client.code} /><Detail label="Contato" value={dialog.client.contact_name} /><Detail label="E-mail" value={dialog.client.contact_email} /><Detail label="Projetos" value={dialog.client.project_count} /><Detail label="Observacoes" value={dialog.client.notes} /></dl> : <ClientForm form={form} setForm={setForm} save={save} onCancel={() => setDialog(null)} />}</Dialog>}
  </div>;
}

function ClientForm({ form, setForm, save, onCancel }) {
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Nome<input required minLength="2" maxLength="180" className="field mt-1" value={form.name} onChange={field('name')} /></label><label className="text-sm font-medium">Codigo<input maxLength="64" className="field mt-1" value={form.code || ''} onChange={field('code')} /></label><label className="text-sm font-medium">Contato<input maxLength="160" className="field mt-1" value={form.contact_name || ''} onChange={field('contact_name')} /></label><label className="text-sm font-medium">E-mail<input type="email" maxLength="320" className="field mt-1" value={form.contact_email || ''} onChange={field('contact_email')} /></label><label className="text-sm font-medium sm:col-span-2">Observacoes<textarea maxLength="10000" rows="4" className="textarea-field mt-1" value={form.notes || ''} onChange={field('notes')} /></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button><button className="btn-primary">Salvar</button></div></form>;
}

function Dialog({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 id="dialog-title" className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="rounded p-2" aria-label="Fechar">×</button></div>{children}</div></div>; }
function Detail({ label, value }) { return <div><dt className="font-medium text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value ?? 'Nao informado'}</dd></div>; }
function Pagination({ pagination, onPage }) { return <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500"><span>{pagination.total || 0} registro(s)</span><div className="flex gap-2"><button type="button" disabled={(pagination.page || 1) <= 1} onClick={() => onPage(pagination.page - 1)} className="btn-secondary h-8">Anterior</button><span className="self-center">{pagination.page || 1} / {pagination.pages || 1}</span><button type="button" disabled={(pagination.page || 1) >= (pagination.pages || 1)} onClick={() => onPage(pagination.page + 1)} className="btn-secondary h-8">Proxima</button></div></div>; }
