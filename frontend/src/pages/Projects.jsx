import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyForm = { name: '', client_id: '', default_environment_id: '', github_repository_url: '', description: '', status: 'ACTIVE', responsibles: [] };

export default function Projects() {
  const { user } = useAuth();
  const canManage = user.is_super_admin || user.permissions?.includes('projects.manage');
  const [data, setData] = useState({ projects: [], pagination: {} });
  const [catalogs, setCatalogs] = useState({ clients: [], environments: [], users: [] });
  const [filters, setFilters] = useState({ search: '', status: 'all', client_id: '', page: 1 });
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
      const response = await api.get('/catalogs/projects', { params });
      setData(response.data);
    }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { api.get('/catalogs/bootstrap').then((response) => setCatalogs(response.data)).catch((requestError) => setError(errorMessage(requestError))); }, []);
  useEffect(() => { const timer = window.setTimeout(load, 200); return () => window.clearTimeout(timer); }, [load]);

  const openForm = (project = null) => {
    setForm(project ? { ...emptyForm, ...project, responsibles: project.responsibles || [] } : { ...emptyForm, client_id: catalogs.clients[0]?.id || '', default_environment_id: catalogs.environments[0]?.id || '' });
    setDialog(project ? { type: 'edit', project } : { type: 'create' });
  };
  const save = async (event) => {
    event.preventDefault(); setError('');
    try {
      const payload = { ...form, github_repository_url: form.github_repository_url || null, description: form.description || null };
      delete payload.code;
      if (dialog.type === 'create') await api.post('/catalogs/projects', payload); else await api.patch(`/catalogs/projects/${dialog.project.id}`, payload);
      setDialog(null); await load();
    } catch (requestError) { setError(errorMessage(requestError)); }
  };
  const toggle = async (project) => { await api.patch(`/catalogs/projects/${project.id}`, { status: project.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }); await load(); };
  const remove = async (project) => {
    if (!window.confirm(`Excluir o projeto ${project.name}? A operacao sera bloqueada se houver tarefas vinculadas.`)) return;
    try { await api.delete(`/catalogs/projects/${project.id}`); await load(); } catch (requestError) { setError(errorMessage(requestError)); }
  };

  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold">Projetos</h1><p className="mt-1 text-sm text-slate-500">Projetos, clientes, ambientes, equipe e tarefas vinculadas.</p></div>{canManage && <button type="button" onClick={() => openForm()} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Novo projeto</button>}</header>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section className="card p-4"><div className="grid gap-3 md:grid-cols-[1fr_14rem_14rem]"><label className="relative"><span className="sr-only">Pesquisar projetos</span><Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" /><input className="field pl-10" placeholder="Pesquisar projeto, codigo ou cliente" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 1 })} /></label><select aria-label="Filtrar projetos por cliente" className="field" value={filters.client_id} onChange={(event) => setFilters({ ...filters, client_id: event.target.value, page: 1 })}><option value="">Todos os clientes</option>{catalogs.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select aria-label="Filtrar projetos por status" className="field" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}><option value="all">Todos os status</option>{['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].map((status) => <option key={status}>{status}</option>)}</select></div></section>
    <section className="card overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Projeto</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Ambiente</th><th className="px-4 py-3">Equipe</th><th className="px-4 py-3">Tarefas</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Acoes</th></tr></thead><tbody className="divide-y divide-slate-100">{loading && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Carregando projetos...</td></tr>}{!loading && data.projects.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Nenhum projeto encontrado.</td></tr>}{!loading && data.projects.map((project) => <tr key={project.id}><td className="px-4 py-3"><p className="font-medium">{project.name}</p><p className="text-xs text-slate-500">{project.code}</p></td><td className="px-4 py-3">{project.client_name}</td><td className="px-4 py-3">{project.default_environment_name}</td><td className="px-4 py-3">{project.responsibles?.length || 0}</td><td className="px-4 py-3">{project.task_count}</td><td className="px-4 py-3">{project.status}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => setDialog({ type: 'view', project })} className="rounded p-2" aria-label={`Visualizar ${project.name}`}><Eye className="h-4 w-4" /></button>{canManage && <><button type="button" onClick={() => openForm(project)} className="rounded p-2 text-indigo-600" aria-label={`Editar ${project.name}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => toggle(project)} className="btn-secondary h-8 px-2 text-xs">{project.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button><button type="button" onClick={() => remove(project)} className="rounded p-2 text-red-600" aria-label={`Excluir ${project.name}`}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div><ProjectPagination pagination={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></section>
    {dialog && <ProjectDialog title={dialog.type === 'create' ? 'Novo projeto' : dialog.type === 'edit' ? 'Editar projeto' : 'Detalhes do projeto'} onClose={() => setDialog(null)}>{dialog.type === 'view' ? <ProjectDetails project={dialog.project} /> : <ProjectForm form={form} setForm={setForm} catalogs={catalogs} save={save} onCancel={() => setDialog(null)} />}</ProjectDialog>}
  </div>;
}

function ProjectForm({ form, setForm, catalogs, save, onCancel }) {
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const toggleUser = (userId) => setForm({ ...form, responsibles: form.responsibles.some((item) => item.user_id === userId) ? form.responsibles.filter((item) => item.user_id !== userId) : [...form.responsibles, { user_id: userId, responsibility_code: 'DEVELOPER' }] });
  return <form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Nome<input required minLength="2" maxLength="180" className="field mt-1" value={form.name} onChange={field('name')} /></label>{form.code && <label className="text-sm font-medium">Codigo gerado<input readOnly className="field mt-1 bg-slate-50 font-mono text-xs" value={form.code} /></label>}<label className="text-sm font-medium">Cliente<select required className="field mt-1" value={form.client_id} onChange={field('client_id')}><option value="">Selecione</option>{catalogs.clients.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Ambiente padrao<select required className="field mt-1" value={form.default_environment_id} onChange={field('default_environment_id')}><option value="">Selecione</option>{catalogs.environments.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Status<select className="field mt-1" value={form.status} onChange={field('status')}>{['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].map((status) => <option key={status}>{status}</option>)}</select></label><label className="text-sm font-medium">Repositorio GitHub<input type="url" maxLength="2048" className="field mt-1" value={form.github_repository_url || ''} onChange={field('github_repository_url')} /></label><label className="text-sm font-medium sm:col-span-2">Descricao<textarea rows="3" maxLength="20000" className="textarea-field mt-1" value={form.description || ''} onChange={field('description')} /></label><fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Equipe responsavel</legend><div className="mt-2 grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-2">{catalogs.users.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.responsibles.some((item) => item.user_id === member.id)} onChange={() => toggleUser(member.id)} />{member.name} <span className="text-xs text-slate-400">{member.profiles?.join(', ')}</span></label>)}</div></fieldset><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button><button className="btn-primary">Salvar</button></div></form>;
}
function ProjectDetails({ project }) { return <dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Nome', project.name], ['Codigo', project.code], ['Cliente', project.client_name], ['Ambiente', project.default_environment_name], ['Status', project.status], ['Tarefas vinculadas', project.task_count], ['Repositorio', project.github_repository_url], ['Descricao', project.description]].map(([label, value]) => <div key={label}><dt className="font-medium text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value ?? 'Nao informado'}</dd></div>)}<div className="sm:col-span-2"><dt className="font-medium text-slate-500">Equipe</dt><dd className="mt-1">{project.responsibles?.map((item) => item.name).join(', ') || 'Nenhum responsavel'}</dd></div></dl>; }
function ProjectDialog({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5"><div className="mb-5 flex items-center justify-between"><h2 id="project-dialog-title" className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label="Fechar">×</button></div>{children}</div></div>; }
function ProjectPagination({ pagination, onPage }) { return <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-slate-500"><span>{pagination.total || 0} registro(s)</span><div className="flex gap-2"><button type="button" disabled={(pagination.page || 1) <= 1} onClick={() => onPage(pagination.page - 1)} className="btn-secondary h-8">Anterior</button><span className="self-center">{pagination.page || 1} / {pagination.pages || 1}</span><button type="button" disabled={(pagination.page || 1) >= (pagination.pages || 1)} onClick={() => onPage(pagination.page + 1)} className="btn-secondary h-8">Proxima</button></div></div>; }
