import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Shield, UserRound } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate } from '../utils/formatters';

const initial = { name: '', email: '', password: '', access_level: 'USER', profiles: ['BACKEND_DEVELOPER'] };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [userResponse, profileResponse] = await Promise.all([api.get('/users'), api.get('/users/profiles')]);
    setUsers(userResponse.data.users);
    setProfiles(profileResponse.data.profiles);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/users', form);
      setForm(initial);
      setCreating(false);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (user) => {
    if (!window.confirm(`${user.is_active ? 'Desativar' : 'Ativar'} ${user.name}?`)) return;
    try {
      await api.patch(`/users/${user.id}`, { is_active: !user.is_active });
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex items-start justify-between"><div><h1 className="text-2xl font-bold">Gestão de Equipe</h1><p className="mt-1 text-sm text-slate-500">Usuários, níveis de acesso e perfis técnicos.</p></div><button onClick={() => setCreating(!creating)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Novo usuário</button></header>
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {creating && (
        <form onSubmit={create} className="card p-5">
          <h2 className="font-semibold">Cadastrar usuário</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <Field label="E-mail" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
            <Field label="Senha temporária" type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} />
            <label className="text-sm font-medium">Nível<select className="field mt-1" value={form.access_level} onChange={(e) => setForm({ ...form, access_level: e.target.value })}><option value="USER">Usuário</option><option value="ADMIN">Administrador</option></select></label>
          </div>
          <fieldset className="mt-4"><legend className="text-sm font-medium">Perfis técnicos</legend><div className="mt-2 flex flex-wrap gap-3">{profiles.map((profile) => <label key={profile.code} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.profiles.includes(profile.code)} onChange={(e) => setForm({ ...form, profiles: e.target.checked ? [...form.profiles, profile.code] : form.profiles.filter((code) => code !== profile.code) })} />{profile.name}</label>)}</div></fieldset>
          <div className="mt-4 flex gap-3"><button disabled={saving || form.profiles.length === 0} className="btn-primary">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar</button><button type="button" onClick={() => setCreating(false)} className="btn-secondary">Cancelar</button></div>
        </form>
      )}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Nível</th><th className="px-4 py-3">Perfis</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Cadastro</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${user.is_super_admin ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>{user.is_super_admin ? <Shield className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span><div><p className="font-medium">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p></div></div></td>
                  <td className="px-4 py-3">{user.is_super_admin ? 'Super Admin' : user.access_level === 'ADMIN' ? 'Administrador' : 'Usuário'}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{user.profiles.map((profile) => <span key={profile} className="rounded bg-slate-100 px-2 py-1 text-xs">{profile}</span>)}</div></td>
                  <td className="px-4 py-3"><StatusBadge value={user.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3 text-right">{!user.is_super_admin && <button onClick={() => toggleUser(user)} className={user.is_active ? 'btn-danger h-8' : 'btn-secondary h-8'}>{user.is_active ? 'Desativar' : 'Ativar'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return <label className="text-sm font-medium">{label}<input required type={type} value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1" /></label>;
}
