import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, Loader2, Pencil, Plus, Shield, ShieldOff, UserRound } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate } from '../utils/formatters';

const initial = { name: '', email: '', phone: '', password: '', access_level: 'USER', profiles: ['BACKEND_DEVELOPER'] };
const HISTORY_PAGE_SIZE = 7;
const MAX_HISTORY = 21;

export default function Users() {
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [userResponse, profileResponse] = await Promise.all([api.get('/users'), api.get('/users/profiles')]);
      setUsers(userResponse.data.users); setProfiles(profileResponse.data.profiles);
    } catch (requestError) { setError(errorMessage(requestError)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await api.post('/users', { ...form, phone: form.phone || null }); setForm(initial); setCreating(false); await load(); }
    catch (requestError) { setError(errorMessage(requestError)); } finally { setSaving(false); }
  };
  const openEdit = async (user) => {
    setTemporaryPassword(''); setError(''); setHistoryPage(1);
    try {
      const response = await api.get(`/users/${user.id}`);
      setEditing({ ...response.data.user, phone: response.data.user.phone || '' });
      setHistory((response.data.history || []).slice(0, MAX_HISTORY));
    } catch (requestError) { setError(errorMessage(requestError)); }
  };
  const saveEdit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await api.patch(`/users/${editing.id}`, { name: editing.name, email: editing.email, phone: editing.phone || null, access_level: editing.access_level, is_active: editing.is_active, profiles: editing.profiles }); setEditing(null); await load(); }
    catch (requestError) { setError(errorMessage(requestError)); } finally { setSaving(false); }
  };
  const action = async (operation, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setSaving(true); setError('');
    try { await operation(); await load(); } catch (requestError) { setError(errorMessage(requestError)); } finally { setSaving(false); }
  };
  const resetPassword = () => action(async () => { const response = await api.post(`/users/${editing.id}/password-reset`); setTemporaryPassword(response.data.temporary_password); }, `Redefinir a senha de ${editing.name} e encerrar suas sessoes?`);

  return <div className="animate-fadeIn space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h1 className="text-2xl font-bold">Gestao de Equipe</h1><p className="mt-1 text-sm text-slate-500">Usuarios, contato, niveis, perfis, MFA e sessoes.</p></div><button type="button" onClick={() => setCreating(!creating)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Novo usuario</button></header>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {creating && <UserForm title="Cadastrar usuario" form={form} setForm={setForm} profiles={profiles} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} create />}
    <section className="card overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Nivel</th><th className="px-4 py-3">MFA</th><th className="px-4 py-3">Ultimo acesso</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <UserRow key={user.id} user={user} openEdit={openEdit} />)}</tbody></table></div></section>
    {editing && <EditUserModal editing={editing} setEditing={setEditing} profiles={profiles} saving={saving} saveEdit={saveEdit} resetPassword={resetPassword} action={action} temporaryPassword={temporaryPassword} history={history} historyPage={historyPage} setHistoryPage={setHistoryPage} />}
  </div>;
}

function UserRow({ user, openEdit }) {
  return <tr><td className="px-4 py-3"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${user.is_super_admin ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>{user.is_super_admin ? <Shield className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span><div><p className="font-medium">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p></div></div></td><td className="px-4 py-3">{user.phone || 'Nao informado'}</td><td className="px-4 py-3">{user.is_super_admin ? 'Super Admin' : user.access_level === 'ADMIN' ? 'Administrador' : 'Usuario'}</td><td className="px-4 py-3">{user.mfa_enabled ? 'Ativo' : 'Inativo'}</td><td className="px-4 py-3 text-slate-500">{formatDate(user.last_access_at)}</td><td className="px-4 py-3"><StatusBadge value={user.is_active ? 'ACTIVE' : 'INACTIVE'} /></td><td className="px-4 py-3 text-right"><button type="button" onClick={() => openEdit(user)} className="rounded p-2 text-indigo-600 hover:bg-indigo-50" aria-label={`Administrar ${user.name}`}><Pencil className="h-4 w-4" /></button></td></tr>;
}

function EditUserModal({ editing, setEditing, profiles, saving, saveEdit, resetPassword, action, temporaryPassword, history, historyPage, setHistoryPage }) {
  const pageCount = Math.ceil(history.length / HISTORY_PAGE_SIZE);
  const pageItems = history.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-user-title"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 dark:bg-slate-900"><div className="mb-4 flex justify-between"><h2 id="edit-user-title" className="text-lg font-semibold">Administrar {editing.name}</h2><button type="button" onClick={() => setEditing(null)} aria-label="Fechar">×</button></div><UserForm form={editing} setForm={setEditing} profiles={profiles} saving={saving} onSubmit={saveEdit} onCancel={() => setEditing(null)} /><div className="mt-6 border-t pt-5"><h3 className="font-semibold">Acoes de seguranca</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={resetPassword} disabled={saving} className="btn-secondary"><KeyRound className="mr-2 h-4 w-4" />Redefinir senha</button><button type="button" onClick={() => action(() => api.post(`/users/${editing.id}/mfa-reset`), `Remover o MFA de ${editing.name}?`)} disabled={saving || !editing.mfa_enabled} className="btn-secondary"><ShieldOff className="mr-2 h-4 w-4" />Remover MFA</button><button type="button" onClick={() => action(() => api.post(`/audit/users/${editing.id}/sessions/revoke`), `Encerrar todas as sessoes de ${editing.name}?`)} disabled={saving} className="btn-danger">Encerrar sessoes</button></div>{temporaryPassword && <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4"><p className="text-sm font-semibold">Senha temporaria exibida somente nesta resposta</p><code className="mt-2 block break-all rounded bg-white p-2 text-sm">{temporaryPassword}</code><p className="mt-2 text-xs">A troca sera obrigatoria no proximo login. A senha nao foi gravada em log.</p></div>}</div><div className="mt-6 border-t pt-5"><h3 className="font-semibold">Historico recente</h3><ul className="mt-2 min-h-36 space-y-2 text-xs text-slate-600">{pageItems.map((item) => <li key={`${item.operation}-${item.created_at}`}><strong>{item.operation}</strong> · {formatDate(item.created_at)}</li>)}{history.length === 0 && <li>Nenhuma alteracao registrada.</li>}</ul>{pageCount > 1 && <nav className="mt-3 flex items-center justify-between border-t pt-3" aria-label="Paginação do histórico recente"><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={historyPage === 1} onClick={() => setHistoryPage((page) => page - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</button><span className="text-xs text-slate-500">Página {historyPage} de {pageCount}</span><button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={historyPage === pageCount} onClick={() => setHistoryPage((page) => page + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></button></nav>}</div></div></div>;
}

function UserForm({ title, form, setForm, profiles, saving, onSubmit, onCancel, create = false }) {
  const toggleProfile = (code, checked) => setForm({ ...form, profiles: checked ? [...form.profiles, code] : form.profiles.filter((value) => value !== code) });
  return <form onSubmit={onSubmit} className={create ? 'card p-5' : ''}>{title && <h2 className="font-semibold">{title}</h2>}<div className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} /><Field label="E-mail" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} /><Field label="Telefone" type="tel" required={false} pattern="\+[1-9][0-9]{7,14}" placeholder="+5511999999999" value={form.phone || ''} onChange={(value) => setForm({ ...form, phone: value.replace(/[^+0-9]/g, '') })} />{create && <Field label="Senha temporaria" type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} />}<label className="text-sm font-medium">Nivel<select className="field mt-1" value={form.access_level} onChange={(event) => setForm({ ...form, access_level: event.target.value })}><option value="USER">Usuario</option><option value="ADMIN">Administrador</option></select></label>{!create && <label className="flex items-end gap-2 pb-3 text-sm font-medium"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />Usuario ativo</label>}</div><fieldset className="mt-4"><legend className="text-sm font-medium">Perfis tecnicos</legend><div className="mt-2 flex flex-wrap gap-3">{profiles.map((profile) => <label key={profile.code} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={form.profiles.includes(profile.code)} onChange={(event) => toggleProfile(profile.code, event.target.checked)} />{profile.name}</label>)}</div></fieldset><div className="mt-4 flex gap-3"><button disabled={saving || form.profiles.length === 0} className="btn-primary">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</button><button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button></div></form>;
}
function Field({ label, value, onChange, type = 'text', required = true, pattern, placeholder }) { return <label className="text-sm font-medium">{label}<input required={required} type={type} pattern={pattern} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1" /></label>; }
